from __future__ import annotations

from typing import Any

import pytest

from database import create_neon_schema


class FakeResult:
    def __init__(self, rows: list[tuple[str]]) -> None:
        self.rows = rows

    def fetchall(self) -> list[tuple[str]]:
        return self.rows


class FakeConnection:
    def __init__(self, existing_tables: list[tuple[str]] | None = None) -> None:
        self.existing_tables = existing_tables or []
        self.executed_schema: str | None = None
        self.schema_check_count = 0

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, query: str, **kwargs: Any) -> FakeResult:
        if "information_schema.tables" in query:
            self.schema_check_count += 1
            if self.schema_check_count == 1:
                return FakeResult(self.existing_tables)
            return FakeResult([(name,) for name in sorted(create_neon_schema.EXPECTED_TABLES)])
        self.executed_schema = query
        return FakeResult([])


def test_setup_creates_and_verifies_tables_for_neon(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    connection = FakeConnection()
    monkeypatch.setenv(
        "NEON_DATABASE_URL",
        "postgresql://test:secret@ep-example-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
    )
    monkeypatch.setattr(create_neon_schema.psycopg, "connect", lambda *args, **kwargs: connection)
    monkeypatch.setattr("builtins.input", lambda _: "CREATE")

    result = create_neon_schema.main([])

    output = capsys.readouterr().out
    assert result == 0
    assert connection.executed_schema is not None
    assert "CREATE SCHEMA IF NOT EXISTS library" in connection.executed_schema
    assert "library.users" in output
    assert "library.borrow_request_events" in output
    assert "secret" not in output


def test_setup_refuses_database_with_existing_library_tables(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    connection = FakeConnection(existing_tables=[("users",)])
    monkeypatch.setenv(
        "NEON_DATABASE_URL",
        "postgresql://test:secret@ep-example-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
    )
    monkeypatch.setattr(create_neon_schema.psycopg, "connect", lambda *args, **kwargs: connection)
    monkeypatch.setattr("builtins.input", lambda _: "CREATE")

    result = create_neon_schema.main([])

    assert result == 1
    assert connection.executed_schema is None
    assert "already contains tables" in capsys.readouterr().err


def test_setup_rejects_non_neon_host_without_connecting(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://test:secret@localhost:5432/library")

    def fail_if_connected(*args: object, **kwargs: object) -> None:
        raise AssertionError("Must reject non-Neon URL before connecting.")

    monkeypatch.setattr(create_neon_schema.psycopg, "connect", fail_if_connected)

    assert create_neon_schema.main([]) == 1
    assert "only runs against Neon hosts" in capsys.readouterr().err


def test_setup_does_not_use_local_app_database_url(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://local:secret@localhost:5432/library")

    assert create_neon_schema.main([]) == 1
    assert "NEON_DATABASE_URL is not set" in capsys.readouterr().err
