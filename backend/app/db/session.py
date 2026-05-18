from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    # Neon free tier allows ~10 concurrent connections via the pooler endpoint.
    # Keep pool_size small so we don't exhaust them; max_overflow handles bursts.
    pool_size=5,
    max_overflow=10,
    # pool_pre_ping adds a SELECT 1 round-trip on every checkout — ~100ms extra
    # per request against Neon. The keepalive loop in main.py already prevents
    # the compute from suspending, so pre-ping is unnecessary overhead here.
    pool_pre_ping=False,
    # Recycle connections every 10 minutes to avoid stale TCP connections
    # being silently dropped by Neon's idle timeout.
    pool_recycle=600,
)

AsyncSessionFactory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    """FastAPI dependency that provides a database session per request."""
    async with AsyncSessionFactory() as session:
        try:
            yield session
        except Exception:
            try:
                await session.rollback()
            except Exception:
                pass  # Connection may already be closed
            raise
        else:
            try:
                await session.commit()
            except Exception:
                try:
                    await session.rollback()
                except Exception:
                    pass
                raise
