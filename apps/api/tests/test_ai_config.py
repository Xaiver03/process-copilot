from __future__ import annotations

from typing import Any

import pytest
from cryptography.fernet import Fernet
from process_copilot_api.ai_config import (
    AIConfigPatch,
    AIConfigService,
    StoredAIConfig,
    redact_sensitive_fields,
    resolve_config_from_env,
)
from process_copilot_api.crypto import (
    EncryptionKeyError,
    decrypt_api_key,
    encrypt_api_key,
    rotate_api_key_ciphertext,
)


class MemoryRepository:
    def __init__(self, stored: StoredAIConfig | None = None):
        self.stored = stored
        self.saves: list[tuple[Any, str | None]] = []

    def load(self) -> StoredAIConfig | None:
        return self.stored

    def save(self, config: Any, api_key_ciphertext: str | None) -> StoredAIConfig:
        self.saves.append((config, api_key_ciphertext))
        self.stored = StoredAIConfig(config=config, api_key_ciphertext=api_key_ciphertext)
        return self.stored


def config_patch(**overrides: Any) -> AIConfigPatch:
    values: dict[str, Any] = {
        "enabled": True,
        "provider": "openai-compatible",
        "baseUrl": "https://llm.example.test/v1",
        "model": "sentinel-explainer",
        "timeout": 20,
        "maxTokens": 800,
        "temperature": 0.2,
        "promptVersion": "explain-v1",
        "fallbackMode": "template",
    }
    values.update(overrides)
    return AIConfigPatch(**values)


def test_encrypt_decrypt_roundtrip_uses_authenticated_ciphertext(monkeypatch: pytest.MonkeyPatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("AI_CONFIG_ENCRYPTION_KEY", key)

    ciphertext = encrypt_api_key("secret-api-key")

    assert ciphertext != "secret-api-key"
    assert decrypt_api_key(ciphertext) == "secret-api-key"


def test_missing_or_invalid_encryption_key_rejects_sensitive_save(
    monkeypatch: pytest.MonkeyPatch,
):
    repository = MemoryRepository()
    service = AIConfigService(repository)
    monkeypatch.delenv("AI_CONFIG_ENCRYPTION_KEY", raising=False)

    with pytest.raises(EncryptionKeyError):
        service.update(config_patch(apiKey="secret-api-key"))
    assert repository.saves == []

    monkeypatch.setenv("AI_CONFIG_ENCRYPTION_KEY", "not-a-fernet-key")
    with pytest.raises(EncryptionKeyError):
        service.update(config_patch(apiKey="another-secret"))
    assert repository.saves == []


def test_rotation_reencrypts_with_new_key_and_rejects_wrong_old_key():
    old_key = Fernet.generate_key()
    new_key = Fernet.generate_key()
    wrong_key = Fernet.generate_key()
    ciphertext = encrypt_api_key("secret-api-key", key=old_key)

    rotated = rotate_api_key_ciphertext(ciphertext, old_key=old_key, new_key=new_key)

    assert decrypt_api_key(rotated, key=new_key) == "secret-api-key"
    with pytest.raises(EncryptionKeyError):
        rotate_api_key_ciphertext(ciphertext, old_key=wrong_key, new_key=new_key)


def test_update_preserves_empty_or_omitted_api_key_and_clear_is_explicit(
    monkeypatch: pytest.MonkeyPatch,
):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("AI_CONFIG_ENCRYPTION_KEY", key)
    repository = MemoryRepository()
    service = AIConfigService(repository)

    created = service.update(config_patch(apiKey="original-secret"))
    assert created.apiKeyConfigured is True
    assert created.version == 1
    original_ciphertext = repository.stored.api_key_ciphertext

    updated = service.update(config_patch(model="sentinel-explainer-v2"))
    assert updated.model == "sentinel-explainer-v2"
    assert updated.apiKeyConfigured is True
    assert updated.version == 2
    assert repository.stored.api_key_ciphertext == original_ciphertext

    preserved = service.update(config_patch(apiKey="   "))
    assert preserved.apiKeyConfigured is True
    assert preserved.version == 3
    assert repository.stored.api_key_ciphertext == original_ciphertext

    cleared = service.update(config_patch(clearApiKey=True))
    assert cleared.apiKeyConfigured is False
    assert cleared.version == 4
    assert repository.stored.api_key_ciphertext is None


def test_read_response_never_contains_api_key_or_ciphertext(monkeypatch: pytest.MonkeyPatch):
    key = Fernet.generate_key().decode()
    monkeypatch.setenv("AI_CONFIG_ENCRYPTION_KEY", key)
    repository = MemoryRepository()
    service = AIConfigService(repository)
    service.update(config_patch(apiKey="never-return-this"))

    public = service.get()

    assert public is not None
    payload = public.to_dict()
    assert payload["apiKeyConfigured"] is True
    assert "apiKey" not in payload
    assert "apiKeyCiphertext" not in payload
    assert "never-return-this" not in repr(public)


def test_environment_fallback_is_public_and_does_not_return_raw_key(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("AI_ENABLED", "true")
    monkeypatch.setenv("AI_PROVIDER", "openai-compatible")
    monkeypatch.setenv("AI_BASE_URL", "https://llm.example.test/v1")
    monkeypatch.setenv("AI_MODEL", "sentinel-explainer")
    monkeypatch.setenv("AI_API_KEY", "environment-secret")

    public = resolve_config_from_env()

    assert public is not None
    assert public.enabled is True
    assert public.apiKeyConfigured is True
    assert "environment-secret" not in repr(public)
    assert "apiKey" not in public.to_dict()


def test_sensitive_field_redaction_handles_nested_payloads():
    payload = {
        "provider": "openai-compatible",
        "apiKey": "secret-api-key",
        "nested": {"authorization": "Bearer secret-token", "model": "sentinel"},
        "items": [{"token": "secret-token"}],
    }

    redacted = redact_sensitive_fields(payload)

    assert redacted["apiKey"] == "[REDACTED]"
    assert redacted["nested"]["authorization"] == "[REDACTED]"
    assert redacted["items"][0]["token"] == "[REDACTED]"
    assert redacted["provider"] == "openai-compatible"
