from datetime import datetime, date
from app.utils.file_parser import _format_date

def test_format_date_none():
    assert _format_date(None) == ""

def test_format_date_datetime_and_date():
    assert _format_date(datetime(2025, 3, 14, 12, 0, 0)) == "2025-03-14"
    assert _format_date(date(2025, 3, 14)) == "2025-03-14"

def test_format_date_already_standard():
    assert _format_date("2025-03-14") == "2025-03-14"
    assert _format_date("2026-05-28 ") == "2026-05-28"

def test_format_date_slash_year_first():
    assert _format_date("2026/05/28") == "2026-05-28"
    assert _format_date("2026/5/8") == "2026-05-08"
    assert _format_date("2026/13/05") == "2026-05-13"  # YYYY/DD/MM case

def test_format_date_dash_year_first():
    assert _format_date("2026-5-8") == "2026-05-08"
    assert _format_date("2026-05-08") == "2026-05-08"

def test_format_date_slash_year_last():
    assert _format_date("28/05/2026") == "2026-05-28"
    assert _format_date("05/28/2026") == "2026-05-28"
    assert _format_date("05/12/26") == "2026-12-05"  # default DD/MM/YY
    assert _format_date("28/05/26") == "2026-05-28"  # day > 12 -> DD/MM/YY
    assert _format_date("05/28/26") == "2026-05-28"  # month > 12 -> MM/DD/YY

def test_format_date_dash_year_last():
    assert _format_date("28-05-2026") == "2026-05-28"
    assert _format_date("05-28-2026") == "2026-05-28"
    assert _format_date("28-5-26") == "2026-05-28"

def test_format_date_excel_serial():
    assert _format_date("45628") == "2024-12-02"
    assert _format_date(45628) == "2024-12-02"

def test_format_date_invalid_fallback():
    assert _format_date("not a date") == "not a date"
    assert _format_date("2026/02/30") == "2026/02/30"  # invalid date value
