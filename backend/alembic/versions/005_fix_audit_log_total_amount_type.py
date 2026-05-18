"""Fix audit_logs.total_amount column type from Float to Numeric(15,2)

The original migration (002_create_audit_logs) created total_amount as Float,
but the AuditLog model declares it as Numeric(15,2). This migration aligns
the DB column with the model to prevent floating-point precision loss on
financial amounts stored in the audit log.

Revision ID: 005_fix_audit_log_total_amount_type
Revises: 003_add_user_last_activity_at
Create Date: 2026-05-18
"""

from alembic import op
import sqlalchemy as sa

revision = "005_audit_log_amount_fix"
down_revision = "003_add_user_last_activity_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "audit_logs",
        "total_amount",
        existing_type=sa.Float(),
        type_=sa.Numeric(15, 2),
        existing_nullable=False,
        existing_server_default="0.0",
    )


def downgrade() -> None:
    op.alter_column(
        "audit_logs",
        "total_amount",
        existing_type=sa.Numeric(15, 2),
        type_=sa.Float(),
        existing_nullable=False,
        existing_server_default="0.0",
    )
