"""Create the unified reporting fact and KPI schema."""
from alembic import op

revision = "p5report000001"
down_revision = "p4usage000001"
branch_labels = None
depends_on = None


def upgrade():
    # Reporting models share the application's Base metadata. Importing them
    # here registers all 26 reporting tables before this migration executes.
    import app.models_reporting  # noqa: F401
    from app.database import Base
    tables = [table for name, table in Base.metadata.tables.items() if name.startswith("rpt_")]
    Base.metadata.create_all(bind=op.get_bind(), tables=tables, checkfirst=True)


def downgrade():
    import app.models_reporting  # noqa: F401
    from app.database import Base
    tables = [table for name, table in Base.metadata.tables.items() if name.startswith("rpt_")]
    Base.metadata.drop_all(bind=op.get_bind(), tables=list(reversed(tables)), checkfirst=True)
