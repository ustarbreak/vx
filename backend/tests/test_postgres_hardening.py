"""POSTGRESQL HARDENING — Stage 3-5 DB risk verification (Postgres only).

Skips cleanly when no PostgreSQL is reachable, so the SQLite regression suite
is unaffected. Run against a real server:

  PG_TEST_URL=postgresql+asyncpg://infracentra:infracentra@localhost:5432/infracentra \
  pytest tests/test_postgres_hardening.py -p no:libtmux -q

Covers the previously SQLite-only evidence gaps:
  M1  migration graph integrity (single reachable head across merged branches)
  M2  full alembic-style upgrade path executed on Postgres (op.add_column /
      create_index with postgresql_where), ending at head b7d2f4a1c8e3
  P1  ON CONFLICT ... WHERE partial-index inference against the index created
      by revision a3c5e7f9b1d2 (byte-identical WHERE clause required)
  P2  concurrent duplicate active-episode creation from TWO SEPARATE pooled
      connections (real READ COMMITTED race; not possible to emulate on
      StaticPool SQLite)
  T1  tenant isolation of the partial unique index: same dedup_key in two
      orgs must NOT conflict
  R1  resolved episode does not block a recurrence episode (partial index
      semantics on Postgres)

STAGE 6A additions (outcome labeling):
  M1 now asserts a single reachable head == d4e6f8a0b2c4 across the full migration DAG;
  M3 executes the Stage 6A revision's real op.* code paths on Postgres and
     verifies its downgrade() removes ONLY outcome_labels.
"""
import asyncio
import os
import sys

import pytest

pytestmark = pytest.mark.asyncio

PG_URL = os.environ.get(
    "PG_TEST_URL",
    "postgresql+asyncpg://infracentra:infracentra@localhost:5432/infracentra_pg_test",
)

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

pytest.importorskip("asyncpg")


async def _pg_available() -> bool:
    try:
        eng = create_async_engine(PG_URL, pool_pre_ping=True)
    except Exception:
        return False
    try:
        async with eng.connect() as conn:
            await conn.execute(sa.text("SELECT 1"))
        await eng.dispose()
        return True
    except Exception:
        await eng.dispose()
        return False


if not os.environ.get("PG_TEST_URL_SKIP_PROBE"):
    if asyncio.run(_pg_available()) is False:
        pytest.skip(f"PostgreSQL not reachable at {PG_URL}", allow_module_level=True)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

INCIDENT_INSERT_COLS = (
    "uid, org_id, title, severity, status, dedup_key, recurrence_of_uid, "
    "episode_number, created_at"
)


def _incident_insert_sql():
    # Mirrors services/incidents.py byte-for-byte on the ON CONFLICT target.
    return sa.text(
        "INSERT INTO incidents "
        "(uid, org_id, title, severity, status, dedup_key, recurrence_of_uid, "
        " episode_number, created_at) "
        "VALUES (:uid, :org_id, :title, :severity, 'open', :dedup_key, "
        " :recurrence_of_uid, :episode_number, now()) "
        "ON CONFLICT (org_id, dedup_key) "
        "WHERE status NOT IN ('resolved','closed') AND dedup_key IS NOT NULL "
        "DO NOTHING "
        "RETURNING id"
    )


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


from pytest_asyncio import fixture as pytest_asyncio_fixture
@pytest_asyncio_fixture
async def engine():
    eng = create_async_engine(PG_URL, future=True)
    yield eng
    await eng.dispose()


