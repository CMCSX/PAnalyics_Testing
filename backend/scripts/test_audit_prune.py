import sys
import asyncio

# Ensure backend package is importable
sys.path.insert(0, r"c:\Users\SPM\Downloads\clonerepo\PayAnalytics_UPDATED\backend")

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select

from app.db.base import Base
from app.models.audit_log import AuditLog
from app.repositories.audit_log_repository import AuditLogRepository

async def main():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        repo = AuditLogRepository(session)
        user_id = "test-user-1"

        # Insert 20 logs with a small delay to ensure distinct created_at timestamps
        for i in range(20):
            await repo.log_action(
                user_id=user_id,
                action=f"test_action_{i}",
                file_name=f"file_{i}",
                details=f"detail {i}",
            )
            # slight pause so SQLite's CURRENT_TIMESTAMP differs between inserts
            await asyncio.sleep(0.06)
        await session.commit()

        # Query remaining logs for the user
        result = await session.execute(
            select(AuditLog).where(AuditLog.user_id == user_id).order_by(AuditLog.created_at.desc())
        )
        rows = result.scalars().all()
        print("Total logs for user:", len(rows))
        print([r.action for r in rows])

    await engine.dispose()

if __name__ == '__main__':
    asyncio.run(main())
