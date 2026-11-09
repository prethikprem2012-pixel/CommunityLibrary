from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from psycopg.rows import dict_row

from app import app, get_connection, psycopg


class FakeCursor:
    def __init__(self, connection: FakeConnection) -> None:
        self.connection = connection
        self.result: dict[str, Any] | None = None

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        normalized = " ".join(query.lower().split())
        self.result = None

        if normalized.startswith("insert into users"):
            email, password_hash = params
            if email in self.connection.users:
                return
            user = {
                "id": str(uuid.uuid4()),
                "email": email,
                "password_hash": password_hash,
                "disabled_at": None,
            }
            self.connection.users[email] = user
            self.result = {"id": user["id"], "email": user["email"]}
        elif normalized.startswith("select id::text as id, email, password_hash"):
            email = params[0]
            self.result = self.connection.users.get(email)
        elif normalized.startswith("insert into user_sessions"):
            user_id, token_hash, expires_at = params
            self.connection.sessions[token_hash] = {
                "user_id": user_id,
                "expires_at": expires_at,
                "revoked_at": None,
            }
        elif normalized.startswith("delete from user_sessions"):
            return
        elif normalized.startswith("select users.id::text as id, users.email"):
            token_hash = params[0]
            session = self.connection.sessions.get(token_hash)
            if session and session["revoked_at"] is None and session["expires_at"] > datetime.now(timezone.utc):
                user = next(
                    (
                        item
                        for item in self.connection.users.values()
                        if item["id"] == session["user_id"] and item["disabled_at"] is None
                    ),
                    None,
                )
                if user:
                    self.result = {"id": user["id"], "email": user["email"]}
        elif normalized.startswith("update user_sessions"):
            token_hash = params[0]
            session = self.connection.sessions.get(token_hash)
            if session:
                session["revoked_at"] = datetime.now(timezone.utc)
        elif normalized.startswith("update users set password_hash"):
            password_hash, user_id = params
            for user in self.connection.users.values():
                if user["id"] == user_id:
                    user["password_hash"] = password_hash
                    break
        else:
            raise AssertionError(f"Unexpected SQL in auth test: {normalized}")

    def fetchone(self) -> dict[str, Any] | None:
        return self.result


class FakeConnection:
    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        self.sessions: dict[str, dict[str, Any]] = {}

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)


@pytest.fixture
def auth_client(monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, FakeConnection]:
    connection = FakeConnection()
    monkeypatch.delenv("APP_ORIGIN", raising=False)
    monkeypatch.setenv("COOKIE_SECURE", "false")

    def provide_connection():
        yield connection

    app.dependency_overrides[get_connection] = provide_connection
    with TestClient(app) as client:
        yield client, connection
    app.dependency_overrides.clear()


def origin_header() -> dict[str, str]:
    return {"Origin": "http://testserver"}


def test_registration_persists_password_hash_and_restores_session(
    auth_client: tuple[TestClient, FakeConnection],
) -> None:
    client, connection = auth_client
    response = client.post(
        "/api/auth/register",
        headers=origin_header(),
        json={"email": "Reader@Example.com", "password": "correct horse battery"},
    )

    assert response.status_code == 201
    assert response.json()["user"]["email"] == "reader@example.com"
    assert response.headers["set-cookie"].startswith("cvl_session=")
    assert response.headers["cache-control"] == "no-store"
    assert next(iter(connection.users.values()))["password_hash"] != "correct horse battery"
    assert list(connection.sessions)[0] not in response.headers["set-cookie"]
    assert client.get("/api/auth/me").json()["user"]["email"] == "reader@example.com"


def test_registration_rejects_duplicate_email(
    auth_client: tuple[TestClient, FakeConnection],
) -> None:
    client, _ = auth_client
    payload = {"email": "reader@example.com", "password": "correct horse battery"}
    assert client.post("/api/auth/register", headers=origin_header(), json=payload).status_code == 201
    duplicate = client.post(
        "/api/auth/register",
        headers=origin_header(),
        json={"email": "READER@example.com", "password": "another good password"},
    )

    assert duplicate.status_code == 409


def test_login_rejects_wrong_password_and_logout_revokes_session(
    auth_client: tuple[TestClient, FakeConnection],
) -> None:
    client, connection = auth_client
    payload = {"email": "reader@example.com", "password": "correct horse battery"}
    client.post("/api/auth/register", headers=origin_header(), json=payload)

    wrong_password = client.post(
        "/api/auth/login",
        headers=origin_header(),
        json={"email": payload["email"], "password": "not the right password"},
    )
    assert wrong_password.status_code == 401

    login = client.post("/api/auth/login", headers=origin_header(), json=payload)
    assert login.status_code == 200
    assert client.get("/api/auth/me").status_code == 200

    logout = client.post("/api/auth/logout", headers=origin_header())
    assert logout.status_code == 204
    assert all(session["revoked_at"] is not None for session in connection.sessions.values())
    assert client.get("/api/auth/me").status_code == 401


def test_state_changing_auth_requests_reject_untrusted_origin(
    auth_client: tuple[TestClient, FakeConnection],
) -> None:
    client, _ = auth_client
    response = client.post(
        "/api/auth/register",
        headers={"Origin": "https://untrusted.example"},
        json={"email": "reader@example.com", "password": "correct horse battery"},
    )

    assert response.status_code == 403


def test_database_connection_prefers_vercel_postgres_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    class ConnectionContext:
        def __enter__(self) -> str:
            return "connection"

        def __exit__(self, *_: object) -> None:
            return None

    def fake_connect(database_url: str, **kwargs: Any) -> ConnectionContext:
        captured["database_url"] = database_url
        captured.update(kwargs)
        return ConnectionContext()

    monkeypatch.setenv("POSTGRES_URL", "postgresql://vercel-neon.example/db")
    monkeypatch.setenv("DATABASE_URL", "postgresql://local.example/db")
    monkeypatch.setattr(psycopg, "connect", fake_connect)

    connection_generator = get_connection()
    assert next(connection_generator) == "connection"
    connection_generator.close()

    assert captured["database_url"] == "postgresql://vercel-neon.example/db"
    assert captured["row_factory"] is dict_row
    assert captured["options"] == "-csearch_path=library"
