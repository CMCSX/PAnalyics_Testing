"""Check for the ₱400 discrepancy between website and Excel totals."""
import asyncio
from app.db.session import AsyncSessionFactory
from sqlalchemy import text


async def check():
    async with AsyncSessionFactory() as session:
        # Count records with payment_amount = 400
        r = await session.execute(
            text("SELECT COUNT(*), SUM(payment_amount) FROM payment_records WHERE payment_amount = 400")
        )
        cnt, total = r.one()
        print(f"Records with amount=400: {cnt}, sum={total}")

        # Get overall total
        r2 = await session.execute(
            text("SELECT COUNT(*), SUM(payment_amount) FROM payment_records")
        )
        cnt2, total2 = r2.one()
        print(f"Total records: {cnt2}, total amount: {total2}")

        # Check for possible subtotal/total rows
        r3 = await session.execute(
            text("""
                SELECT bank, account, touchpoint, payment_date, payment_amount
                FROM payment_records
                WHERE LOWER(bank) LIKE '%total%' OR LOWER(account) LIKE '%total%'
                OR LOWER(touchpoint) LIKE '%total%' OR LOWER(bank) LIKE '%sum%'
                LIMIT 10
            """)
        )
        rows = r3.all()
        if rows:
            print(f"Possible total/sum rows: {rows}")
        else:
            print("No rows with 'total'/'sum' in bank/account/touchpoint")

        # Check for rows with empty/null payment_date (might be summary rows)
        r4 = await session.execute(
            text("SELECT COUNT(*), SUM(payment_amount) FROM payment_records WHERE payment_date IS NULL OR payment_date = ''")
        )
        cnt4, total4 = r4.one()
        print(f"Rows with empty date: {cnt4}, sum={total4}")

        # Check for duplicate rows
        r5 = await session.execute(
            text("""
                SELECT bank, account, payment_date, payment_amount, COUNT(*) as dupes
                FROM payment_records
                GROUP BY bank, account, payment_date, payment_amount
                HAVING COUNT(*) > 1
                ORDER BY COUNT(*) DESC
                LIMIT 10
            """)
        )
        dupes = r5.all()
        if dupes:
            print(f"Top duplicate rows (same bank/account/date/amount): {len(dupes)} groups")
            for d in dupes[:5]:
                print(f"  bank={d[0]}, account={d[1]}, date={d[2]}, amount={d[3]}, count={d[4]}")
        else:
            print("No duplicate rows found")

        # Check per-session totals
        r6 = await session.execute(
            text("""
                SELECT s.id, s.file_name, s.total_records, s.total_amount,
                       COUNT(p.id) as actual_records,
                       SUM(p.payment_amount) as actual_amount
                FROM upload_sessions s
                LEFT JOIN payment_records p ON p.session_id = s.id
                GROUP BY s.id, s.file_name, s.total_records, s.total_amount
            """)
        )
        sessions = r6.all()
        for s in sessions:
            stored_total = float(s[3]) if s[3] else 0
            actual_total = float(s[5]) if s[5] else 0
            diff = actual_total - stored_total
            print(f"\nSession: {s[1]}")
            print(f"  Stored: records={s[2]}, amount={stored_total}")
            print(f"  Actual: records={s[4]}, amount={actual_total}")
            if abs(diff) > 0.01:
                print(f"  DIFF: {diff}")

        # Look for records where amount is exactly 400 and check context
        r7 = await session.execute(
            text("""
                SELECT bank, account, touchpoint, payment_date, payment_amount
                FROM payment_records
                WHERE payment_amount = 400
                ORDER BY payment_date
                LIMIT 20
            """)
        )
        rows400 = r7.all()
        print("\nRecords with amount=400 (showing up to 20):")
        for r in rows400:
            print(f"  bank={r[0]}, account={r[1]}, tp={r[2]}, date={r[3]}, amount={r[4]}")


asyncio.run(check())
