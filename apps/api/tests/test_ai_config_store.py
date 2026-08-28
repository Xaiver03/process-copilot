import pytest
from cryptography.fernet import Fernet
from process_copilot_api.ai_config import AIConfig, AIConfigPatch, AIConfigService
from process_copilot_api.ai_config_store import (
    AIConfigConflictError,
    SQLAlchemyAIConfigRepository,
)
from process_copilot_api.db import AIConfigurationRow, Database


def initial_patch(**overrides):
    values = {
        "enabled": True,
        "provider": "openai-compatible",
        "baseUrl": "https://provider.example/v1",
        "model": "demo-model",
        "timeout": 8,
        "maxTokens": 500,
        "temperature": 0.2,
        "promptVersion": "event-copilot-v01",
        "fallbackMode": "template",
        "apiKey": "provider-secret",
    }
    values.update(overrides)
    return AIConfigPatch(**values)


def test_sqlalchemy_config_repository_persists_only_ciphertext(tmp_path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'config.db'}")
    database.create_schema()
    repository = SQLAlchemyAIConfigRepository(database)
    environ = {"AI_CONFIG_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii")}
    service = AIConfigService(repository, environ=environ)

    public = service.update(initial_patch())

    assert public.apiKeyConfigured is True
    assert public.version == 1
    assert service.get() == public
    with database.session() as session:
        row = session.get(AIConfigurationRow, "default")
        assert row is not None
        assert row.api_key_ciphertext != "provider-secret"
        assert "provider-secret" not in row.api_key_ciphertext


def test_repository_rejects_stale_version_write(tmp_path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'conflict.db'}")
    database.create_schema()
    repository = SQLAlchemyAIConfigRepository(database)
    first = AIConfig(
        enabled=False,
        provider="disabled",
        baseUrl="https://localhost",
        model="none",
        timeout=8,
        maxTokens=500,
        temperature=0,
        promptVersion="event-copilot-v01",
        fallbackMode="template",
        version=1,
    )
    repository.save(first, None)
    stale = AIConfig(**{**first.to_dict(), "version": 3})

    with pytest.raises(AIConfigConflictError):
        repository.save(stale, None)
