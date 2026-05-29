import logging
from decimal import Decimal
from typing import Callable, Awaitable, Iterator

from sqlalchemy import delete as sql_delete, func, select, or_, cast, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.upload import PaymentRecord, UploadSession
from app.schemas.upload import PaymentRecordIn

# Optional progress callback: async fn(session_id, file_name, processed, total)
ProgressCallback = Callable[[str, str, int, int], Awaitable[None]] | None


class UploadRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.logger = logging.getLogger(__name__)

    async def create_session(
        self,
        user_id: str,
        file_name: str,
        records: list[PaymentRecordIn],
        on_progress: ProgressCallback = None,
    ) -> UploadSession:
        total_amount = float(sum(Decimal(str(r.payment_amount)) for r in records))
        upload = UploadSession(
            user_id=user_id,
            file_name=file_name,
            total_records=len(records),
            total_amount=total_amount,
        )
        self.session.add(upload)
        await self.session.flush()  # get the id before bulk insert

        total = len(records)
        # Batch insert using core INSERT to minimise memory (no ORM object per row)
        BATCH = 2000
        for i in range(0, total, BATCH):
            batch = records[i : i + BATCH]
            await self.session.execute(
                PaymentRecord.__table__.insert(),
                [
                    {
                        "session_id": upload.id,
                        "bank": r.bank,
                        "account": r.account,
                        "touchpoint": r.touchpoint,
                        "payment_date": r.payment_date,
                        "payment_amount": r.payment_amount,
                        "environment": r.environment,
                        "month": r.month,
                    }
                    for r in batch
                ],
            )
            if on_progress:
                await on_progress(upload.id, file_name, min(i + BATCH, total), total)
        await self.session.commit()
        await self.session.refresh(upload)
        return upload

    async def create_session_streaming(
        self,
        user_id: str,
        file_name: str,
        records: Iterator[PaymentRecordIn],
        max_records: int = 100_000,
        on_progress: ProgressCallback = None,
    ) -> UploadSession:
        """Memory-efficient variant: accepts a generator and inserts in batches of 2000.

        Only 2000 records are held in Python memory at once — suitable for 100k+
        row files on the 512 MB Render free tier.
        """
        # Use 1 as a placeholder for total_records to satisfy the DB check constraint
        # (ck_upload_sessions_total_records_positive requires total_records > 0).
        # The real value is patched in via UPDATE before the transaction commits.
        upload = UploadSession(
            user_id=user_id,
            file_name=file_name,
            total_records=1,   # placeholder
            total_amount=0.0,
        )
        self.session.add(upload)
        await self.session.flush()  # get the id before bulk insert

        BATCH = 2000
        batch: list[dict] = []
        total_records = 0
        total_amount = Decimal("0")

        for record in records:
            total_records += 1
            if total_records > max_records:
                raise ValueError(
                    f"Upload contains more than {max_records:,} records. "
                    "Please split your file into smaller chunks."
                )
            total_amount += Decimal(str(record.payment_amount))
            batch.append(
                {
                    "session_id": upload.id,
                    "bank": record.bank,
                    "account": record.account,
                    "touchpoint": record.touchpoint,
                    "payment_date": record.payment_date,
                    "payment_amount": record.payment_amount,
                    "environment": record.environment,
                    "month": record.month,
                }
            )
            if len(batch) >= BATCH:
                await self.session.execute(PaymentRecord.__table__.insert(), batch)
                batch = []
                if on_progress:
                    await on_progress(upload.id, file_name, total_records, 0)

        if batch:
            await self.session.execute(PaymentRecord.__table__.insert(), batch)

        # Rollback empty uploads before they hit the constraint on commit
        if total_records == 0:
            await self.session.rollback()
            raise ValueError("The uploaded file contains no data rows.")

        # Patch the session row with real totals now that we know them
        upload.total_records = total_records
        upload.total_amount = float(total_amount)
        await self.session.commit()
        await self.session.refresh(upload)
        return upload

    async def list_sessions(self, user_id: str) -> list[UploadSession]:
        result = await self.session.execute(
            select(UploadSession)
            .where(UploadSession.user_id == user_id)
            .order_by(UploadSession.uploaded_at.desc())
        )
        return list(result.scalars().all())

    async def list_all_sessions(self, limit: int = 500) -> list[UploadSession]:
        """Admin: list ALL upload sessions across all users, with user relationship."""
        result = await self.session.execute(
            select(UploadSession)
            .options(selectinload(UploadSession.user))
            .order_by(UploadSession.uploaded_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_session(self, session_id: str, user_id: str) -> UploadSession | None:
        result = await self.session.execute(
            select(UploadSession)
            .options(selectinload(UploadSession.records))
            .where(UploadSession.id == session_id, UploadSession.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_session_metadata(self, session_id: str, user_id: str) -> UploadSession | None:
        """Fetch session without loading records — lightweight for audit logging."""
        result = await self.session.execute(
            select(UploadSession)
            .where(UploadSession.id == session_id, UploadSession.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_record(self, record_id: str, session_id: str, user_id: str) -> PaymentRecord | None:
        """Fetch a single payment record by ID (verifies session ownership)."""
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return None
        result = await self.session.execute(
            select(PaymentRecord).where(
                PaymentRecord.id == record_id,
                PaymentRecord.session_id == session_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_records_by_ids(self, session_id: str, user_id: str, record_ids: list[str]) -> list[PaymentRecord]:
        """Fetch specific payment records by their IDs (verifies session ownership)."""
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return []
        result = await self.session.execute(
            select(PaymentRecord).where(
                PaymentRecord.session_id == session_id,
                PaymentRecord.id.in_(record_ids),
            )
        )
        return list(result.scalars().all())

    async def get_session_any_user(self, session_id: str) -> UploadSession | None:
        """Admin: get session regardless of owner."""
        result = await self.session.execute(
            select(UploadSession).where(UploadSession.id == session_id)
        )
        return result.scalar_one_or_none()

    async def delete_session(self, session_id: str, user_id: str) -> bool:
        """Delete a session owned by user_id. Returns True if deleted."""
        session = await self.session.execute(
            select(UploadSession).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        obj = session.scalar_one_or_none()
        if obj is None:
            return False
        await self.session.delete(obj)
        await self.session.commit()
        return True

    async def delete_session_admin(self, session_id: str) -> bool:
        """Admin: delete any session regardless of owner."""
        result = await self.session.execute(
            select(UploadSession).where(UploadSession.id == session_id)
        )
        obj = result.scalar_one_or_none()
        if obj is None:
            return False
        await self.session.delete(obj)
        await self.session.commit()
        return True

    async def delete_transaction(self, record_id: str, session_id: str, user_id: str) -> bool:
        """Delete a single payment record. Returns True if deleted."""
        # Verify session ownership
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return False
        result = await self.session.execute(
            select(PaymentRecord).where(
                PaymentRecord.id == record_id,
                PaymentRecord.session_id == session_id,
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            return False
        # Log deletion intent for observability
        try:
            self.logger.info("Deleting PaymentRecord id=%s session=%s user=%s", record_id, session_id, user_id)
        except Exception:
            pass
        await self.session.delete(record)
        # Update session totals
        await self._update_session_totals(session_id)
        await self.session.commit()
        return True

    async def create_transaction(
        self, session_id: str, user_id: str,
        bank: str, account: str, payment_amount: float,
        touchpoint: str | None = None, payment_date: str | None = None,
        environment: str | None = None, month: str | None = None,
    ) -> PaymentRecord | None:
        """Add a single payment record to an existing session. Returns the new record or None."""
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return None
        record = PaymentRecord(
            session_id=session_id,
            bank=bank,
            account=account,
            payment_amount=payment_amount,
            touchpoint=touchpoint,
            payment_date=payment_date,
            environment=environment,
            month=month,
        )
        self.session.add(record)
        await self._update_session_totals(session_id)
        await self.session.commit()
        await self.session.refresh(record)
        return record

    async def update_transaction(
        self, record_id: str, session_id: str, user_id: str,
        bank: str, account: str, payment_amount: float,
        touchpoint: str | None = None, payment_date: str | None = None,
        environment: str | None = None, month: str | None = None,
    ) -> PaymentRecord | None:
        """Update fields on a single payment record. Returns updated record or None."""
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return None
        result = await self.session.execute(
            select(PaymentRecord).where(
                PaymentRecord.id == record_id,
                PaymentRecord.session_id == session_id,
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            return None
        record.bank = bank
        record.account = account
        record.payment_amount = payment_amount
        record.touchpoint = touchpoint
        record.payment_date = payment_date
        record.environment = environment
        record.month = month
        await self._update_session_totals(session_id)
        await self.session.commit()
        return record

    async def delete_transactions_bulk(
        self, session_id: str, user_id: str, record_ids: list[str]
    ) -> int:
        """Delete multiple payment records by ID in a single operation. Returns count deleted."""
        if not record_ids:
            return 0
        # Verify session ownership
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return 0
        # Bulk delete in a single statement
        result = await self.session.execute(
            sql_delete(PaymentRecord).where(
                PaymentRecord.session_id == session_id,
                PaymentRecord.id.in_(record_ids),
            )
        )
        count = result.rowcount
        if count > 0:
            await self._update_session_totals(session_id)
            await self.session.flush()
            await self.session.commit()
        return count

    async def delete_transactions_by_date_range(
        self, session_id: str, user_id: str, date_from: str, date_to: str
    ) -> int:
        """Delete payment records within a date range. Returns count of deleted records."""
        # Verify session ownership
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return 0
        # Count records to delete
        count_result = await self.session.execute(
            select(func.count(PaymentRecord.id)).where(
                PaymentRecord.session_id == session_id,
                PaymentRecord.payment_date >= date_from,
                PaymentRecord.payment_date <= date_to,
            )
        )
        count = count_result.scalar() or 0
        if count == 0:
            return 0
        # Delete
        await self.session.execute(
            sql_delete(PaymentRecord).where(
                PaymentRecord.session_id == session_id,
                PaymentRecord.payment_date >= date_from,
                PaymentRecord.payment_date <= date_to,
            )
        )
        # Update session totals
        await self._update_session_totals(session_id)
        await self.session.commit()
        return count

    async def _update_session_totals(self, session_id: str) -> None:
        """Recalculate and update session totals after record deletions.

        If all records are deleted the session is also deleted to satisfy the
        DB-level CHECK constraint (total_records > 0) added in migration 004.
        """
        agg = await self.session.execute(
            select(
                func.count(PaymentRecord.id),
                func.coalesce(func.sum(PaymentRecord.payment_amount), 0),
            ).where(PaymentRecord.session_id == session_id)
        )
        total_records, total_amount = agg.one()
        upload = await self.session.get(UploadSession, session_id)
        if upload:
            if total_records == 0:
                # Deleting the session also cascade-deletes any remaining records.
                await self.session.delete(upload)
            else:
                upload.total_records = total_records
                upload.total_amount = float(total_amount)

    async def get_transactions(
        self,
        session_id: str,
        user_id: str,
        bank: str | None = None,
        touchpoint: str | None = None,
        search: str | None = None,
        payment_date: str | None = None,
        environment: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> tuple[int, float, list[PaymentRecord]]:
        # Verify the session belongs to this user
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return 0, 0.0, []

        query = select(PaymentRecord).where(PaymentRecord.session_id == session_id)

        if bank:
            query = query.where(PaymentRecord.bank == bank)
        if touchpoint:
            query = query.where(PaymentRecord.touchpoint == touchpoint)
        if payment_date:
            query = query.where(PaymentRecord.payment_date == payment_date)
        if date_from:
            query = query.where(PaymentRecord.payment_date >= date_from)
        if date_to:
            query = query.where(PaymentRecord.payment_date <= date_to)
        if environment:
            query = query.where(PaymentRecord.environment == environment)
        if search:
            # Escape ILIKE metacharacters to prevent wildcard abuse / slow queries
            safe_search = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{safe_search}%"
            query = query.where(
                or_(
                    PaymentRecord.bank.ilike(pattern),
                    PaymentRecord.account.ilike(pattern),
                    PaymentRecord.touchpoint.ilike(pattern),
                    PaymentRecord.payment_date.ilike(pattern),
                    PaymentRecord.environment.ilike(pattern),
                    cast(PaymentRecord.payment_amount, String).ilike(pattern),
                )
            )

        # Total count and total amount for the filtered set
        sub = query.subquery()
        agg_result = await self.session.execute(
            select(func.count(), func.coalesce(func.sum(sub.c.payment_amount), 0)).select_from(sub)
        )
        total, total_amount = agg_result.one()

        # Paginated results
        offset = (page - 1) * page_size
        query = query.order_by(PaymentRecord.payment_date.desc()).offset(offset).limit(page_size)
        result = await self.session.execute(query)
        return total, float(total_amount), list(result.scalars().all())

    async def get_all_records_for_export(
        self, session_id: str, user_id: str
    ) -> list[PaymentRecord]:
        """Fetch ALL records for a session in a single query (no pagination). Used for exports."""
        # Verify session ownership
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return []
        result = await self.session.execute(
            select(PaymentRecord)
            .where(PaymentRecord.session_id == session_id)
            .order_by(PaymentRecord.payment_date.desc())
        )
        return list(result.scalars().all())

    async def stream_records_for_export(
        self, session_id: str, user_id: str, batch_size: int = 1000
    ):
        """Yield PaymentRecord objects in batches for memory-efficient streaming exports.
        Uses server-side cursor via yield_per to avoid loading all records into RAM.
        """
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return
        result = await self.session.stream_scalars(
            select(PaymentRecord)
            .where(PaymentRecord.session_id == session_id)
            .order_by(PaymentRecord.payment_date.desc())
            .execution_options(yield_per=batch_size)
        )
        async for record in result:
            yield record

    async def get_records_limited(
        self, session_id: str, user_id: str, limit: int
    ) -> list[PaymentRecord]:
        """Fetch up to *limit* records for the GET /{session_id} detail endpoint.

        Avoids the OOM that occurs when 100k-row sessions are eagerly loaded via
        selectinload on Render's 512 MB free tier.
        """
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return []
        result = await self.session.execute(
            select(PaymentRecord)
            .where(PaymentRecord.session_id == session_id)
            .order_by(PaymentRecord.payment_date.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_accounts_summary(
        self,
        session_id: str,
        user_id: str,
        search: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        page: int = 1,
        page_size: int = 25,
    ) -> tuple[int, list[dict]]:
        """Return paginated, filtered per-account aggregates computed fully in SQL.

        Uses GROUP BY so that no record rows are loaded into Python memory —
        safe for sessions of any size on the 512 MB Render free tier.

        Returns (total_accounts, page_of_accounts).
        """
        session_check = await self.session.execute(
            select(UploadSession.id).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        if not session_check.scalar_one_or_none():
            return 0, []

        base_conditions = [PaymentRecord.session_id == session_id]
        if date_from:
            base_conditions.append(PaymentRecord.payment_date >= date_from)
        if date_to:
            base_conditions.append(PaymentRecord.payment_date <= date_to)

        # Select appropriate string aggregation function depending on database dialect (Postgres vs MySQL/SQLite)
        if self.session.bind.dialect.name == "postgresql":
            banks_agg = func.string_agg(func.distinct(PaymentRecord.bank), cast(", ", String))
        else:
            banks_agg = func.group_concat(func.distinct(PaymentRecord.bank))

        # Build the grouped subquery first, then apply HAVING-style search on the account name
        agg_query = (
            select(
                PaymentRecord.account,
                func.sum(PaymentRecord.payment_amount).label("total_amount"),
                func.count(PaymentRecord.id).label("payment_count"),
                func.count(func.distinct(PaymentRecord.bank)).label("bank_count"),
                banks_agg.label("banks"),
            )
            .where(*base_conditions)
            .group_by(PaymentRecord.account)
        )

        if search:
            safe_search = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            agg_query = agg_query.having(
                PaymentRecord.account.ilike(f"%{safe_search}%")
            )

        # Total count of matching account groups
        count_sub = agg_query.subquery()
        count_result = await self.session.execute(
            select(func.count()).select_from(count_sub)
        )
        total_accounts = count_result.scalar_one()

        # Paginated results ordered by total_amount desc
        offset = (page - 1) * page_size
        agg_query = agg_query.order_by(func.sum(PaymentRecord.payment_amount).desc()).offset(offset).limit(page_size)
        rows = await self.session.execute(agg_query)
        return total_accounts, [
            {
                "account": r.account,
                "total_amount": float(r.total_amount or 0),
                "payment_count": r.payment_count,
                "bank_count": r.bank_count,
                "banks": r.banks or "",
            }
            for r in rows.all()
        ]

    async def get_dashboard_summary(self, session_id: str, user_id: str, date_from: str | None = None, date_to: str | None = None) -> dict | None:
        # Verify session ownership
        session_check = await self.session.execute(
            select(UploadSession).where(
                UploadSession.id == session_id,
                UploadSession.user_id == user_id,
            )
        )
        upload = session_check.scalar_one_or_none()
        if not upload:
            return None

        # Build optional date filter conditions
        date_conditions = []
        if date_from:
            date_conditions.append(PaymentRecord.payment_date >= date_from)
        if date_to:
            date_conditions.append(PaymentRecord.payment_date <= date_to)

        # Bank breakdown (also used to derive totals — one query instead of two)
        bank_rows = await self.session.execute(
            select(
                PaymentRecord.bank,
                func.count(PaymentRecord.id).label("payment_count"),
                func.count(func.distinct(PaymentRecord.account)).label("account_count"),
                func.sum(PaymentRecord.payment_amount).label("total_amount"),
            )
            .where(PaymentRecord.session_id == session_id, *date_conditions)
            .group_by(PaymentRecord.bank)
            .order_by(func.sum(PaymentRecord.payment_amount).desc())
        )
        bank_rows_list = bank_rows.all()
        total_amount = float(sum(r.total_amount or 0.0 for r in bank_rows_list))
        total_payments_from_banks = sum(r.payment_count for r in bank_rows_list)

        # Get accurate totals (accounts deduplicated across banks, total payments)
        totals = await self.session.execute(
            select(
                func.count(PaymentRecord.id),
                func.count(func.distinct(PaymentRecord.account)),
            ).where(PaymentRecord.session_id == session_id, *date_conditions)
        )
        total_payments, total_accounts = totals.one()
        total_payments = total_payments or total_payments_from_banks

        banks = [
            {
                "bank": row.bank,
                "payment_count": row.payment_count,
                "account_count": row.account_count,
                "total_amount": float(row.total_amount or 0.0),
                "percentage": round(float(row.total_amount or 0.0) / total_amount * 100, 2) if total_amount else 0,
            }
            for row in bank_rows_list
        ]

        # Touchpoint breakdown
        tp_rows = await self.session.execute(
            select(
                PaymentRecord.touchpoint,
                func.count(PaymentRecord.id).label("count"),
                func.sum(PaymentRecord.payment_amount).label("total_amount"),
            )
            .where(PaymentRecord.session_id == session_id, *date_conditions)
            .group_by(PaymentRecord.touchpoint)
            .order_by(func.count(PaymentRecord.id).desc())
        )
        touchpoints = [
            {
                "touchpoint": row.touchpoint or "Unknown",
                "count": row.count,
                "total_amount": row.total_amount or 0.0,
                "percentage": round(row.count / total_payments * 100, 2) if total_payments else 0,
            }
            for row in tp_rows.all()
        ]

        # Combined query: env, bank, touchpoint, payment_date in one pass.
        # Environment/bank/touchpoint metadata is fetched WITHOUT date_conditions
        # so filter dropdowns always show all available options in the dataset.
        # The dates list IS filtered by date_conditions so it only shows dates
        # within the selected range.
        combo_rows = await self.session.execute(
            select(
                PaymentRecord.environment,
                PaymentRecord.bank,
                PaymentRecord.touchpoint,
                PaymentRecord.payment_date,
            )
            .where(PaymentRecord.session_id == session_id)
            .distinct()
            .order_by(PaymentRecord.environment, PaymentRecord.bank, PaymentRecord.touchpoint, PaymentRecord.payment_date)
        )
        # Fetch dates separately with date_conditions applied so the dates list
        # reflects only the currently selected date range.
        dates_rows = await self.session.execute(
            select(PaymentRecord.payment_date)
            .where(PaymentRecord.session_id == session_id, *date_conditions)
            .where(PaymentRecord.payment_date.isnot(None))
            .distinct()
        )
        env_map_build: dict[str, dict[str, set[str]]] = {}
        environments_set: set[str] = set()
        for env, bank, touchpoint, _payment_date in combo_rows.all():
            if env is not None:
                environments_set.add(env)
                if env not in env_map_build:
                    env_map_build[env] = {}
                if bank not in env_map_build[env]:
                    env_map_build[env][bank] = set()
                if touchpoint:
                    env_map_build[env][bank].add(touchpoint)
        # Build dates list from the date-filtered query
        dates_set: set[str] = set()
        for (payment_date,) in dates_rows.all():
            if payment_date:
                dates_set.add(payment_date)
        dates = sorted(dates_set)
        environments = sorted(environments_set)

        environment_map = [
            {
                "environment": env,
                "banks": sorted(banks_dict.keys()),
                "touchpoints_by_bank": {
                    bank: sorted(tps)
                    for bank, tps in banks_dict.items()
                },
            }
            for env, banks_dict in sorted(env_map_build.items())
        ]

        # Monthly trend: sum of payment_amount grouped by year-month (first 7 chars of payment_date)
        from sqlalchemy import literal_column
        month_expr = literal_column("LEFT(payment_records.payment_date, 7)")
        monthly_rows = await self.session.execute(
            select(
                month_expr.label("month"),
                func.sum(PaymentRecord.payment_amount).label("amount"),
            )
            .where(PaymentRecord.session_id == session_id, *date_conditions)
            .where(PaymentRecord.payment_date.isnot(None))
            .where(func.length(PaymentRecord.payment_date) >= 7)
            .group_by(month_expr)
            .order_by(month_expr)
        )
        monthly_trend = [
            {"month": row.month, "amount": float(row.amount or 0)}
            for row in monthly_rows.all()
        ]

        # Bank × touchpoint × environment matrix (enables accurate cross-dimensional filtering on the frontend)
        matrix_rows = await self.session.execute(
            select(
                PaymentRecord.bank,
                PaymentRecord.touchpoint,
                PaymentRecord.environment,
                func.count(PaymentRecord.id).label("count"),
                func.sum(PaymentRecord.payment_amount).label("total_amount"),
                func.count(func.distinct(PaymentRecord.account)).label("account_count"),
            )
            .where(PaymentRecord.session_id == session_id, *date_conditions)
            .group_by(PaymentRecord.bank, PaymentRecord.touchpoint, PaymentRecord.environment)
            .order_by(PaymentRecord.bank, PaymentRecord.touchpoint, PaymentRecord.environment)
        )
        bank_touchpoint_matrix = [
            {
                "bank": row.bank or "Unknown",
                "touchpoint": row.touchpoint or "Unknown",
                "environment": row.environment or "Unknown",
                "count": row.count,
                "total_amount": float(row.total_amount or 0.0),
                "account_count": row.account_count,
            }
            for row in matrix_rows.all()
        ]

        return {
            "total_payments": total_payments or 0,
            "total_amount": total_amount,
            "total_accounts": total_accounts or 0,
            "total_banks": len(banks),
            "banks": banks,
            "touchpoints": touchpoints,
            "dates": dates,
            "environments": environments,
            "environment_map": environment_map,
            "monthly_trend": monthly_trend,
            "bank_touchpoint_matrix": bank_touchpoint_matrix,
            "session_id": session_id,
        }
