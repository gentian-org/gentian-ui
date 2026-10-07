# The store API's definition, as this app is tested against it

`store-api.openapi.yaml` is a copy of the normative definition of the store
API, the file a store is built to and this app calls:

| | |
|---|---|
| Repository | `gentian-org/gentian-os` |
| Path | `docs/plans/artefacts/store-api.openapi.yaml` |
| Copied from commit | `c08e868dda0718880d3c532d58a3b09ed10e673c` (the file's own last change: `d045a521a122ed5123dbf1edf45dfed958522024`) |

It is copied byte for byte and is not edited here. The definition is changed
in gentian-os; this copy is replaced when it is, and the row above with it.

## What it is used for

The suite never talks to a real store. It talks to a fake one
(`tests/fakestore.py`) that serves the examples written in this file, and
every answer the fake gives is validated against this file's schemas as it
is given (`tests/definition.py`). A test that used the fake fails when the fake
answered something the definition does not allow — so what the app is tested
against is the definition, and not somebody's memory of it.

`tests/test_contract.py` also asks every operation of the definition once and
checks that each was answered, so an operation added to the file is noticed
here.
