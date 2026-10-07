"""The store API's definition, read from the vendored copy.

`Contract.check` validates one answer of the fake store against the schema
the definition gives for that operation and status. See contract/README.md.
"""

import json
import re
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

DEFINITION = Path(__file__).parent / "contract" / "store-api.openapi.yaml"
_BASE = "urn:store-api"


class Contract:
    def __init__(self) -> None:
        self.document = yaml.safe_load(DEFINITION.read_text(encoding="utf-8"))
        resource = Resource.from_contents(self.document, default_specification=DRAFT202012)
        self._registry = Registry().with_resource(_BASE, resource)
        self._routes = [
            (re.compile("^" + re.sub(r"\{[^}]+\}", "[^/]+", path) + "$"), path)
            for path in self.document["paths"]
        ]

    def _resolve(self, node: Any) -> Any:
        """Follow a `$ref` of the document's own, for the parts that are not
        schemas: responses, examples."""
        while isinstance(node, dict) and "$ref" in node:
            pointer = node["$ref"].removeprefix("#/").split("/")
            node = self.document
            for part in pointer:
                node = node[part]
        return node

    def example(self, name: str) -> Any:
        """One of the definition's named examples, as a fresh value."""
        return json.loads(json.dumps(self.document["components"]["examples"][name]["value"]))

    def operation_example(self, path: str, method: str, status: str, name: str) -> Any:
        """An example written at an operation's response."""
        response = self._resolve(self.document["paths"][path][method]["responses"][status])
        media = next(iter(response["content"].values()))
        return json.loads(json.dumps(self._resolve(media["examples"][name])["value"]))

    def response_example(self, name: str) -> Any:
        """The example of one of the definition's shared error responses."""
        response = self.document["components"]["responses"][name]
        media = next(iter(response["content"].values()))
        example = self._resolve(next(iter(media["examples"].values())))
        return json.loads(json.dumps(example["value"]))

    def operations(self) -> list[tuple[str, str]]:
        return [
            (method.upper(), path)
            for path, item in self.document["paths"].items()
            for method in item
            if method in ("get", "post", "put", "delete", "patch")
        ]

    def template(self, path: str) -> str | None:
        return next((template for pattern, template in self._routes if pattern.match(path)), None)

    def check(
        self, method: str, path: str, status: int, content_type: str, body: bytes
    ) -> list[str]:
        """What is wrong with one answer, as the definition sees it."""
        template = self.template(path)
        if template is None:
            return [f"{method} {path}: the definition has no such path"]
        operation = self.document["paths"][template].get(method.lower())
        if operation is None:
            return [f"{method} {template}: the definition has no such operation"]
        where = f"{method} {template} {status}"
        response = operation["responses"].get(str(status))
        if response is None:
            return [f"{where}: the definition does not give this status"]
        response = self._resolve(response)
        content = response.get("content")
        if not content:
            return [f"{where}: carries a body, and the definition gives none"] if body else []
        media_type = content_type.split(";", 1)[0].strip()
        if media_type not in content:
            return [f"{where}: is {media_type or 'untyped'}, the definition says {list(content)}"]
        try:
            value = json.loads(body)
        except ValueError:
            return [f"{where}: is not JSON"]
        schema = content[media_type]["schema"]
        if "$ref" in schema:
            schema = {"$ref": _BASE + schema["$ref"]}
        else:
            schema = self._absolute(schema)
        validator = Draft202012Validator(schema, registry=self._registry)
        return [
            f"{where}: {'/'.join(map(str, error.absolute_path)) or '(body)'}: {error.message}"
            for error in validator.iter_errors(value)
        ]

    def _absolute(self, node: Any) -> Any:
        """An inline schema with its references made absolute, so they
        resolve against the document wherever the schema is used from."""
        if isinstance(node, dict):
            return {
                key: (
                    _BASE + value
                    if key == "$ref" and isinstance(value, str)
                    else self._absolute(value)
                )
                for key, value in node.items()
            }
        if isinstance(node, list):
            return [self._absolute(item) for item in node]
        return node
