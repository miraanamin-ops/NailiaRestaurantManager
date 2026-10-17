"""Stable ids: the same dataset and the same natural key always give the same uuid,
so every run (and the fixture and the full dataset) agree."""

import uuid

NS = uuid.UUID("9b7d2c1e-5f3a-4e8b-a1c6-0d2e4f6a8b10")


def uid(*parts) -> str:
    return str(uuid.uuid5(NS, ":".join(str(p) for p in parts)))
