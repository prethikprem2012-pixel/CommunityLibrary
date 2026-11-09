import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Generator

import psycopg
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from psycopg.rows import dict_row

logger = logging.getLogger(__name__)

SESSION_COOKIE = "cvl_session"
SESSION_DURATION = timedelta(days=14)
SESSION_MAX_AGE = int(SESSION_DURATION.total_seconds())
password_hasher = PasswordHasher()

api_docs_enabled = os.environ.get("ENABLE_API_DOCS", "false").lower() == "true"
app = FastAPI(
    docs_url="/docs" if api_docs_enabled else None,
    redoc_url="/redoc" if api_docs_enabled else None,
    openapi_url="/openapi.json" if api_docs_enabled else None,
)


@app.middleware("http")
async def disable_auth_response_caching(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/auth/"):
        response.headers["Cache-Control"] = "no-store"
    return response


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class PublicUser(BaseModel):
    id: str
    email: str


class AuthResponse(BaseModel):
    user: PublicUser


def get_connection() -> Generator[psycopg.Connection, None, None]:
    database_url = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication database is not configured.",
        )

    try:
        with psycopg.connect(
            database_url,
            row_factory=dict_row,
            options="-csearch_path=library",
        ) as connection:
            yield connection
    except psycopg.Error as error:
        logger.exception("Authentication database operation failed.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service is temporarily unavailable.",
        ) from error


Connection = Annotated[psycopg.Connection, Depends(get_connection)]


def validate_request_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Request origin could not be verified.",
        )

    configured_origin = os.environ.get("APP_ORIGIN")
    if configured_origin:
        expected_origin = configured_origin.rstrip("/")
    else:
        forwarded_host = request.headers.get("x-forwarded-host")
        host = forwarded_host or request.headers.get("host")
        if host:
            host = host.split(",")[0].strip()
        forwarded_proto = request.headers.get("x-forwarded-proto")
        scheme = (forwarded_proto or request.url.scheme).split(",")[0].strip()
        if not host:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Request origin could not be verified.",
            )
        expected_origin = f"{scheme}://{host}".rstrip("/")

    if origin.rstrip("/") != expected_origin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Request origin could not be verified.",
        )


def set_session_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=raw_token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=os.environ.get("COOKIE_SECURE", "true" if os.environ.get("VERCEL") else "false").lower()
        == "true",
        samesite="lax",
        path="/api/auth",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=os.environ.get("COOKIE_SECURE", "true" if os.environ.get("VERCEL") else "false").lower()
        == "true",
        samesite="lax",
        path="/api/auth",
    )


def issue_session(
    connection: psycopg.Connection,
    user_id: str,
    response: Response,
    previous_token: str | None,
) -> None:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    expires_at = datetime.now(timezone.utc) + SESSION_DURATION
    with connection.cursor() as cursor:
        if previous_token:
            previous_hash = hashlib.sha256(previous_token.encode("utf-8")).hexdigest()
            cursor.execute(
                """
                UPDATE user_sessions
                SET revoked_at = now()
                WHERE token_hash = %s AND revoked_at IS NULL
                """,
                (previous_hash,),
            )
        cursor.execute(
            """
            INSERT INTO user_sessions (user_id, token_hash, expires_at)
            VALUES (%s, %s, %s)
            """,
            (user_id, token_hash, expires_at),
        )
        cursor.execute(
            """
            DELETE FROM user_sessions
            WHERE expires_at < now()
               OR revoked_at < now() - interval '30 days'
            """
        )
    set_session_cookie(response, raw_token)


def find_session_user(
    connection: psycopg.Connection, raw_token: str | None
) -> dict[str, str] | None:
    if not raw_token:
        return None

    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT users.id::text AS id, users.email
            FROM user_sessions
            JOIN users ON users.id = user_sessions.user_id
            WHERE user_sessions.token_hash = %s
              AND user_sessions.revoked_at IS NULL
              AND user_sessions.expires_at > now()
              AND users.disabled_at IS NULL
            """,
            (token_hash,),
        )
        return cursor.fetchone()


def auth_response(
    connection: psycopg.Connection,
    user_id: str,
    email: str,
    response: Response,
    previous_token: str | None,
) -> AuthResponse:
    issue_session(connection, user_id, response, previous_token)
    return AuthResponse(user=PublicUser(id=user_id, email=email))


@app.post(
    "/api/auth/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(
    credentials: Credentials,
    request: Request,
    response: Response,
    connection: Connection,
) -> AuthResponse:
    validate_request_origin(request)
    email = str(credentials.email).strip().lower()
    password_hash = password_hasher.hash(credentials.password)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO users (email, password_hash)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
            RETURNING id::text AS id, email
            """,
            (email, password_hash),
        )
        user = cursor.fetchone()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    return auth_response(
        connection,
        user["id"],
        user["email"],
        response,
        request.cookies.get(SESSION_COOKIE),
    )


@app.post("/api/auth/login", response_model=AuthResponse)
def login(
    credentials: Credentials,
    request: Request,
    response: Response,
    connection: Connection,
) -> AuthResponse:
    validate_request_origin(request)
    email = str(credentials.email).strip().lower()

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id::text AS id, email, password_hash, disabled_at
            FROM users
            WHERE lower(email) = %s
            """,
            (email,),
        )
        user = cursor.fetchone()

    password_is_valid = False
    if user and user["disabled_at"] is None:
        try:
            password_is_valid = password_hasher.verify(
                user["password_hash"], credentials.password
            )
        except VerificationError:
            password_is_valid = False

    if not password_is_valid or not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if password_hasher.check_needs_rehash(user["password_hash"]):
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET password_hash = %s WHERE id = %s",
                (password_hasher.hash(credentials.password), user["id"]),
            )

    return auth_response(
        connection,
        user["id"],
        user["email"],
        response,
        request.cookies.get(SESSION_COOKIE),
    )


@app.get("/api/auth/me", response_model=AuthResponse)
def current_user(
    request: Request,
    response: Response,
    connection: Connection,
) -> AuthResponse | JSONResponse:
    user = find_session_user(connection, request.cookies.get(SESSION_COOKIE))
    if not user:
        unauthenticated = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "You are not signed in."},
        )
        clear_session_cookie(unauthenticated)
        return unauthenticated
    return AuthResponse(user=PublicUser(id=user["id"], email=user["email"]))


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    connection: Connection,
) -> Response:
    validate_request_origin(request)
    raw_token = request.cookies.get(SESSION_COOKIE)
    if raw_token:
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE user_sessions
                SET revoked_at = now()
                WHERE token_hash = %s AND revoked_at IS NULL
                """,
                (token_hash,),
            )
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


if os.environ.get("VERCEL") == "1":
    app.frontend("/", directory="dist/demo/browser")
