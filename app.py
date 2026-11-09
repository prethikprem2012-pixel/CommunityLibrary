import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Generator, Literal
from uuid import UUID

import psycopg
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
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
    if request.url.path.startswith("/api/"):
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


Genre = Literal[
    "Mystery",
    "Thriller",
    "Fantasy",
    "Romance",
    "Sci-Fi",
    "Non-fiction",
    "Biography",
    "Classic",
    "Self-help",
    "Young Adult",
    "Poetry",
]


class BookInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=120)
    author: str = Field(min_length=1, max_length=80)
    genre: Genre
    description: str = Field(min_length=1, max_length=600)
    cover_url: str = Field(alias="coverUrl", min_length=1, max_length=2_000_000)

    @field_validator("title", "author", "description", "cover_url")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field must not be blank.")
        return value


class BookResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    author: str
    genre: Genre
    description: str
    cover_url: str = Field(alias="coverUrl")
    owner_id: str = Field(alias="ownerId")
    owner_name: str = Field(alias="ownerName")
    owner_email: EmailStr = Field(alias="ownerEmail")
    created_at: datetime = Field(alias="createdAt")
    availability_status: Literal["available", "reserved", "borrowed"] = Field(
        alias="availabilityStatus"
    )
    availability_borrower_name: str | None = Field(
        default=None, alias="availabilityBorrowerName"
    )


class BorrowRequestInput(BaseModel):
    book_id: UUID = Field(alias="bookId")


class BorrowRequestAction(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    action: Literal["accept", "decline", "cancel", "confirm_handoff"]
    pickup_at: datetime | None = Field(default=None, alias="pickupAt")


class BorrowRequestResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    book_id: str = Field(alias="bookId")
    book_title: str = Field(alias="bookTitle")
    book_author: str = Field(alias="bookAuthor")
    book_cover_url: str = Field(alias="bookCoverUrl")
    requester_email: EmailStr = Field(alias="requesterEmail")
    owner_email: EmailStr = Field(alias="ownerEmail")
    status: Literal[
        "pending",
        "ready_for_delivery",
        "borrowed",
        "returned",
        "declined",
        "cancelled",
    ]
    pickup_at: datetime | None = Field(alias="pickupAt")
    created_at: datetime = Field(alias="createdAt")
    return_status: Literal["pending_confirmation", "confirmed"] | None = Field(
        alias="returnStatus"
    )
    return_requested_at: datetime | None = Field(alias="returnRequestedAt")


class ReturnRequestResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: Literal["pending_confirmation", "confirmed"]
    requested_at: datetime = Field(alias="requestedAt")


def get_connection() -> Generator[psycopg.Connection, None, None]:
    database_url = os.environ.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication database is not configured.",
        )
    database_schema = os.environ.get("DATABASE_SCHEMA", "library")
    if database_schema not in {"library", "public"}:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_SCHEMA must be either 'library' or 'public'.",
        )

    try:
        with psycopg.connect(
            database_url,
            row_factory=dict_row,
        ) as connection:
            connection.execute(f"SET search_path TO {database_schema}")
            yield connection
    except psycopg.Error as error:
        logger.exception("Database operation failed.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The service is temporarily unavailable.",
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
    clear_session_cookie(response)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=raw_token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=os.environ.get("COOKIE_SECURE", "true" if os.environ.get("VERCEL") else "false").lower()
        == "true",
        samesite="lax",
        path="/api",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=os.environ.get("COOKIE_SECURE", "true" if os.environ.get("VERCEL") else "false").lower()
        == "true",
        samesite="lax",
        path="/api",
    )
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


def require_current_user(
    request: Request,
    connection: Connection,
) -> dict[str, str]:
    user = find_session_user(connection, request.cookies.get(SESSION_COOKIE))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="You are not signed in.",
        )
    return user


CurrentUser = Annotated[dict[str, str], Depends(require_current_user)]

