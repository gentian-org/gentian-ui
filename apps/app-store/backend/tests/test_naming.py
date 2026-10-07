"""The name a store's repository is declared under.

One function of two strings, tested against the worked examples the store
API's definition gives. A store hands over an address and names nothing on
the cluster; if this derivation drifted, a second app from the same registry
would declare a second repository, and its credential would be set on a name
nothing pulls with.
"""

import pytest

from app.store.naming import credential_name, repository_name


@pytest.mark.parametrize(
    ("tenant", "url", "name"),
    [
        # The definition's two rows.
        ("acme", "oci://registry.store.example/apps", "acme-registry-store-example-app-991ae7e1"),
        ("demo", "oci://ghcr.io/example", "demo-ghcr-io-example-59b6b43d"),
        # And the pair it gives for why the hash is always there: the
        # readable part alone is the same for both.
        ("a-b", "oci://c.example", "a-b-c-example-559df09f"),
        ("a", "oci://b.c.example", "a-b-c-example-67520272"),
    ],
)
def test_the_definitions_worked_examples(tenant, url, name):
    assert repository_name(tenant, url) == name


def test_a_name_is_a_dns_label_of_at_most_forty_characters():
    name = repository_name("a-tenant-with-a-long-name", "oci://registry.example.org:5000/a/b/c/d")
    assert len(name) <= 40
    assert name == name.lower()
    assert name[0].isalnum() and name[-1].isalnum()
    assert "--" not in name


def test_the_address_is_lower_cased_before_anything_is_computed():
    assert repository_name("acme", "oci://Registry.Store.Example/apps") == repository_name(
        "acme", "oci://registry.store.example/apps"
    )


def test_the_cut_never_leaves_a_hyphen_before_the_hash():
    # tenant + "-" + slug is cut at 31; here the 31st character is a hyphen.
    name = repository_name("acme", "oci://registry.store.example.a-b/apps")
    stem = name.rsplit("-", 1)[0]
    assert not stem.endswith("-")


def test_only_an_oci_address_has_a_name():
    with pytest.raises(ValueError):
        repository_name("acme", "https://github.com/example/apps.git")


def test_the_credential_is_named_after_the_repository():
    assert credential_name("demo-ghcr-io-example-59b6b43d") == (
        "repository-demo-ghcr-io-example-59b6b43d"
    )
