"""A tenant choosing who can read its scheduled backups."""

import pytest

from app.services.age_keys import looks_like_recipient, mint


def test_a_minted_key_is_an_age_key_pair():
    identity, recipient = mint()
    # The shapes age itself produces. Verified against the real binary
    # separately; this is the guard against a change quietly breaking them.
    assert identity.startswith("AGE-SECRET-KEY-1") and len(identity) == 74
    assert recipient.startswith("age1") and len(recipient) == 62
    assert looks_like_recipient(recipient)


def test_every_mint_is_different():
    """A generator that repeats would give two tenants the same key and neither
    of them a private backup."""
    seen = {mint()[1] for _ in range(16)}
    assert len(seen) == 16


def test_obvious_nonsense_is_not_taken_for_a_key():
    for bad in ["", "hunter2", "age1", "AGE-SECRET-KEY-1ABC", "age1" + "!" * 58]:
        assert not looks_like_recipient(bad)


@pytest.mark.asyncio
async def test_the_platform_key_is_written_explicitly_not_left_implied():
    """Switching back to the platform key must clear the tenant's recipients.

    An explicit null, not an omitted key: the spec is merge-patched, and a
    merge patch leaves an omitted field exactly as it was. Omitting it would
    leave a tenant that changed its mind still encrypting to a key it thought
    it had stopped using — and the export would still succeed, which is the
    worst shape that mistake can take. null is how a merge patch deletes.
    """
    from app.api.routes.admin import BackupScheduleEncryptionModel, _schedule_encryption

    spec = _schedule_encryption(BackupScheduleEncryptionModel(mode="platform"))
    assert spec == {"mode": "recipient", "recipients": None}


def test_own_mode_carries_the_tenants_recipients():
    from app.api.routes.admin import BackupScheduleEncryptionModel, _schedule_encryption

    _, recipient = mint()
    spec = _schedule_encryption(
        BackupScheduleEncryptionModel(mode="own", recipients=[f"  {recipient}  "])
    )
    assert spec["mode"] == "recipient"
    assert spec["recipients"] == [recipient]


def test_own_mode_without_a_key_is_refused():
    from fastapi import HTTPException

    from app.api.routes.admin import BackupScheduleEncryptionModel, _schedule_encryption

    with pytest.raises(HTTPException) as caught:
        _schedule_encryption(BackupScheduleEncryptionModel(mode="own", recipients=[]))
    assert caught.value.status_code == 400


def test_a_mistyped_key_is_refused_at_the_form_not_at_0300():
    from fastapi import HTTPException

    from app.api.routes.admin import BackupScheduleEncryptionModel, _schedule_encryption

    with pytest.raises(HTTPException) as caught:
        _schedule_encryption(
            BackupScheduleEncryptionModel(mode="own", recipients=["age1nonsense"])
        )
    assert caught.value.status_code == 400
    assert "age1" in caught.value.detail
