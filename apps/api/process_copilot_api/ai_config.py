"""Pure AI configuration domain and storage boundary.

The repository stores public configuration plus an encrypted API-key ciphertext.
It must never return a provider key to a caller. SQLAlchemy integration can implement
``AIConfigRepository`` without importing FastAPI, database models, or HTTP clients.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, ClassVar, Protocol

from .crypto import encrypt_api_key


class AIConfigValidationError(ValueError):
    """Raised when an AI configuration is incomplete or outside safe bounds."""


_UNSET = object()
_SENSITIVE_FIELDS = {
    "apikey",
    "apikeyencrypted",
    "apikeyciphertext",
    "authorization",
    "password",
    "secret",
    "token",
    "accesstoken",
    "refreshtoken",
    "credential",
}
_SENSITIVE_FIELD_PATTERN = re.compile(r"(?:secret|password|credential)$", re.IGNORECASE)


@dataclass(frozen=True)
class AIConfig:
    enabled: bool
    provider: str
    baseUrl: str
    model: str
    timeout: int
    maxTokens: int
    temperature: float
    promptVersion: str
    fallbackMode: str
    version: int
    apiKeyConfigured: bool = False

    MAX_TIMEOUT_SECONDS: ClassVar[int] = 120
    MAX_TOKENS: ClassVar[int] = 128_000

    def __post_init__(self) -> None:
        if not isinstance(self.enabled, bool):
            raise AIConfigValidationError("enabled must be a boolean")
        if not isinstance(self.provider, str) or not self.provider.strip():
            raise AIConfigValidationError("provider is required")
        if not isinstance(self.baseUrl, str) or not self.baseUrl.strip():
            raise AIConfigValidationError("baseUrl is required")
        if not isinstance(self.model, str) or not self.model.strip():
            raise AIConfigValidationError("model is required")
        if isinstance(self.timeout, bool) or not isinstance(self.timeout, int):
            raise AIConfigValidationError("timeout must be an integer")
        if not 1 <= self.timeout <= self.MAX_TIMEOUT_SECONDS:
            raise AIConfigValidationError("timeout must be between 1 and 120 seconds")
        if isinstance(self.maxTokens, bool) or not isinstance(self.maxTokens, int):
            raise AIConfigValidationError("maxTokens must be an integer")
        if not 1 <= self.maxTokens <= self.MAX_TOKENS:
            raise AIConfigValidationError("maxTokens is outside the allowed range")
        if isinstance(self.temperature, bool) or not isinstance(self.temperature, (int, float)):
            raise AIConfigValidationError("temperature must be numeric")
        if not 0 <= self.temperature <= 2:
            raise AIConfigValidationError("temperature must be between 0 and 2")
        if not isinstance(self.promptVersion, str) or not self.promptVersion.strip():
            raise AIConfigValidationError("promptVersion is required")
        if not isinstance(self.fallbackMode, str) or not self.fallbackMode.strip():
            raise AIConfigValidationError("fallbackMode is required")
        if isinstance(self.version, bool) or not isinstance(self.version, int):
            raise AIConfigValidationError("version must be an integer")
        if self.version < 1:
            raise AIConfigValidationError("version must be positive")

    def to_dict(self) -> dict[str, Any]:
        """Return the API-safe representation; the write-only key is absent."""
        return {
            "enabled": self.enabled,
            "provider": self.provider,
            "baseUrl": self.baseUrl,
            "model": self.model,
            "timeout": self.timeout,
            "maxTokens": self.maxTokens,
            "temperature": self.temperature,
            "promptVersion": self.promptVersion,
            "fallbackMode": self.fallbackMode,
            "version": self.version,
            "apiKeyConfigured": self.apiKeyConfigured,
        }


@dataclass(frozen=True)
class StoredAIConfig:
    """Repository value; ciphertext is intentionally excluded from repr output."""

    config: AIConfig
    api_key_ciphertext: str | None = None

    def __repr__(self) -> str:
        configured = bool(self.api_key_ciphertext)
        return f"StoredAIConfig(config={self.config!r}, api_key_configured={configured})"


class AIConfigRepository(Protocol):
    """Minimal persistence boundary for a SQLAlchemy or other repository adapter."""

    def load(self) -> StoredAIConfig | None:
        """Return the current config and encrypted key, or ``None`` when unconfigured."""

    def save(self, config: AIConfig, api_key_ciphertext: str | None) -> StoredAIConfig:
        """Persist config and ciphertext, returning the stored value."""


@dataclass(frozen=True)
class AIConfigPatch:
    """Write input. Omitted or empty ``apiKey`` preserves the existing key."""

    enabled: bool | object = _UNSET
    provider: str | object = _UNSET
    baseUrl: str | object = _UNSET
    model: str | object = _UNSET
    timeout: int | object = _UNSET
    maxTokens: int | object = _UNSET
    temperature: float | object = _UNSET
    promptVersion: str | object = _UNSET
    fallbackMode: str | object = _UNSET
    apiKey: str | None | object = _UNSET
    clearApiKey: bool = False

    def __repr__(self) -> str:
        fields = (
            "enabled",
            "provider",
            "baseUrl",
            "model",
            "timeout",
            "maxTokens",
            "temperature",
            "promptVersion",
            "fallbackMode",
            "clearApiKey",
        )
        values = ", ".join(f"{field}={getattr(self, field)!r}" for field in fields)
        return f"AIConfigPatch({values})"


class AIConfigService:
    def __init__(self, repository: AIConfigRepository, *, environ: Mapping[str, str] | None = None):
        self.repository = repository
        self.environ = environ

    def get(self) -> AIConfig | None:
        stored = self.repository.load()
        if stored is None:
            return resolve_config_from_env(self.environ)
        return _public_config(stored)

    def update(self, patch: AIConfigPatch) -> AIConfig:
        existing = self.repository.load()
        current = existing.config if existing else resolve_config_from_env(self.environ)
        values: dict[str, Any] = {}
        for field in (
            "enabled",
            "provider",
            "baseUrl",
            "model",
            "timeout",
            "maxTokens",
            "temperature",
            "promptVersion",
            "fallbackMode",
        ):
            value = getattr(patch, field)
            if value is _UNSET:
                if current is None:
                    raise AIConfigValidationError(f"{field} is required for initial configuration")
                value = getattr(current, field)
            values[field] = value

        has_api_key_value = patch.apiKey is not _UNSET and patch.apiKey is not None
        has_nonempty_api_key = has_api_key_value and (
            not isinstance(patch.apiKey, str) or bool(patch.apiKey.strip())
        )
        if patch.clearApiKey and has_nonempty_api_key:
            raise AIConfigValidationError("clearApiKey cannot be combined with apiKey")
        ciphertext = existing.api_key_ciphertext if existing else None
        if patch.clearApiKey:
            ciphertext = None
        elif has_api_key_value and has_nonempty_api_key:
            if not isinstance(patch.apiKey, str):
                raise AIConfigValidationError("apiKey must be a string")
            ciphertext = encrypt_api_key(patch.apiKey, environ=self.environ)

        values["version"] = current.version + 1 if current else 1
        values["apiKeyConfigured"] = bool(ciphertext)
        candidate = AIConfig(**values)
        stored = self.repository.save(candidate, ciphertext)
        return _public_config(stored)


def _public_config(stored: StoredAIConfig) -> AIConfig:
    values = {**stored.config.to_dict(), "apiKeyConfigured": bool(stored.api_key_ciphertext)}
    return AIConfig(**values)


def _parse_bool(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise AIConfigValidationError("AI_ENABLED must be a boolean")


def resolve_config_from_env(environ: Mapping[str, str] | None = None) -> AIConfig | None:
    """Resolve an API-safe fallback config from environment variables.

    ``AI_API_KEY`` affects only ``apiKeyConfigured``; its value is never included in
    the returned object. Runtime request code should obtain credentials through its
    own server-side secret path rather than this public configuration representation.
    """
    source = environ if environ is not None else os.environ
    config_env_names = (
        "AI_PROVIDER",
        "AI_BASE_URL",
        "AI_MODEL",
        "AI_API_KEY",
        "LLM_PROVIDER",
        "LLM_BASE_URL",
        "LLM_MODEL",
        "LLM_API_KEY",
    )
    if not any(source.get(name) for name in config_env_names):
        return None

    def value(ai_name: str, llm_name: str, default: str) -> str:
        return source.get(ai_name) or source.get(llm_name) or default

    provider = value("AI_PROVIDER", "LLM_PROVIDER", "custom")
    try:
        timeout = int(value("AI_TIMEOUT", "LLM_TIMEOUT_SECONDS", "30"))
        max_tokens = int(value("AI_MAX_TOKENS", "LLM_MAX_TOKENS", "2048"))
        temperature = float(source.get("AI_TEMPERATURE", "0.2"))
        version = int(source.get("AI_CONFIG_VERSION", "1"))
    except ValueError as exc:
        raise AIConfigValidationError("AI numeric environment setting is invalid") from exc
    return AIConfig(
        enabled=_parse_bool(source.get("AI_ENABLED"), default=provider != "disabled"),
        provider=provider,
        baseUrl=value("AI_BASE_URL", "LLM_BASE_URL", "https://localhost"),
        model=value("AI_MODEL", "LLM_MODEL", "sentinel-explainer"),
        timeout=timeout,
        maxTokens=max_tokens,
        temperature=temperature,
        promptVersion=value("AI_PROMPT_VERSION", "LLM_PROMPT_VERSION", "v1"),
        fallbackMode=source.get("AI_FALLBACK_MODE", "template"),
        version=version,
        apiKeyConfigured=bool(source.get("AI_API_KEY") or source.get("LLM_API_KEY")),
    )


def redact_sensitive_fields(value: Any) -> Any:
    """Recursively replace credential-like mapping values for safe logging."""
    if isinstance(value, Mapping):
        redacted: dict[Any, Any] = {}
        for key, item in value.items():
            normalized = str(key).replace("_", "").replace("-", "").lower()
            is_sensitive = normalized in _SENSITIVE_FIELDS or bool(
                _SENSITIVE_FIELD_PATTERN.search(normalized)
            )
            redacted[key] = "[REDACTED]" if is_sensitive else redact_sensitive_fields(item)
        return redacted
    if isinstance(value, list):
        return [redact_sensitive_fields(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_sensitive_fields(item) for item in value)
    return value


sanitize_for_log = redact_sensitive_fields
