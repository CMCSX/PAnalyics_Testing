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
    yield
    cleanup_task.cancel()
    keepalive_task.cancel()
    for task in (cleanup_task, keepalive_task):
        try:
            await task
        except asyncio.CancelledError:
            pass
    from app.db.session import engine
    await engine.dispose()


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