BOOK_SELECT = """
    SELECT books.id::text AS id,
           books.title,
           books.author,
           books.genre,
           books.description,
           books.cover_url,
           books.owner_id::text AS owner_id,
           COALESCE(NULLIF(BTRIM(users.display_name), ''), users.email) AS owner_name,
           users.email AS owner_email,
           books.created_at,
           CASE (
               SELECT borrow_requests.status
               FROM borrow_requests
               WHERE borrow_requests.book_id = books.id
                 AND borrow_requests.status IN ('ready_for_delivery', 'borrowed')
               ORDER BY CASE borrow_requests.status
                   WHEN 'borrowed' THEN 0
                   ELSE 1
               END
               LIMIT 1
           )
               WHEN 'borrowed' THEN 'borrowed'
               WHEN 'ready_for_delivery' THEN 'reserved'
               ELSE 'available'
           END AS availability_status,
           (
               SELECT COALESCE(NULLIF(BTRIM(requester.display_name), ''), requester.email)
               FROM borrow_requests AS active_request
               JOIN users AS requester ON requester.id = active_request.requester_id
               WHERE active_request.book_id = books.id
                 AND active_request.status = 'borrowed'
               LIMIT 1
           ) AS availability_borrower_name
    FROM books
    JOIN users ON users.id = books.owner_id
"""

REQUEST_SELECT = """
    SELECT requests.id::text AS id,
           requests.book_id::text AS book_id,
           books.title AS book_title,
           books.author AS book_author,
           books.cover_url AS book_cover_url,
           requester.email AS requester_email,
           owner.email AS owner_email,
           requests.status,
           requests.pickup_at,
           requests.created_at,
           returns.status AS return_status,
           returns.requested_at AS return_requested_at
    FROM borrow_requests AS requests
    JOIN books AS books ON books.id = requests.book_id
    JOIN users AS requester ON requester.id = requests.requester_id
    JOIN users AS owner ON owner.id = books.owner_id
    LEFT JOIN return_requests AS returns
      ON returns.borrow_request_id = requests.id
"""


def fetch_borrow_request(
    connection: psycopg.Connection, request_id: UUID
) -> BorrowRequestResponse:
    with connection.cursor() as cursor:
        cursor.execute(
            REQUEST_SELECT + " WHERE requests.id = %s",
            (request_id,),
        )
        request = cursor.fetchone()
    if not request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Borrow request not found.",
        )
    return BorrowRequestResponse.model_validate(request)


def record_request_event(
    connection: psycopg.Connection,
    request_id: UUID,
    actor_id: str,
    event_type: str,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO borrow_request_events
                (borrow_request_id, actor_user_id, event_type)
            VALUES (%s, %s, %s)
            """,
            (request_id, actor_id, event_type),
        )


@app.get("/api/books", response_model=list[BookResponse])
def view_books(
    current_user: CurrentUser,
    connection: Connection,
    scope: Literal["available", "mine", "all"] = "available",
) -> list[BookResponse]:
    query = BOOK_SELECT + " WHERE books.archived_at IS NULL"
    parameters: tuple[str, ...] = ()
    if scope == "available":
        query += " AND books.owner_id <> %s"
        parameters = (current_user["id"],)
    elif scope == "mine":
        query += " AND books.owner_id = %s"
        parameters = (current_user["id"],)
    query += " ORDER BY books.created_at DESC, books.id"

    with connection.cursor() as cursor:
        cursor.execute(query, parameters)
        return [BookResponse.model_validate(book) for book in cursor.fetchall()]


@app.post(
    "/api/books",
    response_model=BookResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_book(
    book: BookInput,
    request: Request,
    current_user: CurrentUser,
    connection: Connection,
) -> BookResponse:
    validate_request_origin(request)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO books
                (owner_id, title, author, genre, description, cover_url)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id::text AS id,
                      title,
                      author,
                      genre,
                      description,
                      cover_url,
                      owner_id::text AS owner_id,
                      created_at,
                      (SELECT COALESCE(NULLIF(BTRIM(users.display_name), ''), users.email)
                       FROM users
                       WHERE users.id = owner_id) AS owner_name,
                      'available'::text AS availability_status,
                      NULL::text AS availability_borrower_name
            """,
            (
                current_user["id"],
                book.title,
                book.author,
                book.genre,
                book.description,
                book.cover_url,
            ),
        )
        created_book = cursor.fetchone()

    if not created_book:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The book could not be created.",
        )
    created_book["owner_email"] = current_user["email"]
    return BookResponse.model_validate(created_book)


