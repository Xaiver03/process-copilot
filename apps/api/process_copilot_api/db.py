from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, DateTime, Float, Integer, String, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


class ReplayRunRow(Base):
    __tablename__ = "replay_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    scenario_id: Mapped[str] = mapped_column(String(128), index=True)
    state: Mapped[str] = mapped_column(String(16))
    speed: Mapped[float] = mapped_column(Float)
    current_sample: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[Any] = mapped_column(DateTime, nullable=False)


class AnomalyEventRow(Base):
    __tablename__ = "anomaly_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    sample_index: Mapped[int] = mapped_column(Integer)
    severity: Mapped[str] = mapped_column(String(16))
    state: Mapped[str] = mapped_column(String(16), default="open")
    anomaly_score: Mapped[float] = mapped_column(Float)
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class DecisionRow(Base):
    __tablename__ = "decision_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    decision: Mapped[str] = mapped_column(String(16))
    operator_name: Mapped[str] = mapped_column(String(160))
    operator_role: Mapped[str] = mapped_column(String(16), default="unknown")
    note: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[Any] = mapped_column(DateTime, nullable=False)
    model_version: Mapped[str] = mapped_column(String(128))
    trace_id: Mapped[str] = mapped_column(String(128))


class AuditRow(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), index=True)
    record_id: Mapped[str] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(64))
    actor: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    trace_id: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[Any] = mapped_column(DateTime, nullable=False)


class OperatorRow(Base):
    __tablename__ = "operators"

    username: Mapped[str] = mapped_column(String(80), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[Any] = mapped_column(DateTime, nullable=False)


class IdempotencyRow(Base):
    __tablename__ = "idempotency_records"

    id: Mapped[str] = mapped_column(String(320), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    response: Mapped[dict[str, Any]] = mapped_column(JSON)
    status_code: Mapped[int] = mapped_column(Integer)



def table_names(engine: Any) -> set[str]:
    return set(inspect(engine).get_table_names())


def column_names(engine: Any, table_name: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table_name)}



class Database:
    def __init__(self, url: str):
        connect_args: dict[str, Any] = {}
        kwargs: dict[str, Any] = {}
        if url.startswith("sqlite"):
            connect_args["check_same_thread"] = False
            if ":memory:" in url:
                kwargs["poolclass"] = StaticPool
        self.engine = create_engine(url, connect_args=connect_args, **kwargs)
        self.session_factory = sessionmaker(self.engine, expire_on_commit=False, class_=Session)

    def create_schema(self) -> None:
        if self.engine.url.get_backend_name() == "sqlite":
            database = self.engine.url.database
            if database and database != ":memory:":
                Path(database).parent.mkdir(parents=True, exist_ok=True)
        Base.metadata.create_all(self.engine)

    def check_ready(self) -> None:
        with self.engine.connect() as connection:
            connection.execute(text("SELECT 1"))

    @contextmanager
    def session(self) -> Iterator[Session]:
        session = self.session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
