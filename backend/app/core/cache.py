"""
In-process TTL cache for expensive query results.

Uses a simple dict + expiry timestamps.  Designed for single-process
deployments (Render free tier) where Redis is not available.

Typical budget: ~50 MB of the 512 MB RAM limit.
"""

import time
from typing import Any

_cache: dict[str, tuple[float, Any]] = {}

# Default TTL in seconds (5 minutes)
DEFAULT_TTL = 300

# Maximum number of entries before the oldest-expiry entries are evicted.
# Each dashboard entry is ~2–5 KB of JSON; 500 entries ≈ 1–2 MB.
_MAX_ENTRIES = 500


def _evict_if_needed() -> None:
    """Remove expired entries first; if still over cap, evict the soonest-expiring ones."""
    now = time.monotonic()
    # Drop all expired entries in one pass
    expired = [k for k, (exp, _) in _cache.items() if now > exp]
    for k in expired:
        _cache.pop(k, None)
    # If still over cap, evict the entries closest to expiry (least valuable)
    if len(_cache) >= _MAX_ENTRIES:
        overflow = len(_cache) - _MAX_ENTRIES + 1
        by_expiry = sorted(_cache.items(), key=lambda kv: kv[1][0])
        for k, _ in by_expiry[:overflow]:
            _cache.pop(k, None)


def cache_get(key: str) -> Any | None:
    """Return cached value if it exists and hasn't expired, else None."""
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() > expires_at:
        _cache.pop(key, None)
        return None
    return value


def cache_set(key: str, value: Any, ttl: int = DEFAULT_TTL) -> None:
    """Store a value in cache with a TTL (seconds). Evicts stale/overflow entries first."""
    _evict_if_needed()
    _cache[key] = (time.monotonic() + ttl, value)


def cache_invalidate(prefix: str) -> int:
    """Remove all keys starting with *prefix* OR containing *prefix* as a substring.
    Returns count removed.

    The substring match handles the user-scoped dashboard keys where the
    session_id appears in the middle: dashboard:{user_id}:{session_id}:...
    Passing f"dashboard:{session_id}" will match all users' cached entries
    for that session, which is the correct invalidation behaviour.

    Guards against an empty prefix which would otherwise wipe the entire cache.
    """
    if not prefix:
        return 0
    to_remove = [k for k in _cache if k.startswith(prefix) or prefix in k]
    for k in to_remove:
        _cache.pop(k, None)
    return len(to_remove)


def cache_clear() -> None:
    """Drop entire cache (e.g. on shutdown or for tests)."""
    _cache.clear()
