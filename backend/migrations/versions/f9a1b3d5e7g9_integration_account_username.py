"""PA-08 integration account username.

Revision ID: f9a1b3d5e7g9
Revises: f8a0c2e4g6i8
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "f9a1b3d5e7g9"
down_revision: Union[str, Sequence[str], None] = "f8a0c2e4g6i8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("integrations", sa.Column("api_username", sa.String(length=160), nullable=True))


def downgrade() -> None:
    op.drop_column("integrations", "api_username")
