"""
Super Stress Test for PayAnalytics backend.
- Batched logins (9 per batch with 62s interval) so rate limiter never triggers.
- 100 concurrent virtual users sharing acquired tokens round-robin.
- 5 successive waves with a brief gap between each to simulate burst traffic.

Usage (from backend/ folder):
    python scripts/stress_test.py
"""

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass, field

import httpx

BASE_URL = "http://localhost:8000"
EMAIL = "payanalytics86@gmail.com"
PASSWORD = "@Rinzu2002"

# ── Login batching ─────────────────────────────────────────────────────────────
LOGIN_BATCH_SIZE = 9        # stay under the 10/60s rate limit
LOGIN_BATCHES = 2           # 2 batches × 9 = 18 tokens; wait 62s between batches
LOGIN_BATCH_INTERVAL = 62   # seconds between login batches

# ── Load test ─────────────────────────────────────────────────────────────────
CONCURRENT_USERS = 100      # simultaneous virtual users per wave
REQUESTS_PER_USER = 15      # requests each user makes per wave
WAVE_COUNT = 5              # number of successive waves
WAVE_INTERVAL = 4           # seconds between waves


@dataclass
class Stats:
    latencies: list[float] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    status_counts: dict[int, int] = field(default_factory=lambda: defaultdict(int))

    def record(self, elapsed: float, status: int) -> None:
        self.latencies.append(elapsed)
        self.status_counts[status] += 1

    def record_error(self, err: str) -> None:
        self.errors.append(err)

    def summary(self, label: str) -> None:
        total = len(self.latencies) + len(self.errors)
        if not total:
            print(f"  [{label}] No requests made")
            return
        ok_latencies = self.latencies
        avg = sum(ok_latencies) / len(ok_latencies) if ok_latencies else 0
        mn = min(ok_latencies) if ok_latencies else 0
        mx = max(ok_latencies) if ok_latencies else 0
        sorted_l = sorted(ok_latencies)
        p95 = sorted_l[int(len(sorted_l) * 0.95)] if sorted_l else 0
        p99 = sorted_l[int(len(sorted_l) * 0.99)] if sorted_l else 0
        print(f"\n  [{label}]")
        print(f"    Total requests : {total}")
        print(f"    Successful     : {sum(v for k, v in self.status_counts.items() if 200 <= k < 300)}")
        print(f"    Errors         : {len(self.errors)}")
        print(f"    Status counts  : {dict(self.status_counts)}")
        print(f"    Avg latency    : {avg*1000:.1f} ms")
        print(f"    Min latency    : {mn*1000:.1f} ms")
        print(f"    Max latency    : {mx*1000:.1f} ms")
        print(f"    p95 latency    : {p95*1000:.1f} ms")
        print(f"    p99 latency    : {p99*1000:.1f} ms")
        if self.errors:
            print(f"    Sample errors  : {self.errors[:3]}")


# ─── Individual test helpers ──────────────────────────────────────────────────

async def stress_health(client: httpx.AsyncClient, stats: Stats) -> None:
    t0 = time.perf_counter()
    try:
        r = await client.get(f"{BASE_URL}/health")
        stats.record(time.perf_counter() - t0, r.status_code)
    except Exception as e:
        stats.record_error(str(e))


async def do_login(client: httpx.AsyncClient, stats: Stats) -> str | None:
    """Returns access token on success."""
    t0 = time.perf_counter()
    try:
        r = await client.post(
            f"{BASE_URL}/api/v1/auth/login",
            json={"email": EMAIL, "password": PASSWORD},
        )
        stats.record(time.perf_counter() - t0, r.status_code)
        if r.status_code == 200:
            return r.json()["access_token"]
    except Exception as e:
        stats.record_error(str(e))
    return None


