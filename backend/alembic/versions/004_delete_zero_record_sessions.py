"""Stub for migration already applied to the remote database.

This file was missing from the local repo but the revision exists in the
alembic_version table on the Neon database. Adding the stub so Alembic can
resolve the revision chain.

Revision ID: 004_delete_zero_record_sessions
Revises: 002_create_audit_logs
Create Date: 2026-05-15 (stub)
"""

from alembic import op
import sqlalchemy as sa

revision = "004_delete_zero_record_sessions"
down_revision = "002_create_audit_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Already applied on the remote DB — no-op stub.
    pass


def downgrade() -> None:
    pass
