"""Demo-grade operator authentication: preset accounts + JWT bearer tokens.

No self-registration:中控室场景下账号由系统预置。口令使用 pbkdf2 哈希，
token 为 HS256 JWT，过期 12 小时（一个班次）。
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

import jwt
from fastapi import Depends, Request
from pydantic import BaseModel

from .db import OperatorRow
from .schemas import ContractModel

Role = Literal["operator", "shift_lead", "admin"]
ROLE_ORDER: dict[str, int] = {"operator": 1, "shift_lead": 2, "admin": 3}

DEFAULT_OPERATORS: list[dict[str, str]] = [
    {
        "username": "operator-01",
        "password": "demo-op-2026",
        "role": "operator",
        "display_name": "中控操作员 01",
    },
    {
        "username": "shift-lead",
        "password": "demo-lead-2026",
        "role": "shift_lead",
        "display_name": "当班班长",
    },
    {
        "username": "process-engineer",
        "password": "demo-eng-2026",
        "role": "shift_lead",
        "display_name": "工艺工程师",
    },
    {
        "username": "system-admin",
        "password": "demo-admin-2026",
        "role": "admin",
        "display_name": "系统管理员",
    },
]

TOKEN_TTL_HOURS = 12


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return f"pbkdf2${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = stored.split("$")
        if scheme != "pbkdf2":
            return False
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 100_000
        )
        return hmac.compare_digest(candidate, bytes.fromhex(digest_hex))
    except (ValueError, TypeError):
        return False


def token_secret() -> str:
    secret = os.getenv("OPERATOR_TOKEN_SECRET", "")
    if len(secret) >= 32:
        return secret
    if os.getenv("APP_ENV", "development").strip().lower() == "production":
        raise RuntimeError("OPERATOR_TOKEN_SECRET must contain at least 32 characters")
    return "process-copilot-demo-secret-do-not-use-in-production"


class LoginRequestModel(ContractModel):
    username: str
    password: str


class LoginResponse(ContractModel):
    token: str
    username: str
    role: str
    display_name: str
    expires_at: datetime


class OperatorInfo(BaseModel):
    username: str
    role: Role
    display_name: str


def seed_operators(database: Any) -> None:
    now = datetime.now(UTC).replace(tzinfo=None)
    with database.session() as session:
        for spec in DEFAULT_OPERATORS:
            existing = session.query(OperatorRow).filter_by(username=spec["username"]).first()
            if existing:
                continue
            session.add(
                OperatorRow(
                    username=spec["username"],
                    password_hash=_hash_password(spec["password"]),
                    role=spec["role"],
                    display_name=spec["display_name"],
                    created_at=now,
                )
            )


def authenticate(database: Any, username: str, password: str) -> LoginResponse:
    with database.session() as session:
        row = session.query(OperatorRow).filter_by(username=username).first()
        if not row or not _verify_password(password, row.password_hash):
            raise PermissionError("invalid_credentials")
    now = datetime.now(UTC)
    expires_at = now + timedelta(hours=TOKEN_TTL_HOURS)
    token = jwt.encode(
        {
            "sub": username,
            "role": row.role,
            "name": row.display_name,
            "iat": int(now.timestamp()),
            "exp": int(expires_at.timestamp()),
        },
        token_secret(),
        algorithm="HS256",
    )
    return LoginResponse(
        token=token,
        username=row.username,
        role=row.role,
        display_name=row.display_name,
        expires_at=expires_at,
    )


def current_operator(request: Request) -> OperatorInfo:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise _auth_error("missing_token", "Authorization bearer token is required")
    token = header[7:]
    try:
        payload = jwt.decode(token, token_secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise _auth_error("token_expired", "Token has expired") from None
    except jwt.InvalidTokenError:
        raise _auth_error("invalid_token", "Token is invalid") from None
    username = payload.get("sub")
    role = payload.get("role")
    if not username or role not in ROLE_ORDER:
        raise _auth_error("invalid_token", "Token payload is invalid")
    return OperatorInfo(
        username=username, role=role, display_name=payload.get("name", username)
    )


def require_role(minimum: Role):
    def dependency(
        operator: Annotated[OperatorInfo, Depends(current_operator)],
    ) -> OperatorInfo:
        if ROLE_ORDER[operator.role] < ROLE_ORDER[minimum]:
            raise _auth_error(
                "forbidden",
                f"Role '{minimum}' or higher is required",
                status_code=403,
            )
        return operator

    return dependency


def _auth_error(code: str, message: str, status_code: int = 401) -> Any:
    from .main import APIError

    return APIError(status_code, code, message)
