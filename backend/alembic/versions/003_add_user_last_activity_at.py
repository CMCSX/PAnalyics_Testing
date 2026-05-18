"""Add last_activity_at to users table

Revision ID: 003_add_user_last_activity_at
Revises: 002_create_audit_logs
Create Date: 2026-05-15
"""

from alembic import op
import sqlalchemy as sa

revision = "003_add_user_last_activity_at"
down_revision = "004_delete_zero_record_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "last_activity_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_users_last_activity_at",
        "users",
        ["last_activity_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_users_last_activity_at", table_name="users")
    op.drop_column("users", "last_activity_at")
