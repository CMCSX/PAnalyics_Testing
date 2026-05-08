from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class PaymentRecordIn(BaseModel):
    bank: str
    account: str
    touchpoint: str | None = None
    payment_date: str | None = None
    payment_amount: float
    environment: str | None = None
    month: str | None = None


class PaymentRecordOut(PaymentRecordIn):
    id: str
    session_id: str

    model_config = {"from_attributes": True}


MAX_RECORDS_PER_UPLOAD = 50_000  # Guard against OOM on 512 MB Render free tier (JSON body path)
MAX_RECORDS_PER_FILE_UPLOAD = 500_000  # Streaming file path is memory-safe — much higher limit


class UploadSessionCreate(BaseModel):
    file_name: str
    records: list[PaymentRecordIn]

    @field_validator("records")
    @classmethod
    def validate_records_count(cls, v: list[PaymentRecordIn]) -> list[PaymentRecordIn]:
        if len(v) > MAX_RECORDS_PER_UPLOAD:
            raise ValueError(f"Upload contains {len(v):,} records, exceeding the limit of {MAX_RECORDS_PER_UPLOAD:,}.")
        return v


class UploadSessionOut(BaseModel):
    id: str
    user_id: str
    file_name: str
    total_records: int
    total_amount: float
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class UploadSessionDetail(UploadSessionOut):
    records: list[PaymentRecordOut] = []
    records_truncated: bool = False  # True when dataset exceeds MAX_DETAIL_RECORDS


# Maximum records returned inline in GET /{session_id} to prevent OOM on 512 MB Render tier.
# Larger datasets are still fully accessible via the paginated /transactions endpoint and
# the /accounts-summary endpoint (server-side aggregation).
MAX_DETAIL_RECORDS = 10_000


class AccountSummary(BaseModel):
    account: str
    total_amount: float
    payment_count: int
    bank_count: int
    banks: str  # comma-separated list


class AccountsSummaryResponse(BaseModel):
    session_id: str
    total_accounts: int
    total_records: int
    page: int
    page_size: int
    accounts: list[AccountSummary]


class PaginatedTransactions(BaseModel):
    total: int
    total_amount: float
    page: int
    page_size: int
    items: list[PaymentRecordOut]


class BankSummary(BaseModel):
    bank: str
    payment_count: int
    account_count: int
    total_amount: float
    percentage: float


class TouchpointSummary(BaseModel):
    touchpoint: str
    count: int
    total_amount: float
    percentage: float


class EnvironmentCampaignMap(BaseModel):
    """Maps each environment to its banks, and each bank to its touchpoints."""
    environment: str
    banks: list[str]
    touchpoints_by_bank: dict[str, list[str]]


class MonthlyTrendPoint(BaseModel):
    month: str
    amount: float


class BankTouchpointMatrixRow(BaseModel):
    """Per-bank × per-touchpoint × per-environment aggregate row."""
    bank: str
    touchpoint: str
    environment: str
    count: int
    total_amount: float
    account_count: int


class DashboardSummary(BaseModel):
    total_payments: int
    total_amount: float
    total_accounts: int
    total_banks: int
    banks: list[BankSummary]
    touchpoints: list[TouchpointSummary]
    dates: list[str] = []
    environments: list[str] = []
    months: list[str] = []
    environment_map: list[EnvironmentCampaignMap] = []
    monthly_trend: list[MonthlyTrendPoint] = []
    bank_touchpoint_matrix: list[BankTouchpointMatrixRow] = []
    session_id: str | None = None


class AuditLogEntry(BaseModel):
    id: str
    file_name: str
    total_records: int
    total_amount: float
    uploaded_at: datetime
    user_id: str
    user_email: str
    user_name: str

    model_config = {"from_attributes": True}


class UnifiedAuditLogEntry(BaseModel):
    id: str
    user_id: str
    user_email: str
    user_name: str
    action: str
    file_name: str
    session_id: str | None = None
    record_count: int
    total_amount: float
    details: str | None = None
    is_undone: bool = False
    can_undo: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class BulkDeleteRequest(BaseModel):
    ids: list[str] = Field(..., max_length=5_000, description="IDs of records to delete (max 5,000 per request)")

    @field_validator("ids")
    @classmethod
    def validate_ids_length(cls, v: list[str]) -> list[str]:
        if len(v) > 5_000:
            raise ValueError("Cannot delete more than 5,000 records per request.")
        return v


# Allowed action values that can be submitted via the external audit endpoint.
_ALLOWED_AUDIT_ACTIONS = frozenset(
    {
        "file_upload",
        "file_delete",
        "record_create",
        "record_update",
        "record_delete",
        "record_bulk_delete",
    }
)


class AuditLogCreate(BaseModel):
    action: str
    file_name: str
    session_id: str | None = None
    record_count: int = 0
    total_amount: float = 0.0
    details: str | None = None
    snapshot_data: str | None = None

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        if v not in _ALLOWED_AUDIT_ACTIONS:
            raise ValueError(
                f"Invalid action '{v}'. Must be one of: {', '.join(sorted(_ALLOWED_AUDIT_ACTIONS))}"
            )
        return v