async def stress_me(client: httpx.AsyncClient, token: str, stats: Stats) -> None:
    t0 = time.perf_counter()
    try:
        r = await client.get(
            f"{BASE_URL}/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        stats.record(time.perf_counter() - t0, r.status_code)
    except Exception as e:
        stats.record_error(str(e))


async def stress_uploads_list(client: httpx.AsyncClient, token: str, stats: Stats) -> None:
    t0 = time.perf_counter()
    try:
        r = await client.get(
            f"{BASE_URL}/api/v1/uploads",
            headers={"Authorization": f"Bearer {token}"},
        )
        stats.record(time.perf_counter() - t0, r.status_code)
    except Exception as e:
        stats.record_error(str(e))


# ─── Virtual user scenario ────────────────────────────────────────────────────

async def virtual_user(
    user_id: int,
    token: str,
    health_stats: Stats,
    me_stats: Stats,
    uploads_stats: Stats,
) -> None:
    async with httpx.AsyncClient(timeout=60.0) as client:
        for _ in range(REQUESTS_PER_USER):
            await stress_health(client, health_stats)
            await stress_me(client, token, me_stats)
            await stress_uploads_list(client, token, uploads_stats)
            # tiny jitter: avoids pure thundering-herd while keeping pressure high
            await asyncio.sleep(0.02)


# ─── Main ─────────────────────────────────────────────────────────────────────

async def main() -> None:
    total_req_planned = WAVE_COUNT * CONCURRENT_USERS * REQUESTS_PER_USER * 3
    print("=" * 64)
    print("  PayAnalytics Backend — SUPER Stress Test")
    print("=" * 64)
    print(f"  Target          : {BASE_URL}")
    print(f"  Login batches   : {LOGIN_BATCHES} × {LOGIN_BATCH_SIZE} = {LOGIN_BATCHES * LOGIN_BATCH_SIZE} tokens")
    print(f"  Concurrent users: {CONCURRENT_USERS} per wave")
    print(f"  Waves           : {WAVE_COUNT}  (gap: {WAVE_INTERVAL}s)")
    print(f"  Req/user/wave   : {REQUESTS_PER_USER} per endpoint")
    print(f"  Total planned   : {total_req_planned:,} requests")
    print()

    # ── Phase 1: batched logins ────────────────────────────────────────────────
    print("[Phase 1] Batched login (to stay under rate limit) ...")
    login_stats = Stats()
    all_tokens: list[str] = []

    for batch_num in range(LOGIN_BATCHES):
        if batch_num > 0:
            print(f"\n  [wait] {LOGIN_BATCH_INTERVAL}s for rate-limit window to reset ...")
            await asyncio.sleep(LOGIN_BATCH_INTERVAL)
        print(f"  Batch {batch_num + 1}/{LOGIN_BATCHES}: sending {LOGIN_BATCH_SIZE} concurrent logins ...")
        async with httpx.AsyncClient(timeout=30.0) as client:
            results = await asyncio.gather(
                *[do_login(client, login_stats) for _ in range(LOGIN_BATCH_SIZE)]
            )
        batch_tokens = [t for t in results if t]
        all_tokens.extend(batch_tokens)
        print(f"    Got {len(batch_tokens)}/{LOGIN_BATCH_SIZE} tokens (total so far: {len(all_tokens)})")

    login_stats.summary("Login (all batches)")

    if not all_tokens:
        print("\n  [FAIL] No valid tokens - cannot continue. Check credentials/server.")
        return

    print(f"  Total tokens acquired: {len(all_tokens)} OK")

    # ── Phase 2: wave-based load test ──────────────────────────────────────────
    print(f"\n[Phase 2] Wave load test ({WAVE_COUNT} waves × {CONCURRENT_USERS} users × {REQUESTS_PER_USER} req/endpoint) ...")

    health_stats = Stats()
    me_stats = Stats()
    uploads_stats = Stats()

    grand_start = time.perf_counter()

    for wave in range(WAVE_COUNT):
        print(f"  [Wave {wave + 1}/{WAVE_COUNT}] {CONCURRENT_USERS} concurrent users firing ...")
        wave_start = time.perf_counter()
        await asyncio.gather(
            *[
                virtual_user(
                    i,
                    all_tokens[i % len(all_tokens)],  # round-robin tokens
                    health_stats,
                    me_stats,
                    uploads_stats,
                )
                for i in range(CONCURRENT_USERS)
            ]
        )
        wave_elapsed = time.perf_counter() - wave_start
        wave_req = CONCURRENT_USERS * REQUESTS_PER_USER * 3
        print(f"     Done in {wave_elapsed:.1f}s  ({wave_req/wave_elapsed:.1f} req/s this wave)")

        if wave < WAVE_COUNT - 1:
            print(f"  [pause] {WAVE_INTERVAL}s before next wave ...")
            await asyncio.sleep(WAVE_INTERVAL)

    grand_elapsed = time.perf_counter() - grand_start
    total_requests = WAVE_COUNT * CONCURRENT_USERS * REQUESTS_PER_USER * 3
    rps = total_requests / grand_elapsed

    health_stats.summary("GET /health")
    me_stats.summary("GET /auth/me")
    uploads_stats.summary("GET /uploads")

    print(f"\n{'=' * 64}")
    print(f"  Total time    : {grand_elapsed:.2f}s")
    print(f"  Total requests: {total_requests:,}")
    print(f"  Throughput    : {rps:.1f} req/s")
    errors_total = len(health_stats.errors) + len(me_stats.errors) + len(uploads_stats.errors)
    print(f"  Total errors  : {errors_total}")
    if errors_total == 0:
        print("  Result        : HELD -- zero errors across all waves")
    else:
        print("  Result        : WARNING -- Some errors detected -- see details above")
    print("=" * 64)


if __name__ == "__main__":
    asyncio.run(main())
