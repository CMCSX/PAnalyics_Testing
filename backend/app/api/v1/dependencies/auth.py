import asyncio
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import update as sql_update

from app.db.session import get_db, AsyncSessionFactory
from app.models.user import User
from app.services.auth_service import AuthService

http_bearer = HTTPBearer()

# Limit concurrent background activity writes to avoid exhausting the DB
# connection pool under high load.  At most 3 writes run simultaneously;
# additional requests skip the write rather than queue indefinitely.
_ACTIVITY_SEMAPHORE = asyncio.Semaphore(3)


def _fire_and_forget_activity(user_id: str) -> None:
    """Schedule a background DB write to update last_activity_at.

    Uses its own session so it never blocks or shares a transaction with
    the main request. The write is best-effort — if it fails or the semaphore
    is saturated the request still succeeds.
    """
    async def _write() -> None:
        # Non-blocking: only proceed if a slot is immediately available.
        # asyncio.Semaphore doesn't have acquire_nowait, so we check the
        # internal counter directly — this is safe in a single-threaded
        # asyncio event loop (no race between check and acquire).
        if _ACTIVITY_SEMAPHORE.locked():
            return  # all 3 slots in use — skip this write
        async with _ACTIVITY_SEMAPHORE:
            try:
                async with AsyncSessionFactory() as session:
                    await session.execute(
                        sql_update(User)
                        .where(User.id == user_id)
                        .values(last_activity_at=datetime.now(timezone.utc))
                    )
                    await session.commit()
            except Exception:
                pass  # Non-critical — never let this break a request

    try:
        asyncio.ensure_future(_write())
    except RuntimeError:
        pass  # No running loop (e.g. during tests) — skip silently


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(http_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """FastAPI dependency to extract and validate the current authenticated user.

    Schedules a non-blocking background write to last_activity_at so the
    inactivity cleanup job stays accurate without adding any latency to the
    request itself.
    """
    service = AuthService(db)
    user = await service.get_current_user(credentials.credentials)
    # Fire-and-forget — does NOT await, does NOT share this request's DB session
    _fire_and_forget_activity(user.id)
    return user


async def require_admin(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Require the current user to be a superuser/admin."""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return current_user
