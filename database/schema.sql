-- Community Library schema for a fresh PostgreSQL database.
-- Authentication and authorization are handled by the Python API.
-- Passwords must be hashed by the API (for example with Argon2id); never store plaintext.

BEGIN;

CREATE SCHEMA IF NOT EXISTS library;
SET LOCAL search_path TO library, public;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CONSTRAINT users_email_not_blank CHECK (length(btrim(email)) > 0),
  CONSTRAINT users_password_hash_not_blank CHECK (length(btrim(password_hash)) > 0)
);

CREATE UNIQUE INDEX users_email_lower_unique_idx ON users (lower(email));

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT user_sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_active_expiry_idx ON user_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title varchar(120) NOT NULL,
  author varchar(80) NOT NULL,
  genre text NOT NULL,
  description varchar(600) NOT NULL,
  cover_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT books_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT books_author_not_blank CHECK (length(btrim(author)) > 0),
  CONSTRAINT books_genre_valid CHECK (genre IN (
    'Mystery', 'Thriller', 'Fantasy', 'Romance', 'Sci-Fi',
    'Non-fiction', 'Biography', 'Classic', 'Self-help',
    'Young Adult', 'Poetry'
  )),
  CONSTRAINT books_description_not_blank CHECK (length(btrim(description)) > 0),
  CONSTRAINT books_cover_url_not_blank CHECK (length(btrim(cover_url)) > 0)
);

CREATE INDEX books_owner_created_idx ON books (owner_id, created_at DESC);
CREATE INDEX books_genre_created_idx ON books (genre, created_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE borrow_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  pickup_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT borrow_requests_status_valid CHECK (status IN (
    'pending',
    'ready_for_delivery',
    'borrowed',
    'returned',
    'declined',
    'cancelled'
  )),
  CONSTRAINT borrow_requests_pickup_time_required CHECK (
    status NOT IN ('ready_for_delivery', 'borrowed', 'returned')
    OR pickup_at IS NOT NULL
  )
);

-- A requester may try again after a declined or cancelled request.
CREATE UNIQUE INDEX borrow_requests_one_active_per_requester_idx
  ON borrow_requests (book_id, requester_id)
  WHERE status IN ('pending', 'ready_for_delivery', 'borrowed');

-- A book can only be reserved for or loaned to one person at a time.
CREATE UNIQUE INDEX borrow_requests_one_current_loan_per_book_idx
  ON borrow_requests (book_id)
  WHERE status IN ('ready_for_delivery', 'borrowed');

CREATE INDEX borrow_requests_requester_created_idx
  ON borrow_requests (requester_id, created_at DESC);
CREATE INDEX borrow_requests_book_status_idx
  ON borrow_requests (book_id, status);

CREATE TABLE return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_request_id uuid NOT NULL UNIQUE
    REFERENCES borrow_requests(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending_confirmation',
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT return_requests_status_valid CHECK (
    status IN ('pending_confirmation', 'confirmed')
  ),
  CONSTRAINT return_requests_confirmation_time_valid CHECK (
    (status = 'pending_confirmation' AND confirmed_at IS NULL)
    OR (status = 'confirmed' AND confirmed_at IS NOT NULL)
  )
);

CREATE INDEX return_requests_status_requested_idx
  ON return_requests (status, requested_at DESC);

CREATE TABLE borrow_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_request_id uuid NOT NULL
    REFERENCES borrow_requests(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT borrow_request_events_type_valid CHECK (event_type IN (
    'request_created',
    'approved',
    'declined',
    'handoff_confirmed',
    'return_requested',
    'return_confirmed',
    'cancelled'
  ))
);

CREATE INDEX borrow_request_events_request_time_idx
  ON borrow_request_events (borrow_request_id, occurred_at);

COMMIT;
