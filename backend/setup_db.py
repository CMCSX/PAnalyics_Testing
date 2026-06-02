"""
One-time script to create all database tables on a fresh Neon PostgreSQL instance.

Usage (from the backend/ folder):
    py setup_db.py

After running this, Alembic is stamped at 'head' so future migrations work normally.
"""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Import all models so their metadata is registered before create_all
from app.db.base import Base
from app.models.user import User  # noqa: F401
from app.models.upload import UploadSession, PaymentRecord  # noqa: F401
from app.models.audit_log import AuditLog  # noqa: F401
from app.models.reference_data import Environment, Campaign, Touchpoint  # noqa: F401
from app.core.config import settings


async def main() -> None:
    print(f"Connecting to: {settings.DATABASE_URL[:60]}...")
    engine = create_async_engine(settings.DATABASE_URL, echo=True)

    async with engine.begin() as conn:
        print("\nCreating tables...")
        await conn.run_sync(Base.metadata.create_all)
        print("\nAll tables created successfully.")

        # Stamp alembic_version so 'alembic upgrade head' is a no-op on fresh DBs
        print("\nStamping Alembic at 'head'...")
        # Create alembic_version table if it doesn't exist
        await conn.execute(text(
            "CREATE TABLE IF NOT EXISTS alembic_version "
            "(version_num VARCHAR(32) NOT NULL, CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        ))
        # Clear any existing stamps and insert the latest revision
        await conn.execute(text("DELETE FROM alembic_version"))
        await conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('005_audit_log_amount_fix')"))
        print("Alembic stamped at head (005_audit_log_amount_fix).")

    await engine.dispose()
    print("\nSetup complete! You can now start the backend and run create_admin.py to add an admin user.")


if __name__ == "__main__":
    asyncio.run(main())
