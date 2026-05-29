"""Deeper analysis: find the extra ₱400 difference."""
import asyncio
from app.db.session import AsyncSessionFactory
from sqlalchemy import text


async def check():
    async with AsyncSessionFactory() as session:
        # Get one session ID
        r = await session.execute(
            text("SELECT id FROM upload_sessions LIMIT 1")
        )
        session_id = r.scalar_one()
        print(f"Checking session: {session_id}")

        # Check if any record has bank/account/touchpoint that looks like a header or summary
        r2 = await session.execute(
            text("""
                SELECT bank, account, touchpoint, payment_date, payment_amount
                FROM payment_records
                WHERE session_id = :sid
                AND (
                    LOWER(bank) LIKE '%bank%'
                    OR LOWER(bank) LIKE '%header%'
                    OR LOWER(account) LIKE '%account%'
                    OR LOWER(account) LIKE '%debtor%'
                    OR LOWER(touchpoint) LIKE '%touchpoint%'
                    OR LOWER(touchpoint) LIKE '%tagging%'
                    OR LOWER(payment_date) LIKE '%date%'
                    OR bank = ''
                    OR account = ''
                )
                LIMIT 20
            """),
            {"sid": session_id}
        )
        rows = r2.all()
        print(f"\nSuspicious rows (empty/header-like): {len(rows)}")
        for r in rows:
            print(f"  bank='{r[0]}', account='{r[1]}', tp='{r[2]}', date='{r[3]}', amount={r[4]}")

        # Check for records with non-numeric looking dates (might be summary rows)
        r3 = await session.execute(
            text("""
                SELECT bank, account, touchpoint, payment_date, payment_amount
                FROM payment_records
                WHERE session_id = :sid
                AND payment_date NOT LIKE '__/__/____'
                AND payment_date NOT LIKE '____-__-__'
                AND payment_date IS NOT NULL
                AND payment_date != ''
                LIMIT 20
            """),
            {"sid": session_id}
        )
        odd_dates = r3.all()
        print(f"\nRecords with unusual date format: {len(odd_dates)}")
        for r in odd_dates[:10]:
            print(f"  bank='{r[0]}', account='{r[1]}', date='{r[3]}', amount={r[4]}")

        # Get the exact DB total to many decimal places
        r4 = await session.execute(
            text("SELECT CAST(SUM(payment_amount) AS CHAR) FROM payment_records WHERE session_id = :sid"),
            {"sid": session_id}
        )
        exact_total = r4.scalar_one()
        print(f"\nExact DB total: {exact_total}")

        # Count unique vs total records
        r5 = await session.execute(
            text("""
                SELECT 
                    COUNT(*) as total_rows,
                    COUNT(DISTINCT CONCAT(bank, '|', account, '|', COALESCE(payment_date,''), '|', CAST(payment_amount AS CHAR))) as unique_combos
                FROM payment_records
                WHERE session_id = :sid
            """),
            {"sid": session_id}
        )
        total_rows, unique_combos = r5.one()
        print(f"\nTotal rows: {total_rows}, Unique (bank+account+date+amount) combos: {unique_combos}")

        # Check the very last few records (might include trailing summary rows)
        r6 = await session.execute(
            text("""
                SELECT bank, account, touchpoint, payment_date, payment_amount
                FROM payment_records
                WHERE session_id = :sid
                ORDER BY id DESC
                LIMIT 10
            """),
            {"sid": session_id}
        )
        last_rows = r6.all()
        print("\nLast 10 records (by insertion order):")
        for r in last_rows:
            print(f"  bank='{r[0]}', account='{r[1]}', tp='{r[2]}', date='{r[3]}', amount={r[4]}")

        # Check first few records
        r7 = await session.execute(
            text("""
                SELECT bank, account, touchpoint, payment_date, payment_amount
                FROM payment_records
                WHERE session_id = :sid
                ORDER BY id ASC
                LIMIT 5
            """),
            {"sid": session_id}
        )
        first_rows = r7.all()
        print("\nFirst 5 records (by insertion order):")
        for r in first_rows:
            print(f"  bank='{r[0]}', account='{r[1]}', tp='{r[2]}', date='{r[3]}', amount={r[4]}")


asyncio.run(check())
