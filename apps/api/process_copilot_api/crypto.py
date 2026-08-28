"""Authenticated encryption helpers for server-side AI provider credentials."""

from __future__ import annotations

import os
from collections.abc import Mapping

from cryptography.fernet import Fernet, InvalidToken


class EncryptionKeyError(ValueError):
    """Raised when the configured key is absent, malformed, or cannot decrypt."""


def _validated_fernet(
    key: str | bytes | None = None, *, environ: Mapping[str, str] | None = None
) -> Fernet:
    if key is None:
        key = (environ if environ is not None else os.environ).get("AI_CONFIG_ENCRYPTION_KEY")
    if isinstance(key, str):
        try:
            key = key.encode("ascii")
        except UnicodeEncodeError as exc:
            raise EncryptionKeyError("AI_CONFIG_ENCRYPTION_KEY is invalid") from exc
    if not key:
        raise EncryptionKeyError("AI_CONFIG_ENCRYPTION_KEY is required")
    try:
        return Fernet(key)
    except (TypeError, ValueError) as exc:
        raise EncryptionKeyError("AI_CONFIG_ENCRYPTION_KEY is invalid") from exc


def encrypt_api_key(
    api_key: str,
    *,
    key: str | bytes | None = None,
    environ: Mapping[str, str] | None = None,
) -> str:
    """Encrypt a non-empty provider key and return only its Fernet ciphertext."""
    if not isinstance(api_key, str) or not api_key:
        raise ValueError("api_key must be a non-empty string")
    return _validated_fernet(key, environ=environ).encrypt(api_key.encode("utf-8")).decode("ascii")


def decrypt_api_key(
    ciphertext: str,
    *,
    key: str | bytes | None = None,
    environ: Mapping[str, str] | None = None,
) -> str:
    """Decrypt a provider key; malformed ciphertext never falls back to plaintext."""
    if not isinstance(ciphertext, str) or not ciphertext:
        raise EncryptionKeyError("API key ciphertext is invalid")
    try:
        plaintext = _validated_fernet(key, environ=environ).decrypt(ciphertext.encode("ascii"))
    except (InvalidToken, UnicodeError, ValueError, TypeError) as exc:
        raise EncryptionKeyError("API key ciphertext cannot be decrypted") from exc
    return plaintext.decode("utf-8")


def rotate_api_key_ciphertext(
    ciphertext: str,
    *,
    old_key: str | bytes,
    new_key: str | bytes,
) -> str:
    """Decrypt with the old key and re-encrypt with the new key atomically in memory."""
    plaintext = decrypt_api_key(ciphertext, key=old_key)
    return encrypt_api_key(plaintext, key=new_key)
