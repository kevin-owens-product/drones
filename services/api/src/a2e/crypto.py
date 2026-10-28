"""AES-256-GCM helpers.

# STUB: this process uses the cryptography library's AESGCM. That is the
approved algorithm. It is not a CMVP-validated module boundary. Production
images must load a FIPS provider. See ADR 0020.
"""

from __future__ import annotations

import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_BYTES = 12
KEY_BYTES = 32


class CryptoError(Exception):
    pass


def seal(key: bytes, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
    if len(key) != KEY_BYTES:
        raise CryptoError("data key must be 32 bytes")
    nonce = os.urandom(NONCE_BYTES)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, aad)
    return nonce, ciphertext


def open_sealed(key: bytes, nonce: bytes, ciphertext: bytes, aad: bytes) -> bytes:
    if len(key) != KEY_BYTES or len(nonce) != NONCE_BYTES:
        raise CryptoError("invalid key material")
    try:
        return AESGCM(key).decrypt(nonce, ciphertext, aad)
    except Exception as exc:  # cryptography raises InvalidTag
        raise CryptoError("seal failed") from exc
