from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from a2e.chain import GENESIS, audit_payload, canonical_json, chain_hash
from a2e.crypto import CryptoError, open_sealed, seal
from a2e.decisions import combine


def test_seal_round_trip_and_aad() -> None:
    key = b"k" * 32
    nonce, ciphertext = seal(key, b"{\"tail\":\"N-001\"}", b"tenant:platform")
    assert open_sealed(key, nonce, ciphertext, b"tenant:platform") == b"{\"tail\":\"N-001\"}"
    try:
        open_sealed(key, nonce, ciphertext, b"other")
    except CryptoError:
        return
    raise AssertionError("tampered associated data was accepted")


def test_chain_links() -> None:
    first = chain_hash(GENESIS, "{}")
    second = chain_hash(first, "{\"a\":1}")
    assert first != GENESIS
    assert second != first
    assert len(first) == 64


def test_canonical_is_stable() -> None:
    left = canonical_json({"b": 1, "a": "x"})
    right = canonical_json({"a": "x", "b": 1})
    assert left == right == '{"a":"x","b":1}'


def test_audit_payload_binds_id() -> None:
    event_id = UUID("33333333-3333-4333-8333-333333333301")
    body = audit_payload(
        event_id=event_id,
        occurred_at=datetime(2026, 10, 28, 17, 0, tzinfo=timezone.utc),
        actor_id=event_id,
        tenant_id=None,
        action="release.export",
        resource_type="platform",
        resource_id=None,
        decision="deny",
        reason_codes=["not_found"],
        classification="UNCLASSIFIED",
        caveats=[],
        ntk_programs=[],
    )
    encoded = canonical_json(body)
    assert str(event_id) in encoded
    assert '"tenant_id":null' in encoded


def test_combine_fail_closed() -> None:
    assert combine(True, True, []).allow
    denied = combine(True, False, ["role_denied"])
    assert not denied.allow
    assert denied.reasons == ("role_denied",)
    clash = combine(False, True, [])
    assert clash.disagreement
    assert not clash.allow
    down = combine(True, None, [])
    assert down.unavailable
    assert down.reasons == ("opa_unavailable",)
