from __future__ import annotations

from datetime import UTC, datetime

from .ai_config import AIConfig, StoredAIConfig
from .db import AIConfigurationRow, Database


class AIConfigConflictError(RuntimeError):
    """Raised when a stale configuration version attempts to overwrite the active row."""


class SQLAlchemyAIConfigRepository:
    def __init__(self, database: Database, *, config_id: str = "default") -> None:
        self.database = database
        self.config_id = config_id

    def load(self) -> StoredAIConfig | None:
        with self.database.session() as session:
            row = session.get(AIConfigurationRow, self.config_id)
            if row is None:
                return None
            return _stored_config(row)

    def save(self, config: AIConfig, api_key_ciphertext: str | None) -> StoredAIConfig:
        with self.database.session() as session:
            row = session.get(AIConfigurationRow, self.config_id)
            expected_previous_version = config.version - 1
            actual_previous_version = row.version if row is not None else 0
            if actual_previous_version != expected_previous_version:
                raise AIConfigConflictError(
                    "AI configuration changed while this update was being prepared"
                )
            if row is None:
                row = AIConfigurationRow(id=self.config_id)
                session.add(row)
            row.enabled = config.enabled
            row.provider = config.provider
            row.base_url = config.baseUrl
            row.model = config.model
            row.api_key_ciphertext = api_key_ciphertext
            row.timeout_seconds = config.timeout
            row.max_tokens = config.maxTokens
            row.temperature = config.temperature
            row.prompt_version = config.promptVersion
            row.fallback_mode = config.fallbackMode
            row.version = config.version
            row.updated_at = datetime.now(UTC).replace(tzinfo=None)
            return StoredAIConfig(config=config, api_key_ciphertext=api_key_ciphertext)


def _stored_config(row: AIConfigurationRow) -> StoredAIConfig:
    ciphertext = row.api_key_ciphertext
    return StoredAIConfig(
        config=AIConfig(
            enabled=row.enabled,
            provider=row.provider,
            baseUrl=row.base_url,
            model=row.model,
            timeout=row.timeout_seconds,
            maxTokens=row.max_tokens,
            temperature=row.temperature,
            promptVersion=row.prompt_version,
            fallbackMode=row.fallback_mode,
            version=row.version,
            apiKeyConfigured=bool(ciphertext),
        ),
        api_key_ciphertext=ciphertext,
    )
