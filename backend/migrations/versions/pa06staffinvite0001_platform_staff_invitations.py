"""Add internal platform staff invitations."""
from alembic import op
import sqlalchemy as sa

revision = "pa06staffinvite0001"
down_revision = "p5report000001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "platform_staff_invitations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("invited_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("token_hash", name="uq_platform_staff_invitation_token_hash"),
    )
    op.create_index("ix_platform_staff_invitations_email", "platform_staff_invitations", ["email"])
    op.create_index("ix_platform_staff_invitations_token_hash", "platform_staff_invitations", ["token_hash"], unique=True)


def downgrade():
    op.drop_index("ix_platform_staff_invitations_token_hash", table_name="platform_staff_invitations")
    op.drop_index("ix_platform_staff_invitations_email", table_name="platform_staff_invitations")
    op.drop_table("platform_staff_invitations")