@app.get("/api/requests", response_model=list[BorrowRequestResponse])
def view_requests(
    current_user: CurrentUser,
    connection: Connection,
    scope: Literal["all", "incoming", "outgoing"] = "all",
) -> list[BorrowRequestResponse]:
    query = REQUEST_SELECT + """
        WHERE (requests.requester_id = %s OR books.owner_id = %s)
    """
    parameters: tuple[str, ...] = (current_user["id"], current_user["id"])
    if scope == "incoming":
        query += " AND books.owner_id = %s"
        parameters += (current_user["id"],)
    elif scope == "outgoing":
        query += " AND requests.requester_id = %s"
        parameters += (current_user["id"],)
    query += " ORDER BY requests.created_at DESC, requests.id"

    with connection.cursor() as cursor:
        cursor.execute(query, parameters)
        return [
            BorrowRequestResponse.model_validate(borrow_request)
            for borrow_request in cursor.fetchall()
        ]


@app.post(
    "/api/requests",
    response_model=BorrowRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def request_book(
    borrow_request: BorrowRequestInput,
    request: Request,
    current_user: CurrentUser,
    connection: Connection,
) -> BorrowRequestResponse:
    validate_request_origin(request)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT owner_id::text AS owner_id
            FROM books
            WHERE id = %s AND archived_at IS NULL
            FOR UPDATE
            """,
            (borrow_request.book_id,),
        )
        book = cursor.fetchone()

    if not book:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Book not found.",
        )
    if book["owner_id"] == current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot request your own book.",
        )

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id
            FROM borrow_requests
            WHERE book_id = %s AND status IN ('ready_for_delivery', 'borrowed')
            LIMIT 1
            """,
            (borrow_request.book_id,),
        )
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This book is currently reserved or borrowed.",
            )
        try:
            cursor.execute(
                """
                INSERT INTO borrow_requests (book_id, requester_id)
                VALUES (%s, %s)
                RETURNING id
                """,
                (borrow_request.book_id, current_user["id"]),
            )
            created_request = cursor.fetchone()
        except psycopg.errors.UniqueViolation as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="You already have an active request for this book.",
            ) from error

    if not created_request:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This book is no longer available.",
        )
    request_id = created_request["id"]
    record_request_event(
        connection,
        request_id,
        current_user["id"],
        "request_created",
    )
    return fetch_borrow_request(connection, request_id)


@app.patch(
    "/api/requests/{request_id}",
    response_model=BorrowRequestResponse,
)
def update_borrow_request(
    request_id: UUID,
    action: BorrowRequestAction,
    request: Request,
    current_user: CurrentUser,
    connection: Connection,
) -> BorrowRequestResponse:
    validate_request_origin(request)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT requests.id,
                   requests.requester_id::text AS requester_id,
                   requests.status,
                   books.owner_id::text AS owner_id
            FROM borrow_requests AS requests
            JOIN books AS books ON books.id = requests.book_id
            WHERE requests.id = %s
            FOR UPDATE OF requests, books
            """,
            (request_id,),
        )
        borrow_request = cursor.fetchone()

    if not borrow_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Borrow request not found.",
        )

    event_types = {
        "accept": "approved",
        "decline": "declined",
        "cancel": "cancelled",
        "confirm_handoff": "handoff_confirmed",
    }

    if action.action in {"accept", "decline"}:
        if borrow_request["owner_id"] != current_user["id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the book owner can accept or decline this request.",
            )
        if borrow_request["status"] != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only pending requests can be accepted or declined.",
            )
        if action.action == "accept":
            pickup_at = action.pickup_at
            if (
                pickup_at is None
                or pickup_at.tzinfo is None
                or pickup_at.utcoffset() is None
                or pickup_at <= datetime.now(timezone.utc)
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="A future pickupAt timestamp with a timezone is required.",
                )
            with connection.cursor() as cursor:
                try:
                    cursor.execute(
                        """
                        UPDATE borrow_requests
                        SET status = 'ready_for_delivery',
                            pickup_at = %s,
                            updated_at = now()
                        WHERE id = %s
                        """,
                        (pickup_at, request_id),
                    )
                except psycopg.errors.UniqueViolation as error:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Another request for this book is already reserved.",
                    ) from error
        else:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE borrow_requests
                    SET status = 'declined', updated_at = now()
                    WHERE id = %s
                    """,
                    (request_id,),
                )
    elif action.action == "cancel":
        if borrow_request["requester_id"] != current_user["id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the requester can cancel this request.",
            )
        if borrow_request["status"] not in {"pending", "ready_for_delivery"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only pending or accepted requests can be cancelled.",
            )
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE borrow_requests
                SET status = 'cancelled', updated_at = now()
                WHERE id = %s
                """,
                (request_id,),
            )
    else:
        if borrow_request["requester_id"] != current_user["id"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the requester can confirm pickup.",
            )
        if borrow_request["status"] != "ready_for_delivery":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only accepted requests can be marked as borrowed.",
            )
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE borrow_requests
                SET status = 'borrowed', updated_at = now()
                WHERE id = %s
                """,
                (request_id,),
            )

    record_request_event(
        connection,
        request_id,
        current_user["id"],
        event_types[action.action],
    )
    return fetch_borrow_request(connection, request_id)


