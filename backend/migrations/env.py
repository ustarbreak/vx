"""Alembic environment for InfraCentra.

Resolution order for the database URL:
  1. ALEMBIC_DATABASE_URL env var
  2. app.core.config.settings.DATABASE_URL (async URLs are coerced to sync)

This keeps alembic usable against both SQLite and PostgreSQL without
storing credentials in alembic.ini.
"""
from __future__ import annotations

import asyncio
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# --- URL resolution -----------------------------------------------------
url = os.environ.get("ALEMBIC_DATABASE_URL") or config.get_main_option("sqlalchemy.url")
try:
    from app.core.config import settings  # noqa: E402

    url = os.environ.get("ALEMBIC_DATABASE_URL") or settings.DATABASE_URL
except Exception:  # pragma: no cover - fall back to ini value
    pass

if url and "+asyncpg" in url:
    url = url.replace("+asyncpg", "+psycopg")
elif url and url.startswith("postgresql+asyncpg"):
    url = url.replace("postgresql+asyncpg", "postgresql+psycopg")

config.set_main_option("sqlalchemy.url", url)

# Metadata target: import models so Base.metadata is populated.
try:
    import app.models  # noqa: F401,E402
    from app.database import Base  # noqa: E402

    target_metadata = Base.metadata
except Exception:  # pragma: no cover
    target_metadata = None


def run_migrations_offline() -> None:
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    if url and "psycopg" in url or (url and url.startswith("postgresql://")):
        # Use sync engine for psycopg-style URLs.
        from sqlalchemy import create_engine

        connectable = create_engine(url, poolclass=pool.NullPool, future=True)
        with connectable.connect() as connection:
            do_run_migrations(connection)
        connectable.dispose()
    else:
        # sqlite (sync driver works fine) or async engine path
        if url and "+aiosqlite" in url:
            asyncio.run(run_async_migrations())
        else:
            from sqlalchemy import create_engine

            connectable = create_engine(url, poolclass=pool.NullPool, future=True)
            with connectable.connect() as connection:
                do_run_migrations(connection)
            connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
