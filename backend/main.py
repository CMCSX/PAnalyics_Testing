import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete as sql_delete, select, text

from app.api.v1.routers import api_router
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.session import AsyncSessionFactory
from app.models.upload import UploadSession
from app.models.user import User
from app.repositories.audit_log_repository import AuditLogRepository

logger = logging.getLogger(__name__)

AUDIT_LOG_CLEANUP_INTERVAL = 24 * 60 * 60  # 24 hours in seconds
# Keep audit logs for 7 days — long enough for undo snapshots to remain valid.
# The per-user 20-entry cap in AuditLogRepository is the primary retention limit.
AUDIT_LOG_MAX_AGE_MINUTES = 7 * 24 * 60  # 7 days
DB_KEEPALIVE_INTERVAL = 4 * 60  # 4 minutes — keeps Neon free-tier compute warm

# Inactivity-based upload purge — all uploads for a user are deleted after this
# many minutes of inactivity (no authenticated API request).
INACTIVITY_PURGE_MINUTES = 60
INACTIVITY_CHECK_INTERVAL = 5 * 60  # check every 5 minutes


async def _db_keepalive_loop() -> None:
    """Ping the database every 4 minutes to prevent Neon free-tier auto-suspend."""
    await asyncio.sleep(DB_KEEPALIVE_INTERVAL)  # initial delay before first ping
    while True:
        try:
            async with AsyncSessionFactory() as session:
                await session.execute(text("SELECT 1"))
            logger.debug("DB keep-alive ping OK")
        except Exception:
            logger.warning("DB keep-alive ping failed — compute may be suspended")
        await asyncio.sleep(DB_KEEPALIVE_INTERVAL)


async def _inactivity_purge_loop() -> None:
    """Delete all upload sessions belonging to users who have been inactive for
    INACTIVITY_PURGE_MINUTES minutes.

    A user is considered inactive when last_activity_at is set AND older than
    the cutoff.  Users with last_activity_at IS NULL are explicitly excluded —
    they are either brand-new accounts that haven't made a request yet, or
    accounts created before this feature was deployed.  Deleting their files
    immediately would be wrong.

    Runs every INACTIVITY_CHECK_INTERVAL seconds.
    """
    await asyncio.sleep(60)  # short initial delay so the server is fully up first
    while True:
        try:
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=INACTIVITY_PURGE_MINUTES)
            async with AsyncSessionFactory() as session:
                # Only purge users whose last_activity_at is known AND past the cutoff.
                # NULL means "never tracked" — leave those users alone.
                inactive_users_result = await session.execute(
                    select(User.id).where(
                        User.last_activity_at.isnot(None),
                        User.last_activity_at < cutoff,
                    )
                )
                inactive_user_ids = [row[0] for row in inactive_users_result.all()]

                if inactive_user_ids:
                    # Bulk-delete all upload sessions for those users in one statement.
                    # CASCADE on payment_records means child rows are removed automatically.
                    result = await session.execute(
                        sql_delete(UploadSession).where(
                            UploadSession.user_id.in_(inactive_user_ids)
                        )
                    )
                    deleted = result.rowcount
                    await session.commit()
                    if deleted:
                        logger.info(
                            "Inactivity purge: deleted %d upload session(s) across %d inactive user(s)",
                            deleted,
                            len(inactive_user_ids),
                        )
        except Exception:
            logger.exception("Inactivity purge loop failed")
        await asyncio.sleep(INACTIVITY_CHECK_INTERVAL)


async def _audit_log_cleanup_loop() -> None:
    """Background task that deletes audit log entries older than 24 hours."""
    while True:
        await asyncio.sleep(AUDIT_LOG_CLEANUP_INTERVAL)
        try:
            async with AsyncSessionFactory() as session:
                repo = AuditLogRepository(session)
                deleted = await repo.delete_older_than(AUDIT_LOG_MAX_AGE_MINUTES)
                await session.commit()
                if deleted:
                    logger.info("Audit log cleanup: deleted %d old entries", deleted)
        except Exception:
            logger.exception("Audit log cleanup failed")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging()
    cleanup_task = asyncio.create_task(_audit_log_cleanup_loop())
    keepalive_task = asyncio.create_task(_db_keepalive_loop())
    inactivity_task = asyncio.create_task(_inactivity_purge_loop())
    yield
    cleanup_task.cancel()
    keepalive_task.cancel()
    inactivity_task.cancel()
    for task in (cleanup_task, keepalive_task, inactivity_task):
        try:
            await task
        except asyncio.CancelledError:
            pass


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/docs" if settings.DEBUG else None,
        redoc_url="/redoc" if settings.DEBUG else None,
        lifespan=lifespan,
    )

    logger.info("CORS allowed_origins: %s", settings.ALLOWED_ORIGINS)
    logger.info("CORS allowed_origin_regex: %s", settings.ALLOWED_ORIGINS_REGEX or "(none)")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_origin_regex=settings.ALLOWED_ORIGINS_REGEX or None,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )

    app.include_router(api_router)

    @app.get("/", tags=["Health"])
    async def root() -> dict:
        return {"name": settings.APP_NAME, "version": settings.APP_VERSION, "status": "ok"}

    @app.get("/health", tags=["Health"])
    async def health_check() -> dict:
        return {"status": "ok", "version": settings.APP_VERSION}

    return app


app = create_app()
