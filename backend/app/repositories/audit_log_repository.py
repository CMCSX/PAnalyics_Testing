from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.audit_log import AuditLog


class AuditLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        import logging
        self.logger = logging.getLogger(__name__)

    async def log_action(
        self,
        user_id: str,
        action: str,
        file_name: str,
        session_id: str | None = None,
        record_count: int = 0,
        total_amount: float = 0.0,
        details: str | None = None,
        snapshot_data: str | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            user_id=user_id,
            action=action,
            file_name=file_name,
            session_id=session_id,
            record_count=record_count,
            total_amount=total_amount,
            details=details,
            snapshot_data=snapshot_data,
        )
        self.session.add(entry)
        try:
            # Log for observability during debugging
            self.logger.info("Created audit entry: user=%s action=%s file=%s session=%s", user_id, action, file_name, session_id)
        except Exception:
            pass
        await self.session.flush()
        # Enforce per-user retention cap: keep only the most recent N entries per user.
        # Only prune entries older than 1 hour so a burst of actions doesn't
        # immediately destroy a snapshot the user might want to undo.
        # The hard cap is set higher (50) so a burst of 21+ actions within an hour
        # doesn't silently make older entries non-undoable before the 1-hour window passes.
        try:
            hard_cap = 50
            soft_cap = 20
            min_age_cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
            total_result = await self.session.execute(
                select(func.count()).select_from(AuditLog).where(AuditLog.user_id == user_id)
            )
            total = int(total_result.scalar_one() or 0)
            if total > hard_cap:
                # Hard cap: delete oldest entries regardless of age to prevent unbounded growth
                n_to_delete = total - hard_cap
                ids_result = await self.session.execute(
                    select(AuditLog.id)
                    .where(AuditLog.user_id == user_id)
                    .order_by(AuditLog.created_at.asc())
                    .limit(n_to_delete)
                )
                ids_to_delete = [row[0] for row in ids_result.all()]
                if ids_to_delete:
                    await self.session.execute(delete(AuditLog).where(AuditLog.id.in_(ids_to_delete)))
                    await self.session.flush()
            elif total > soft_cap:
                # Soft cap: only prune entries older than 1 hour
                n_to_delete = total - soft_cap
                ids_result = await self.session.execute(
                    select(AuditLog.id)
                    .where(
                        AuditLog.user_id == user_id,
                        AuditLog.created_at < min_age_cutoff,
                    )
                    .order_by(AuditLog.created_at.asc())
                    .limit(n_to_delete)
                )
                ids_to_delete = [row[0] for row in ids_result.all()]
                if ids_to_delete:
                    await self.session.execute(delete(AuditLog).where(AuditLog.id.in_(ids_to_delete)))
                    await self.session.flush()
        except Exception:
            # Pruning should never block the main action — swallow errors and proceed
            pass

        return entry

    async def get_entry(self, entry_id: str) -> AuditLog | None:
        result = await self.session.execute(
            select(AuditLog).where(AuditLog.id == entry_id)
        )
        return result.scalar_one_or_none()

    async def mark_undone(self, entry: AuditLog) -> None:
        entry.is_undone = True
        await self.session.flush()

    async def list_all_logs(self, per_user_limit: int = 10) -> list[AuditLog]:
        """Return the most recent `per_user_limit` audit entries per user."""
        # Window function to rank rows per user
        row_num = (
            func.row_number()
            .over(
                partition_by=AuditLog.user_id,
                order_by=AuditLog.created_at.desc(),
            )
            .label("rn")
        )
        subq = select(AuditLog.id, row_num).subquery()

        result = await self.session.execute(
            select(AuditLog)
            .join(subq, AuditLog.id == subq.c.id)
            .where(subq.c.rn <= per_user_limit)
            .options(selectinload(AuditLog.user))
            .order_by(AuditLog.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_user_logs(self, user_id: str, limit: int = 10) -> list[AuditLog]:
        """Return the most recent `limit` audit entries for a specific user."""
        result = await self.session.execute(
            select(AuditLog)
            .where(AuditLog.user_id == user_id)
            .options(selectinload(AuditLog.user))
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def delete_older_than(self, minutes: int = 20) -> int:
        """Delete audit log entries older than `minutes` minutes. Returns count deleted."""
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        result = await self.session.execute(
            delete(AuditLog).where(AuditLog.created_at < cutoff)
        )
        return result.rowcount  # type: ignore[return-value]
