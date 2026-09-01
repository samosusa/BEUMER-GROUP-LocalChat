from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from src.errors import AppError


ROOT = Path(__file__).resolve().parent.parent


def validate_against_schema(payload: dict[str, Any], schema_path: str | Path) -> None:
    schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
    details: dict[str, str] = {}
    for field in schema.get("required", []):
        if field not in payload or payload[field] is None:
            details[field] = "is required"

    for field, rules in schema.get("properties", {}).items():
        value = payload.get(field)
        if value is None:
            continue
        expected_type = rules.get("type")
        type_valid = {
            "string": isinstance(value, str),
            "boolean": isinstance(value, bool),
            "object": isinstance(value, dict),
        }.get(expected_type, True)
        if not type_valid:
            details[field] = f"must be a {expected_type}"
            continue
        if isinstance(value, str):
            if rules.get("minLength", 0) > 0 and not value.strip():
                details[field] = "must not be empty"
            elif len(value) < rules.get("minLength", 0):
                details[field] = "must not be empty"
            elif len(value) > rules.get("maxLength", float("inf")):
                details[field] = f"must be at most {rules['maxLength']} characters"

    if details:
        raise AppError("ERR_VALIDATION", "Request validation failed", details, status_code=400)