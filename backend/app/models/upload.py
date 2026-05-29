import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.user import User



class UploadSession(Base):
    """Represents a single Excel/CSV file upload by a user."""

    __tablename__ = "upload_sessions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    total_records: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=0.0)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationship
    records: Mapped[list["PaymentRecord"]] = relationship(
        "PaymentRecord", back_populates="session", cascade="all, delete-orphan", lazy="select"
    )
    user: Mapped["User"] = relationship("User", lazy="select")  # type: ignore[name-defined]

    def __repr__(self) -> str:
        return f"<UploadSession id={self.id} file={self.file_name}>"


class PaymentRecord(Base):
    """A single payment row from an uploaded file."""

    __tablename__ = "payment_records"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("upload_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bank: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    account: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    touchpoint: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    payment_date: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    payment_amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False, default=0.0)
    environment: Mapped[str | None] = mapped_column(String(100), nullable=True)
    month: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)

    # Relationship
    session: Mapped["UploadSession"] = relationship("UploadSession", back_populates="records")

    def __repr__(self) -> str:
        return f"<PaymentRecord id={self.id} bank={self.bank} amount={self.payment_amount}>"
