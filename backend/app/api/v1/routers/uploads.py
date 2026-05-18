import json
import csv
import io
import re
import uuid
from decimal import Decimal
from typing import AsyncIterator


class _DecimalEncoder(json.JSONEncoder):
    def default(self, o: object) -> object:
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.dependencies.auth import get_current_user
from app.core.cache import cache_get, cache_set, cache_invalidate
from app.api.v1.routers.events import broadcast_new_upload, broadcast_upload_progress
from app.db.session import get_db
from app.models.user import User
from app.models.upload import UploadSession, PaymentRecord
from app.repositories.audit_log_repository import AuditLogRepository
from app.repositories.upload_repository import UploadRepository
from app.schemas.upload import (
    AuditLogEntry,
    BulkDeleteRequest,
    DashboardSummary,
    PaginatedTransactions,
    PaymentRecordIn,
    PaymentRecordOut,
    UnifiedAuditLogEntry,
    UploadSessionCreate,
    UploadSessionDetail,
    UploadSessionOut,
    AuditLogCreate,
    AccountsSummaryResponse,
    AccountSummary,
    MAX_DETAIL_RECORDS,
)

router = APIRouter(prefix="/uploads", tags=["Uploads"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@router.post("", response_model=UploadSessionOut, status_code=status.HTTP_201_CREATED)
async def create_upload(
    payload: UploadSessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UploadSessionOut:
    """Save an uploaded dataset (records parsed from Excel/CSV on the frontend)."""
    if not payload.records:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded dataset contains no data rows.",
        )
    repo = UploadRepository(db)
    audit_repo = AuditLogRepository(db)

    # Wrap the progress callback to capture the current user's ID so SSE
    # events are only sent to this user's connected clients.
    uid = current_user.id
    async def _progress(sid: str, fname: str, processed: int, total: int) -> None:
        await broadcast_upload_progress(sid, fname, processed, total, user_id=uid)

    session = await repo.create_session(
        user_id=current_user.id,
        file_name=payload.file_name,
        records=payload.records,
        on_progress=_progress,
    )
    await audit_repo.log_action(
        user_id=current_user.id,
        action="file_upload",
        file_name=payload.file_name,
        session_id=session.id,
        record_count=session.total_records,
        total_amount=session.total_amount,
    )
    # Notify only this user's SSE clients
    await broadcast_new_upload(session.id, session.file_name, user_id=current_user.id)
    return UploadSessionOut.model_validate(session)


MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB (supports large XLSX/CSV files with 100k+ records)
ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".csv"}


@router.post("/file", response_model=UploadSessionOut, status_code=status.HTTP_201_CREATED)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UploadSessionOut:
    """
    Upload an Excel/CSV file for server-side streaming parse.

    The file is parsed row-by-row using openpyxl read-only mode and inserted
    in batches of 2000 — only ~2000 records are in Python memory at any time,
    making it safe for 100k+ row files on the 512 MB Render free tier.
    SSE progress events are broadcast during batch inserts.
    """
    import os
    from app.utils.file_parser import stream_xlsx, stream_csv
    from app.schemas.upload import MAX_RECORDS_PER_FILE_UPLOAD

    file_name = file.filename or "upload"
    ext = os.path.splitext(file_name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Read file with size guard
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {MAX_UPLOAD_SIZE // (1024 * 1024)} MB limit.",
        )

    # Stream-parse into records (generator — NOT materialised into a list)
    record_stream = stream_csv(contents) if ext == ".csv" else stream_xlsx(contents)

    repo = UploadRepository(db)
    audit_repo = AuditLogRepository(db)

    # Wrap progress callback to scope SSE events to this user only
    uid = current_user.id
    async def _progress(sid: str, fname: str, processed: int, total: int) -> None:
        await broadcast_upload_progress(sid, fname, processed, total, user_id=uid)

    try:
        session = await repo.create_session_streaming(
            user_id=current_user.id,
            file_name=file_name,
            records=record_stream,
            max_records=MAX_RECORDS_PER_FILE_UPLOAD,
            on_progress=_progress,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    if session.total_records == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file contains no data rows.",
        )

    await audit_repo.log_action(
        user_id=current_user.id,
        action="file_upload",
        file_name=file_name,
        session_id=session.id,
        record_count=session.total_records,
        total_amount=session.total_amount,
    )
    await broadcast_new_upload(session.id, session.file_name, user_id=current_user.id)
    return UploadSessionOut.model_validate(session)


@router.get("", response_model=list[UploadSessionOut])
async def list_uploads(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UploadSessionOut]:
    """List all upload sessions for the current user."""
    repo = UploadRepository(db)
    sessions = await repo.list_sessions(user_id=current_user.id)
    return [UploadSessionOut.model_validate(s) for s in sessions]


@router.get("/unified-audit-log", response_model=list[UnifiedAuditLogEntry])
async def get_unified_audit_log(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UnifiedAuditLogEntry]:
    """List file actions for the current user (up to 50 entries)."""
    audit_repo = AuditLogRepository(db)
    logs = await audit_repo.list_user_logs(current_user.id, limit=50)

    # Actions that support undo — must match branches in undo_audit_entry
    _UNDOABLE_ACTIONS = {"file_upload", "file_delete", "record_delete", "record_bulk_delete", "record_create", "record_update"}
    # Determine which entries can be undone: 10 most recent non-undone entries that have snapshot_data
    undoable_ids: set[str] = set()
    count = 0
    for log in logs:  # already sorted by created_at desc
        if count >= 10:
            break
        if not log.is_undone and log.snapshot_data and log.action in _UNDOABLE_ACTIONS:
            undoable_ids.add(log.id)
            count += 1

    return [
        UnifiedAuditLogEntry(
            id=log.id,
            user_id=log.user_id or "unknown",
            user_email=log.user.email if log.user else "unknown",
            user_name=log.user.full_name if log.user else "unknown",
            action=log.action,
            file_name=log.file_name,
            session_id=log.session_id,
            record_count=log.record_count,
            total_amount=log.total_amount,
            details=log.details,
            is_undone=log.is_undone,
            can_undo=log.id in undoable_ids,
            created_at=log.created_at,
        )
        for log in logs
    ]


@router.get("/{session_id}", response_model=UploadSessionDetail)
async def get_upload(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UploadSessionDetail:
    """Get a single upload session with up to MAX_DETAIL_RECORDS records inline.

    For sessions larger than MAX_DETAIL_RECORDS, records are truncated and
    records_truncated=True is set in the response.  Full data is always
    available via /transactions (paginated) and /accounts-summary (aggregated).
    """
    repo = UploadRepository(db)
    session = await repo.get_session_metadata(session_id=session_id, user_id=current_user.id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found.")
    # Recompute total from SQL SUM (exact on NUMERIC columns) instead of
    # relying on the stored value which may have floating-point drift.
    from sqlalchemy import func as sa_func, select as sa_select
    from app.models.upload import PaymentRecord
    agg = await db.execute(
        sa_select(sa_func.coalesce(sa_func.sum(PaymentRecord.payment_amount), 0))
        .where(PaymentRecord.session_id == session_id)
    )
    session.total_amount = float(agg.scalar_one())

    # Load records with a hard cap to avoid OOM on large sessions
    truncated = session.total_records > MAX_DETAIL_RECORDS
    records = await repo.get_records_limited(
        session_id=session_id,
        user_id=current_user.id,
        limit=MAX_DETAIL_RECORDS,
    )
    result = UploadSessionDetail(
        id=str(session.id),
        user_id=str(session.user_id),
        file_name=session.file_name,
        total_records=session.total_records,
        total_amount=session.total_amount,
        uploaded_at=session.uploaded_at,
        records=[PaymentRecordOut.model_validate(r) for r in records],
        records_truncated=truncated,
    )
    return result


@router.get("/{session_id}/accounts-summary", response_model=AccountsSummaryResponse)
async def get_accounts_summary(
    session_id: str,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    page: int = 1,
    page_size: int = 25,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AccountsSummaryResponse:
    """Return paginated, filtered per-account aggregates computed fully in SQL.

    Memory-safe for any dataset size — no record rows are loaded into Python.
    Used by the Customers page to show account-level analytics.
    """
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        raise HTTPException(status_code=422, detail="page_size must be between 1 and 200.")
    repo = UploadRepository(db)
    session = await repo.get_session_metadata(session_id=session_id, user_id=current_user.id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found.")
    total_accounts, rows = await repo.get_accounts_summary(
        session_id=session_id,
        user_id=current_user.id,
        search=search,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    return AccountsSummaryResponse(
        session_id=session_id,
        total_accounts=total_accounts,
        total_records=session.total_records,
        page=page,
        page_size=page_size,
        accounts=[AccountSummary(**r) for r in rows],
    )


@router.get("/{session_id}/transactions", response_model=PaginatedTransactions)
async def get_transactions(
    session_id: str,
    bank: str | None = None,
    touchpoint: str | None = None,
    search: str | None = None,
    payment_date: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    environment: str | None = None,
    page: int = 1,
    page_size: int = 25,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PaginatedTransactions:
    """Get paginated, filtered payment records for an upload session."""
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        raise HTTPException(status_code=422, detail="page_size must be between 1 and 200.")

    repo = UploadRepository(db)
    total, total_amount, records = await repo.get_transactions(
        session_id=session_id,
        user_id=current_user.id,
        bank=bank,
        touchpoint=touchpoint,
        search=search,
        payment_date=payment_date,
        date_from=date_from,
        date_to=date_to,
        environment=environment,
        page=page,
        page_size=page_size,
    )
    return PaginatedTransactions(
        total=total,
        total_amount=total_amount,
        page=page,
        page_size=page_size,
        items=[PaymentRecordOut.model_validate(r) for r in records],
    )


@router.get("/{session_id}/export/records", response_model=list[PaymentRecordOut])
async def export_all_records(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PaymentRecordOut]:
    """Return ALL payment records for a session in a single response (no pagination).
    Intended for client-side export. Use /transactions for normal paginated access.
    Hard-capped at 500,000 records to prevent OOM on the server."""
    _EXPORT_RECORD_LIMIT = 500_000
    repo = UploadRepository(db)
    # Check session metadata first to enforce cap without loading records
    session_meta = await repo.get_session_metadata(session_id, current_user.id)
    if not session_meta:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found.")
    if session_meta.total_records > _EXPORT_RECORD_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Session contains {session_meta.total_records:,} records which exceeds the export limit "
                f"of {_EXPORT_RECORD_LIMIT:,}."
            ),
        )
    records = await repo.get_all_records_for_export(session_id, current_user.id)
    return [PaymentRecordOut.model_validate(r) for r in records]


@router.get("/{session_id}/export/csv", response_class=StreamingResponse)
async def export_records_csv_stream(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream ALL payment records for a session as a CSV file.
    Uses server-side cursor streaming — safe for sessions with millions of records
    since data is never fully loaded into memory.
    """
    repo = UploadRepository(db)
    session_meta = await repo.get_session_metadata(session_id, current_user.id)
    if not session_meta:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found.")

    safe_name = re.sub(r"[^\w\-.]", "_", session_meta.file_name or "export")

    async def csv_row_generator() -> AsyncIterator[str]:
        # Write CSV header
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["Bank", "Account", "Touchpoint", "Payment Date", "Payment Amount", "Environment"])
        yield buf.getvalue()

        # Stream rows in batches
        async for record in repo.stream_records_for_export(session_id, current_user.id):
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow([
                record.bank,
                record.account,
                record.touchpoint or "",
                record.payment_date or "",
                float(record.payment_amount),
                record.environment or "",
            ])
            yield buf.getvalue()

    return StreamingResponse(
        csv_row_generator(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'},
    )


@router.get("/{session_id}/dashboard", response_model=DashboardSummary)
async def get_dashboard(
    session_id: str,
    date_from: str | None = Query(default=None, description="Filter records from this date (YYYY-MM-DD)"),
    date_to: str | None = Query(default=None, description="Filter records up to this date (YYYY-MM-DD)"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DashboardSummary:
    """Get aggregated KPI summary for an upload session (cached 5 min)."""
    # Include user_id in the cache key so one user can never read another
    # user's cached dashboard data even if they somehow know the session_id.
    cache_key = f"dashboard:{current_user.id}:{session_id}:{date_from or ''}:{date_to or ''}"
    cached = cache_get(cache_key)
    if cached is not None:
        return DashboardSummary(**cached)

    repo = UploadRepository(db)
    summary = await repo.get_dashboard_summary(session_id=session_id, user_id=current_user.id, date_from=date_from, date_to=date_to)
    if not summary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found.")
    # Use shorter TTL for filtered queries since they are more specific
    cache_set(cache_key, summary, ttl=300 if (date_from or date_to) else 1800)
    return DashboardSummary(**summary)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_upload(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an upload session. Admins can delete any session; users can only delete their own."""
    repo = UploadRepository(db)
    audit_repo = AuditLogRepository(db)

    # Fetch session metadata only (no records) to avoid OOM on large datasets
    if current_user.is_superuser:
        session_obj = await repo.get_session_any_user(session_id)
    else:
        # Use a lightweight query — do NOT load records
        session_obj = await repo.get_session_any_user(session_id)
        if session_obj and session_obj.user_id != current_user.id:
            session_obj = None

    if not session_obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Upload session not found or you are not authorized to delete it.",
        )

    # Build snapshot that includes individual records so the undo can fully restore them.
    # For large datasets (>5,000 records) we skip the record snapshot to avoid OOM —
    # undo will be disabled for those entries.
    _SNAPSHOT_RECORD_LIMIT = 5_000
    records_for_snapshot: list[dict] = []
    if session_obj.total_records <= _SNAPSHOT_RECORD_LIMIT:
        all_records = await repo.get_all_records_for_export(session_id, session_obj.user_id)
        records_for_snapshot = [
            {
                "id": r.id,
                "bank": r.bank,
                "account": r.account,
                "touchpoint": r.touchpoint,
                "payment_date": r.payment_date,
                "payment_amount": r.payment_amount,
                "environment": r.environment,
                "month": r.month,
            }
            for r in all_records
        ]

    snapshot = json.dumps({
        "session": {
            "id": session_obj.id,
            "user_id": session_obj.user_id,
            "file_name": session_obj.file_name,
            "total_records": session_obj.total_records,
            "total_amount": session_obj.total_amount,
        },
        "records": records_for_snapshot,
        # Empty records list means undo is not available (dataset was too large)
        "undo_available": len(records_for_snapshot) == session_obj.total_records,
    }, cls=_DecimalEncoder)

    # Log the deletion before actually deleting
    await audit_repo.log_action(
        user_id=current_user.id,
        action="file_delete",
        file_name=session_obj.file_name,
        session_id=session_obj.id,
        record_count=session_obj.total_records,
        total_amount=session_obj.total_amount,
        snapshot_data=snapshot,
    )

    if current_user.is_superuser:
        await repo.delete_session_admin(session_id)
    else:
        await repo.delete_session(session_id, current_user.id)
    cache_invalidate(f"dashboard:{session_id}")


@router.post("/{session_id}/transactions", response_model=PaymentRecordOut, status_code=status.HTTP_201_CREATED)
async def create_transaction(
    session_id: str,
    payload: PaymentRecordIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PaymentRecordOut:
    """Add a single transaction record to an existing upload session."""
    repo = UploadRepository(db)
    record = await repo.create_transaction(
        session_id=session_id,
        user_id=current_user.id,
        bank=payload.bank,
        account=payload.account,
        payment_amount=payload.payment_amount,
        touchpoint=payload.touchpoint,
        payment_date=payload.payment_date,
        environment=payload.environment,
        month=payload.month,
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload session not found.")
    # Log creation of a single record
    audit_repo = AuditLogRepository(db)
    session_obj = await repo.get_session_metadata(session_id, current_user.id)
    # compact snapshot of the created record
    snapshot = json.dumps({
        "session_id": session_id,
        "record": {
            "id": getattr(record, "id", None),
            "bank": record.bank,
            "account": record.account,
            "touchpoint": record.touchpoint,
            "payment_date": record.payment_date,
            "payment_amount": record.payment_amount,
            "environment": record.environment,
        },
    }, cls=_DecimalEncoder)

    await audit_repo.log_action(
        user_id=current_user.id,
        action="record_create",
        file_name=session_obj.file_name if session_obj else "unknown",
        session_id=session_id,
        record_count=1,
        details=f"Created record {getattr(record, 'id', 'unknown')}",
        snapshot_data=snapshot,
    )
    cache_invalidate(f"dashboard:{session_id}")
    return PaymentRecordOut.model_validate(record)


@router.put("/{session_id}/transactions/{record_id}", response_model=PaymentRecordOut)
async def update_transaction(
    session_id: str,
    record_id: str,
    payload: PaymentRecordIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PaymentRecordOut:
    """Update a single transaction record."""
    repo = UploadRepository(db)
    # Capture existing record snapshot (compact) before update
    before_record = await repo.get_record(record_id, session_id, current_user.id)
    before_rec = None
    if before_record:
        before_rec = {
            "id": before_record.id,
            "bank": before_record.bank,
            "account": before_record.account,
            "touchpoint": before_record.touchpoint,
            "payment_date": before_record.payment_date,
            "payment_amount": before_record.payment_amount,
            "environment": before_record.environment,
            "month": before_record.month,
        }

    updated = await repo.update_transaction(
        record_id=record_id,
        session_id=session_id,
        user_id=current_user.id,
        bank=payload.bank,
        account=payload.account,
        payment_amount=payload.payment_amount,
        touchpoint=payload.touchpoint,
        payment_date=payload.payment_date,
        environment=payload.environment,
        month=payload.month,
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found.")
    # Log update of a single record
    audit_repo = AuditLogRepository(db)
    # compact snapshot containing before and after
    after_rec = {
        "id": getattr(updated, "id", None),
        "bank": updated.bank,
        "account": updated.account,
        "touchpoint": updated.touchpoint,
        "payment_date": updated.payment_date,
        "payment_amount": updated.payment_amount,
        "environment": updated.environment,
        "month": updated.month,
    }
    snapshot = json.dumps({"session_id": session_id, "before": before_rec, "after": after_rec}, cls=_DecimalEncoder)
    session_obj = await repo.get_session_metadata(session_id, current_user.id)
    await audit_repo.log_action(
        user_id=current_user.id,
        action="record_update",
        file_name=session_obj.file_name if session_obj else "unknown",
        session_id=session_id,
        record_count=1,
        details=f"Updated record {record_id}",
        snapshot_data=snapshot,
    )
    cache_invalidate(f"dashboard:{session_id}")
    return PaymentRecordOut.model_validate(updated)


@router.post("/{session_id}/transactions/bulk-delete", status_code=status.HTTP_200_OK)
async def bulk_delete_transactions(
    session_id: str,
    payload: BulkDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete multiple transaction records by ID in a single operation."""
    if not payload.ids:
        return {"deleted": 0}
    repo = UploadRepository(db)
    audit_repo = AuditLogRepository(db)

    # Get session info for audit log
    session_obj = await repo.get_session_metadata(session_id, current_user.id)
    if not session_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    # Fetch only the specific records being deleted (not all records)
    matching_records = await repo.get_records_by_ids(session_id, current_user.id, payload.ids)
    snapshot = None
    if matching_records:
        snapshot = json.dumps({
            "session_id": session_id,
            "records": [
                {
                    "id": r.id,
                    "bank": r.bank,
                    "account": r.account,
                    "touchpoint": r.touchpoint,
                    "payment_date": r.payment_date,
                    "payment_amount": r.payment_amount,
                    "environment": r.environment,
                }
                for r in matching_records
            ],
        }, cls=_DecimalEncoder)

    count = await repo.delete_transactions_bulk(
        session_id=session_id, user_id=current_user.id, record_ids=payload.ids
    )

    if count > 0:
        await audit_repo.log_action(
            user_id=current_user.id,
            action="record_bulk_delete",
            file_name=session_obj.file_name,
            session_id=session_id,
            record_count=count,
            details=f"Bulk deleted {count} records by ID",
            snapshot_data=snapshot,
        )

    cache_invalidate(f"dashboard:{session_id}")
    return {"deleted": count}


@router.delete("/{session_id}/transactions/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transaction(
    session_id: str,
    record_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a single transaction record."""
    repo = UploadRepository(db)
    audit_repo = AuditLogRepository(db)

    # Fetch only the specific record (not all records)
    target_record = await repo.get_record(record_id, session_id, current_user.id)
    session_obj = await repo.get_session_metadata(session_id, current_user.id)
    if not session_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found.")

    snapshot = None
    if target_record:
        snapshot = json.dumps({
            "session_id": session_id,
            "record": {
                "id": target_record.id,
                "bank": target_record.bank,
                "account": target_record.account,
                "touchpoint": target_record.touchpoint,
                "payment_date": target_record.payment_date,
                "payment_amount": target_record.payment_amount,
                "environment": target_record.environment,
            },
        }, cls=_DecimalEncoder)

    deleted = await repo.delete_transaction(record_id=record_id, session_id=session_id, user_id=current_user.id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transaction not found.")

    await audit_repo.log_action(
        user_id=current_user.id,
        action="record_delete",
        file_name=session_obj.file_name,
        session_id=session_id,
        record_count=1,
        details=f"Deleted record {record_id}",
        snapshot_data=snapshot,
    )
    cache_invalidate(f"dashboard:{session_id}")


@router.delete("/{session_id}/transactions", status_code=status.HTTP_200_OK)
async def delete_transactions_by_date_range(
    session_id: str,
    date_from: str = "",
    date_to: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mass delete transactions within a date range. Returns count of deleted records."""
    if not date_from or not date_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date_from and date_to are required.")
    if not _DATE_RE.match(date_from) or not _DATE_RE.match(date_to):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date_from and date_to must be in YYYY-MM-DD format.",
        )
    if date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date_from must not be later than date_to.",
        )
    repo = UploadRepository(db)
    audit_repo = AuditLogRepository(db)

    # Lightweight session check (no records loaded)
    session_obj = await repo.get_session_metadata(session_id, current_user.id)
    if not session_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    # Lightweight snapshot — just metadata about the date range (avoids loading all records)
    count = await repo.delete_transactions_by_date_range(
        session_id=session_id, user_id=current_user.id, date_from=date_from, date_to=date_to
    )

    if count > 0:
        snapshot = json.dumps({
            "session_id": session_id,
            "date_from": date_from,
            "date_to": date_to,
            "deleted_count": count,
        }, cls=_DecimalEncoder)
        await audit_repo.log_action(
            user_id=current_user.id,
            action="record_bulk_delete",
            file_name=session_obj.file_name,
            session_id=session_id,
            record_count=count,
            details=f"Bulk deleted {count} records ({date_from} to {date_to})",
            snapshot_data=snapshot,
        )

    cache_invalidate(f"dashboard:{session_id}")
    # Check if the session was auto-deleted by _update_session_totals (all records gone)
    session_still_exists = await repo.get_session_metadata(session_id, current_user.id)
    return {"deleted": count, "session_deleted": session_still_exists is None}


@router.post("/audit", status_code=status.HTTP_201_CREATED)
async def create_audit_entry(
    payload: AuditLogCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a custom audit log entry. Restricted to admins only."""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    audit_repo = AuditLogRepository(db)
    await audit_repo.log_action(
        user_id=current_user.id,
        action=payload.action,
        file_name=payload.file_name,
        session_id=payload.session_id,
        record_count=payload.record_count,
        total_amount=payload.total_amount,
        details=payload.details,
        snapshot_data=payload.snapshot_data,
    )
    return {"detail": "logged"}


@router.get("/admin/audit-log", response_model=list[AuditLogEntry])
async def get_audit_log(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AuditLogEntry]:
    """Admin only: list all upload sessions across all users."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only.")
    repo = UploadRepository(db)
    sessions = await repo.list_all_sessions()
    return [
        AuditLogEntry(
            id=s.id,
            file_name=s.file_name,
            total_records=s.total_records,
            total_amount=s.total_amount,
            uploaded_at=s.uploaded_at,
            user_id=s.user_id,
            user_email=s.user.email if s.user else "unknown",
            user_name=s.user.full_name if s.user else "unknown",
        )
        for s in sessions
    ]


@router.post("/audit-log/{entry_id}/undo", status_code=status.HTTP_200_OK)
async def undo_audit_entry(
    entry_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Undo/revert an audit log entry (restore deleted data or remove uploaded data). Users can undo their own entries."""
    audit_repo = AuditLogRepository(db)
    entry = await audit_repo.get_entry(entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit log entry not found.")
    if entry.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only undo your own actions.")
    if entry.is_undone:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This action has already been undone.")
    if not entry.snapshot_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No snapshot data available for undo.")

    # Verify this entry is among the 10 most recent undoable entries for this user
    _UNDOABLE_ACTIONS = {"file_upload", "file_delete", "record_delete", "record_bulk_delete", "record_create", "record_update"}
    logs = await audit_repo.list_user_logs(current_user.id, limit=50)
    undoable_ids: set[str] = set()
    count = 0
    for log in logs:
        if count >= 10:
            break
        if not log.is_undone and log.snapshot_data and log.action in _UNDOABLE_ACTIONS:
            undoable_ids.add(log.id)
            count += 1
    if entry_id not in undoable_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only the 10 most recent entries can be undone.")

    snapshot = json.loads(entry.snapshot_data)

    if entry.action == "file_delete":
        # Restore the deleted session and all its records.
        # If undo_available is False the dataset was too large to snapshot — reject.
        if not snapshot.get("undo_available", True):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Undo is not available for this deletion: the dataset exceeded 5,000 records "
                    "and was not snapshotted. The records cannot be restored automatically."
                ),
            )
        session_data = snapshot.get("session", {})
        records_data = snapshot.get("records", [])
        restored_session = UploadSession(
            id=session_data.get("id", str(uuid.uuid4())),
            user_id=session_data.get("user_id", entry.user_id),
            file_name=session_data.get("file_name", entry.file_name),
            total_records=session_data.get("total_records", len(records_data)),
            total_amount=session_data.get("total_amount", 0.0),
        )
        db.add(restored_session)
        await db.flush()
        for rec in records_data:
            record = PaymentRecord(
                id=rec.get("id", str(uuid.uuid4())),
                session_id=restored_session.id,
                bank=rec.get("bank", ""),
                account=rec.get("account", ""),
                touchpoint=rec.get("touchpoint", ""),
                payment_date=rec.get("payment_date", ""),
                payment_amount=rec.get("payment_amount", 0.0),
                environment=rec.get("environment", ""),
                month=rec.get("month", ""),
            )
            db.add(record)

    elif entry.action == "record_delete":
        # Restore a single deleted record (preserve original ID if available)
        record_data = snapshot.get("record", {})
        session_id = snapshot.get("session_id", entry.session_id)
        orig_id = record_data.get("id")
        record = PaymentRecord(
            **(({"id": orig_id} if orig_id else {})),
            session_id=session_id,
            bank=record_data.get("bank", ""),
            account=record_data.get("account", ""),
            touchpoint=record_data.get("touchpoint", ""),
            payment_date=record_data.get("payment_date", ""),
            payment_amount=record_data.get("payment_amount", 0.0),
            environment=record_data.get("environment", ""),
            month=record_data.get("month", ""),
        )
        db.add(record)
        await db.flush()
        # Update session totals
        repo = UploadRepository(db)
        await repo._update_session_totals(session_id)

    elif entry.action == "record_create":
        # Undo a record creation = delete the created record
        record_data = snapshot.get("record", {})
        session_id = snapshot.get("session_id", entry.session_id)
        record_id = record_data.get("id")
        if not record_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot undo: created record ID is missing from snapshot.")
        repo = UploadRepository(db)
        deleted = await repo.delete_transaction(
            record_id=record_id, session_id=session_id, user_id=entry.user_id
        )
        if not deleted:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Created record no longer exists — undo not needed.")

    elif entry.action == "record_update":
        # Undo a record update = restore the 'before' state
        before = snapshot.get("before", {})
        session_id = snapshot.get("session_id", entry.session_id)
        record_id = before.get("id")
        if not record_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot undo: original record ID is missing from snapshot.")
        repo = UploadRepository(db)
        restored = await repo.update_transaction(
            record_id=record_id,
            session_id=session_id,
            user_id=entry.user_id,
            bank=before.get("bank", ""),
            account=before.get("account", ""),
            payment_amount=before.get("payment_amount", 0.0),
            touchpoint=before.get("touchpoint"),
            payment_date=before.get("payment_date"),
            environment=before.get("environment"),
            month=before.get("month"),
        )
        if not restored:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record no longer exists — cannot undo update.")

    elif entry.action == "record_bulk_delete":
        # Restore bulk deleted records (preserve original IDs where available).
        # Date-range bulk deletes store only metadata (date_from/date_to) in the
        # snapshot — not individual records — so undo is not possible for those.
        records_data = snapshot.get("records", [])
        if not records_data:
            # Check if this was a date-range delete (has date_from/date_to keys)
            if snapshot.get("date_from") or snapshot.get("date_to"):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Undo is not available for date-range bulk deletes — "
                        "individual record snapshots are not stored for this operation."
                    ),
                )
            # Empty records list for a non-date-range delete — nothing to restore
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No records found in snapshot — undo is not available for this entry.",
            )
        session_id = snapshot.get("session_id", entry.session_id)
        for rec in records_data:
            orig_id = rec.get("id")
            record = PaymentRecord(
                **(({"id": orig_id} if orig_id else {})),
                session_id=session_id,
                bank=rec.get("bank", ""),
                account=rec.get("account", ""),
                touchpoint=rec.get("touchpoint", ""),
                payment_date=rec.get("payment_date", ""),
                payment_amount=rec.get("payment_amount", 0.0),
                environment=rec.get("environment", ""),
                month=rec.get("month", ""),
            )
            db.add(record)
        await db.flush()
        # Update session totals
        repo = UploadRepository(db)
        await repo._update_session_totals(session_id)

    elif entry.action == "file_upload":
        # Undo an upload = delete the session
        if entry.session_id:
            repo = UploadRepository(db)
            await repo.delete_session_admin(entry.session_id)

    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Undo not supported for action: {entry.action}")

    await audit_repo.mark_undone(entry)
    await db.commit()
    # Invalidate dashboard cache for the affected session
    affected_session_id = snapshot.get("session_id") or entry.session_id
    if affected_session_id:
        cache_invalidate(f"dashboard:{affected_session_id}")
    return {"detail": f"Successfully undone: {entry.action} — {entry.file_name}"}