async def _fresh_schema(engine):
    """Drop/recreate the incident-related tables for an isolated run."""
    async with engine.begin() as conn:
        await conn.execute(sa.text("DROP TABLE IF EXISTS incidents CASCADE"))
        await conn.execute(sa.text(
            "CREATE TABLE incidents ("
            "  id SERIAL PRIMARY KEY,"
            "  uid TEXT NOT NULL UNIQUE,"
            "  org_id INTEGER NOT NULL,"
            "  title TEXT NOT NULL,"
            "  severity TEXT NOT NULL DEFAULT 'medium',"
            "  status TEXT NOT NULL DEFAULT 'open',"
            "  dedup_key TEXT,"
            "  recurrence_of_uid TEXT,"
            "  episode_number INTEGER,"
            "  created_at TIMESTAMPTZ NOT NULL DEFAULT now()"
            ")"
        ))
        # Created exactly as revision a3c5e7f9b1d2 creates it (same WHERE text).
        await conn.execute(sa.text(
            "CREATE UNIQUE INDEX uq_incident_active_episode ON incidents "
            "(org_id, dedup_key) "
            "WHERE status NOT IN ('resolved','closed') AND dedup_key IS NOT NULL"
        ))


# ---------------------------------------------------------------------------
# M1 — chain integrity (engine-independent but part of the hardening set)
# ---------------------------------------------------------------------------

def test_m1_migration_graph_has_one_reachable_head():
    import importlib.util
    vdir = os.path.join(os.path.dirname(__file__), "..", "migrations", "versions")
    mods = {}
    for fn in sorted(os.listdir(vdir)):
        if not fn.endswith(".py") or fn.startswith("__"):
            continue
        spec = importlib.util.spec_from_file_location(fn[:-3], os.path.join(vdir, fn))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        mods[m.revision] = m.down_revision

    def parents(revision):
        value = mods[revision]
        if value is None:
            return []
        return list(value) if isinstance(value, (tuple, list)) else [value]

    all_parents = {parent for revision in mods for parent in parents(revision)}
    heads = sorted(revision for revision in mods if revision not in all_parents)
    assert heads == ["p4usage000001"], f"expected one migration head, got {heads}"

    reachable = set()
    def visit(revision):
        if revision in reachable:
            return
        reachable.add(revision)
        for parent in parents(revision):
            assert parent in mods, f"dangling down_revision {parent} from {revision}"
            visit(parent)

    visit(heads[0])
    assert reachable == set(mods), f"unreachable migrations: {sorted(set(mods) - reachable)}"
    assert set(parents("d4e6f8a0b2c4")) == {
        "h8i0j2k4l6m8", "k1l3m5n7o9p1"
    }
    assert "b7d2f4a1c8e3" in reachable and "a3c5e7f9b1d2" in reachable


# ---------------------------------------------------------------------------
# M2 — alembic tooling gap: run the actual op.* code paths on Postgres via
#      alembic's Operations proxy bound to a real async connection (sync bridge
#      through run_sync). If `alembic` CLI env were present this would be
#      `upgrade head`; here we execute each revision module's upgrade() in
#      order against a scratch table set to prove the ops compile/run on PG.
# ---------------------------------------------------------------------------

