import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User



class AuditLog(Base):
    """Unified audit log tracking all file-related actions per user."""

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # e.g. "file_upload", "file_delete", "record_delete", "record_bulk_delete"
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    record_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=0.0)
    details: Mapped[str | None] = mapped_column(String(500), nullable=True)
    snapshot_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_undone: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    # Relationships
    user: Mapped["User"] = relationship("User", lazy="select")  # type: ignore[name-defined]

    def __repr__(self) -> str:
        return f"<AuditLog id={self.id} action={self.action} user={self.user_id}>"
