# Authentication setup

The Angular app calls the FastAPI endpoints in `app.py`. Passwords are hashed
with Argon2id. Browser sessions use an HttpOnly cookie; only the SHA-256 hash of
the random session token is stored in PostgreSQL.

## Database

For a fresh database, `database/schema.sql` creates the `library` schema and
all app tables there. If the existing database already has `library.users`,
apply the needed migrations once in pgAdmin:

1. Run `database/migrations/20261108_create_user_sessions.sql` if
   `library.user_sessions` does not exist.
2. Run `database/migrations/20261109_create_book_and_request_tables.sql` to
   create the books and borrowing tables.

Do not run the fresh-database schema or a migration a second time on a database
that already contains those tables.

To create and verify the tables in a new Neon database, add its connection URL
to the project-root `.env` as `NEON_DATABASE_URL=...`, then run:

```powershell
python database/create_neon_schema.py
```

The script uses `NEON_DATABASE_URL` rather than the app's `DATABASE_URL` so
your local database setting remains unchanged. It checks that the host is a
Neon host, displays the target database, asks for confirmation, refuses to run
if the `library` schema already contains tables, and verifies all six expected
tables after creation. Never paste the connection URL into source code or
commit `.env`.

## Local development

Copy `.env.example` to `.env` and set `DATABASE_URL` to your local PostgreSQL
connection string. Set `DATABASE_SCHEMA` to the schema containing your tables:
use `public` if your local tables are `public.users`, `public.books`, etc.;
otherwise use `library`. It defaults to `library`, which is also the Vercel
schema created by `database/schema.sql`. In PowerShell, load the values before
starting the API:

```powershell
$env:DATABASE_URL = "postgresql://postgres:YOUR_PASSWORD@localhost:5432/library"
$env:DATABASE_SCHEMA = "public"
$env:COOKIE_SECURE = "false"
$env:ENABLE_API_DOCS = "true"
```

For local development, leave `APP_ORIGIN` unset so the API can validate the
same-origin request host. This supports both Swagger at port 8000 and the
Angular dev server through its port-4200 proxy. In production, the API derives
the expected origin from Vercel's forwarded host; set `APP_ORIGIN` only when
you want to restrict it to a specific custom domain.

Install the Python dependencies once, then run these commands in separate
terminals:

```powershell
pip install -r requirements.txt
npm run start:auth
npm start
```

Run the API tests with `python -m pip install -r requirements-dev.txt` and
`python -m pytest -q`.

Open the Angular development URL shown by `npm start`. The dev proxy sends
`/api/auth` to FastAPI on port 8000 and keeps the existing Groq proxy on port
3001. With `ENABLE_API_DOCS=true`, the API docs are available at
`http://127.0.0.1:8000/docs`; ReDoc is at `http://127.0.0.1:8000/redoc`.
Leave `ENABLE_API_DOCS` unset or set it to `false` in production.

## Vercel deployment

Deploy the project root containing `app.py`, `requirements.txt`,
`pyproject.toml`, and `package.json`. The FastAPI Vercel runtime uses
`app.frontend()` to serve the Angular build from `dist/demo/browser`.
`pyproject.toml` runs `npm ci` and `npm run build` during the Vercel build.
If Vercel does not detect FastAPI automatically, select the FastAPI framework
preset for the project.

The API uses Vercel's `POSTGRES_URL` when present, and falls back to
`DATABASE_URL` for local development. The Neon Vercel integration provides
`POSTGRES_URL` automatically. Do not expose either connection URL through
Angular or commit it to Git. Leave `COOKIE_SECURE` unset in Vercel; the API
enables secure cookies when the Vercel runtime is active. The API validates
the request origin against the forwarded Vercel host. Set `APP_ORIGIN` only if
you need to restrict access to one specific custom domain. The session cookie
is scoped to `/api` so it is available to both authentication and library
endpoints.

## Endpoints

- `POST /api/auth/register` — create an account and sign in.
- `POST /api/auth/login` — authenticate and create a session.
- `GET /api/auth/me` — restore the current signed-in user.
- `POST /api/auth/logout` — revoke the session and clear the cookie.
- `GET /api/books?scope=available|mine|all` — list unarchived books; the default
  `available` scope excludes the signed-in user's own books and includes
  `availabilityStatus` (`available`, `reserved`, or `borrowed`) for each
  community book so Discover can show unavailable books without enabling
  requests for them. Book responses include `ownerName`, using the user's
  display name when set and their email as a fallback, and
  `availabilityBorrowerName` for books that are currently borrowed.
- `POST /api/books` — add a book owned by the signed-in user.
- `GET /api/requests?scope=all|incoming|outgoing` — list relevant borrow
  requests.
- `POST /api/requests` — request an available book using `{ "bookId": "..." }`.
- `PATCH /api/requests/{id}` — accept or decline as the owner, cancel as the
  requester, or confirm pickup with `{"action":"confirm_handoff"}` as the
  requester. Accepting requires a future `pickupAt` timestamp.
- `POST /api/requests/{id}/return` — request return as the borrower.
- `PATCH /api/requests/{id}/return` — confirm the return as the book owner.

All library endpoints require the existing signed-in session. State-changing
requests must include the same-origin `Origin` header.

Uploaded covers are resized and JPEG-compressed in the browser, then stored as
a data URL in the book's `cover_url` PostgreSQL column. No separate image
storage service is used.

This first version has no email verification or password reset. Before making
public registration available, add request rate limiting at the edge or via a
shared rate-limit service; in-memory limits are not reliable on serverless
instances.