@app.post(
    "/api/requests/{request_id}/return",
    response_model=ReturnRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def request_return(
    request_id: UUID,
    request: Request,
    current_user: CurrentUser,
    connection: Connection,
) -> ReturnRequestResponse:
    validate_request_origin(request)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT requests.requester_id::text AS requester_id,
                   requests.status
            FROM borrow_requests AS requests
            JOIN books AS books ON books.id = requests.book_id
            WHERE requests.id = %s
            FOR UPDATE OF requests, books
            """,
            (request_id,),
        )
        borrow_request = cursor.fetchone()

    if not borrow_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Borrow request not found.",
        )
    if borrow_request["requester_id"] != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the borrower can request a return.",
        )
    if borrow_request["status"] != "borrowed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only borrowed books can be returned.",
        )

    with connection.cursor() as cursor:
        try:
            cursor.execute(
                """
                INSERT INTO return_requests (borrow_request_id)
                VALUES (%s)
                RETURNING status, requested_at
                """,
                (request_id,),
            )
            return_request = cursor.fetchone()
        except psycopg.errors.UniqueViolation as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A return has already been requested for this book.",
            ) from error

    record_request_event(
        connection,
        request_id,
        current_user["id"],
        "return_requested",
    )
    return ReturnRequestResponse.model_validate(return_request)


@app.patch(
    "/api/requests/{request_id}/return",
    response_model=ReturnRequestResponse,
)
def accept_return(
    request_id: UUID,
    request: Request,
    current_user: CurrentUser,
    connection: Connection,
) -> ReturnRequestResponse:
    validate_request_origin(request)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT returns.status,
                   returns.requested_at,
                   books.owner_id::text AS owner_id
            FROM return_requests AS returns
            JOIN borrow_requests AS requests
              ON requests.id = returns.borrow_request_id
            JOIN books AS books ON books.id = requests.book_id
            WHERE returns.borrow_request_id = %s
            FOR UPDATE OF returns, requests, books
            """,
            (request_id,),
        )
        return_request = cursor.fetchone()

    if not return_request:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Return request not found.",
        )
    if return_request["owner_id"] != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the book owner can confirm its return.",
        )
    if return_request["status"] != "pending_confirmation":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This return has already been confirmed.",
        )

    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE return_requests
            SET status = 'confirmed', confirmed_at = now()
            WHERE borrow_request_id = %s
            """,
            (request_id,),
        )
        cursor.execute(
            """
            UPDATE borrow_requests
            SET status = 'returned', updated_at = now()
            WHERE id = %s
            """,
            (request_id,),
        )

    record_request_event(
        connection,
        request_id,
        current_user["id"],
        "return_confirmed",
    )
    return ReturnRequestResponse(
        status="confirmed",
        requestedAt=return_request["requested_at"],
    )


if os.environ.get("VERCEL") == "1":
    app.frontend("/", directory="dist/demo/browser")