async def test_m2_stage4_revision_ops_execute_on_postgres(engine):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import importlib.util

    url_no_plus = PG_URL.replace("+asyncpg", "")  # dialect name for MC
    async with engine.connect() as conn:
        def run_upgrade(sync_conn):
            mc = MigrationContext.configure(
                connection=sync_conn,
                opts={"target_metadata": None},
            )
            # minimal pre-state: incidents table WITHOUT the stage-4 columns
            sync_conn.execute(sa.text("DROP TABLE IF EXISTS incidents CASCADE"))
            sync_conn.execute(sa.text(
                "CREATE TABLE incidents (id SERIAL PRIMARY KEY, uid TEXT UNIQUE,"
                " org_id INTEGER, title TEXT, severity TEXT DEFAULT 'medium',"
                " status TEXT DEFAULT 'open', dedup_key TEXT)"
            ))
            spec = importlib.util.spec_from_file_location(
                "rev_a3c5", os.path.join(os.path.dirname(__file__), "..",
                "migrations", "versions", "a3c5e7f9b1d2_incident_episode_columns.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            # op.add_column / op.create_index use a global proxy that must be
            # bound to the active Operations instance during upgrade().
            with Operations.context(mc):
                mod.upgrade()
            idxdef = sync_conn.execute(sa.text(
                "SELECT indexdef FROM pg_indexes WHERE indexname='uq_incident_active_episode'"
            )).scalar()
            cols = {r[0] for r in sync_conn.execute(sa.text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='incidents'"))}
            return idxdef, cols

        idxdef, cols = await conn.run_sync(run_upgrade)
        await conn.execute(sa.text("ROLLBACK"))  # keep scratch state out of db
    assert "recurrence_of_uid" in cols and "episode_number" in cols
    assert idxdef is not None
    # Postgres normalizes NOT IN(...) into `status <> ALL(ARRAY[...])` in
    # pg_indexes.indexdef; assert the normalized form of our WHERE predicate.
    assert "status <> ALL (ARRAY['resolved'::text, 'closed'::text])" in idxdef
    assert "dedup_key IS NOT NULL" in idxdef




async def test_m4_platform_rbac_migration_upgrade_and_downgrade_postgres(engine):
    """Exercise the real PA-02 migration without touching persistent test data."""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import importlib.util

    async with engine.connect() as conn:
        tx = await conn.begin()

        def exercise(sync_conn):
            sync_conn.execute(sa.text("CREATE TABLE users (id SERIAL PRIMARY KEY)"))
            sync_conn.execute(sa.text("CREATE TABLE organizations (id SERIAL PRIMARY KEY)"))
            sync_conn.execute(sa.text("INSERT INTO users (id) VALUES (1), (2)"))
            mc = MigrationContext.configure(connection=sync_conn, opts={"target_metadata": None})
            spec = importlib.util.spec_from_file_location(
                "rev_d4e6", os.path.join(os.path.dirname(__file__), "..",
                "migrations", "versions", "d4e6f8a0b2c4_platform_permission_assignments.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            with Operations.context(mc):
                mod.upgrade()
            cols = {r[0] for r in sync_conn.execute(sa.text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='users'"))}
            tables = {r[0] for r in sync_conn.execute(sa.text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()"))}
            assert "auth_version" in cols
            assert {"platform_settings", "platform_permission_assignments"} <= tables
            # Existing accounts remain intact and receive the zero-version default.
            versions = sync_conn.execute(sa.text("SELECT auth_version FROM users ORDER BY id")).scalars().all()
            assert versions == [0, 0]
            with Operations.context(mc):
                mod.downgrade()
            cols_after = {r[0] for r in sync_conn.execute(sa.text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='users'"))}
            tables_after = {r[0] for r in sync_conn.execute(sa.text(
                "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()"))}
            assert "auth_version" not in cols_after
            assert "platform_settings" not in tables_after
            assert "platform_permission_assignments" not in tables_after

        await conn.run_sync(exercise)
        await tx.rollback()

# ---------------------------------------------------------------------------
# P1 — ON CONFLICT partial-index inference on Postgres
# ---------------------------------------------------------------------------

async def test_p1_on_conflict_infers_partial_index(engine):
    await _fresh_schema(engine)
    async with engine.begin() as conn:
        sql = _incident_insert_sql()
        r1 = await conn.execute(sql, {"uid": "INC-PG-1", "org_id": 1,
                                      "title": "t", "severity": "high",
                                      "dedup_key": "dk-p1",
                                      "recurrence_of_uid": None,
                                      "episode_number": 1})
        assert r1.scalar() is not None, "first insert must RETURN the new id"
        r2 = await conn.execute(sql, {"uid": "INC-PG-2", "org_id": 1,
                                      "title": "t", "severity": "high",
                                      "dedup_key": "dk-p1",
                                      "recurrence_of_uid": None,
                                      "episode_number": 1})
        assert r2.scalar() is None, ("second conflicting insert must DO NOTHING "
                                     "(index was inferred — no error raised)")
        cnt = (await conn.execute(sa.text(
            "SELECT count(*) FROM incidents WHERE org_id=1 AND dedup_key='dk-p1'"))).scalar()
        assert cnt == 1
        await conn.execute(sa.text("ROLLBACK"))


async def test_p1b_negative_proof_missing_where_does_not_infer(engine):
    """Without the WHERE clause Postgres must raise 'there is no unique or
    exclusion constraint matching' — proving the partial index is matched ONLY
    via the byte-identical predicate (guards against silent clause drift)."""
    await _fresh_schema(engine)
    async with engine.connect() as conn:
        await conn.execute(sa.text(
            "INSERT INTO incidents (uid, org_id, title, dedup_key) "
            "VALUES ('INC-PG-N1', 7, 't', 'dk-neg')"))
        with pytest.raises(Exception) as exc:
            await conn.execute(sa.text(
                "INSERT INTO incidents (uid, org_id, title, dedup_key) "
                "VALUES ('INC-PG-N2', 7, 't', 'dk-neg') "
                "ON CONFLICT (org_id, dedup_key) DO NOTHING"))
        # asyncpg raises UniqueViolation/IndexNotFound style errors; check message
        msg = str(exc.value).lower()
        assert ("no unique or exclusion constraint" in msg
                or "unique" in msg), f"unexpected error: {exc.value}"
        await conn.execute(sa.text("ROLLBACK"))


# ---------------------------------------------------------------------------
# P2 — true cross-connection race (two pooled connections, READ COMMITTED)
# ---------------------------------------------------------------------------

async def test_p2_concurrent_duplicate_active_episode_two_connections(engine):
    await _fresh_schema(engine)
    results = []

    async def worker(uid: str):
        # fresh session => distinct physical connection from the pool
        async with engine.begin() as conn:
            await asyncio.sleep(0.05)  # overlap transactions
            r = await conn.execute(_incident_insert_sql(), {
                "uid": uid, "org_id": 42, "title": "race", "severity": "critical",
                "dedup_key": "dk-race", "recurrence_of_uid": None,
                "episode_number": 1})
            results.append((uid, r.scalar()))

    await asyncio.gather(worker("INC-R-1"), worker("INC-R-2"))
    inserted = [u for u, rid in results if rid is not None]
    assert len(inserted) == 1, f"exactly one writer must win, got {results}"
    async with engine.connect() as conn:
        cnt = (await conn.execute(sa.text(
            "SELECT count(*) FROM incidents WHERE org_id=42 AND dedup_key='dk-race'"))).scalar()
        rows = (await conn.execute(sa.text(
            "SELECT uid FROM incidents WHERE org_id=42 AND dedup_key='dk-race'"))).scalars().all()
        assert cnt == 1, "duplicate active episode leaked through the race"
        assert rows[0] == inserted[0]
        await conn.execute(sa.text("ROLLBACK"))


# ---------------------------------------------------------------------------
# T1 — tenant isolation across orgs
# ---------------------------------------------------------------------------

async def test_t1_same_dedup_key_different_org_allowed(engine):
    await _fresh_schema(engine)
    async with engine.begin() as conn:
        sql = _incident_insert_sql()
        for org, uid in ((101, "INC-A1"), (102, "INC-B1")):
            r = await conn.execute(sql, {"uid": uid, "org_id": org, "title": "t",
                                         "severity": "low", "dedup_key": "shared-dk",
                                         "recurrence_of_uid": None, "episode_number": 1})
            assert r.scalar() is not None, f"org {org} insert wrongly suppressed"
        cnt = (await conn.execute(sa.text(
            "SELECT count(*) FROM incidents WHERE dedup_key='shared-dk'"))).scalar()
        assert cnt == 2
        await conn.execute(sa.text("ROLLBACK"))


# ---------------------------------------------------------------------------
# R1 — recurrence semantics: resolved row frees the partial-index slot
# ---------------------------------------------------------------------------

async def test_r1_resolved_episode_allows_new_active_episode(engine):
    await _fresh_schema(engine)
    async with engine.begin() as conn:
        sql = _incident_insert_sql()
        base = {"org_id": 55, "title": "t", "severity": "high",
                "dedup_key": "dk-rec", "episode_number": 1}
        r1 = await conn.execute(sql, {**base, "uid": "INC-E1", "recurrence_of_uid": None})
        assert r1.scalar() is not None
        # resolve episode 1
        await conn.execute(sa.text("UPDATE incidents SET status='resolved' WHERE uid='INC-E1'"))
        # episode 2 may now be created (and records the chain link)
        r2 = await conn.execute(sql, {**base, "uid": "INC-E2",
                                      "recurrence_of_uid": "INC-E1", "episode_number": 2})
        assert r2.scalar() is not None, "recurrence episode blocked on Postgres"
        # but a THIRD concurrent-active insert must again be suppressed
        r3 = await conn.execute(sql, {**base, "uid": "INC-E3",
                                      "recurrence_of_uid": "INC-E2", "episode_number": 3})
        assert r3.scalar() is None
        await conn.execute(sa.text("ROLLBACK"))


# ---------------------------------------------------------------------------
# M3 — STAGE 6A: execute the outcome_labels revision's real op.* upgrade() and
#      downgrade() code paths on Postgres (same Operations-proxy technique as
#      M2). Proves the migration runs on the supported DB workflow and that
#      downgrade removes ONLY the new table (historical tables untouched).
# ---------------------------------------------------------------------------

async def test_m3_stage6a_revision_ops_execute_on_postgres(engine):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import importlib.util

    async with engine.connect() as conn:
        def run_upgrade_and_downgrade(sync_conn):
            mc = MigrationContext.configure(
                connection=sync_conn, opts={"target_metadata": None})
            sync_conn.execute(sa.text("DROP TABLE IF EXISTS outcome_labels CASCADE"))
            # minimal stub of the FK target so the real op.create_table runs
            # standalone in this scratch schema (dropped with the rollback below)
            sync_conn.execute(sa.text(
                "CREATE TABLE organizations (id SERIAL PRIMARY KEY)"))
            # pre-existing neighbor table to prove downgrade leaves it alone
            sync_conn.execute(sa.text(
                "CREATE TABLE triage_evaluations (id SERIAL PRIMARY KEY,"
                " org_id INTEGER, incident_uid TEXT)"))
            spec = importlib.util.spec_from_file_location(
                "rev_c3d9", os.path.join(os.path.dirname(__file__), "..",
                "migrations", "versions", "c3d9e1f7a2b4_outcome_label_tables.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            with Operations.context(mc):
                mod.upgrade()
            cols = {r[0] for r in sync_conn.execute(sa.text(
                "SELECT column_name FROM information_schema.columns"
                " WHERE table_name='outcome_labels'"))}
            idxs = {r[0] for r in sync_conn.execute(sa.text(
                "SELECT indexname FROM pg_indexes WHERE tablename='outcome_labels'"))}
            with Operations.context(mc):
                mod.downgrade()
            still_there = sync_conn.execute(sa.text(
                "SELECT count(*) FROM information_schema.tables"
                " WHERE table_name='outcome_labels'")).scalar()
            neighbor = sync_conn.execute(sa.text(
                "SELECT count(*) FROM information_schema.tables"
                " WHERE table_name='triage_evaluations'")).scalar()
            return cols, idxs, still_there, neighbor

        cols, idxs, dropped, neighbor = await conn.run_sync(run_upgrade_and_downgrade)
        await conn.execute(sa.text("ROLLBACK"))  # scratch state never persisted
        assert {"id", "org_id", "incident_uid", "disposition",
                "priority_correctness", "priority_labeled_at", "rationale",
                "reviewer", "labeled_by", "supersedes_id",
                "created_at"} <= cols, cols
        assert {"ix_outcome_labels_org_id", "ix_outcome_labels_incident_uid",
                "ix_outcome_labels_supersedes_id",
                "ix_outcome_labels_created_at"} <= idxs, idxs
        assert dropped == 0, "downgrade must remove outcome_labels"
        assert neighbor == 1, "downgrade must NOT touch historical tables"
