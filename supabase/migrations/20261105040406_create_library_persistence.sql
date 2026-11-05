/*
# Create Community Library persistence tables

1. New tables
- `profiles`: one public account profile per signed-in user, linked to Supabase Auth.
- `books`: books shared by users, including the owner and cover URL.
- `borrow_requests`: requests from borrowers to book owners, with a controlled request status.

2. Columns and relationships
- `profiles.id` matches `auth.users.id`; `display_name` is optional and `email` is stored for display.
- `books.owner_id` identifies who shared a book. Title, author, genre, description, and cover URL are stored with timestamps.
- `borrow_requests.book_id`, `requester_id`, and `owner_id` link each request to the book, borrower, and owner.

3. Security
- Row Level Security is enabled on every table.
- Signed-in users can read shared books.
- Users can create, update, and delete only their own books.
- Users can read requests where they are the borrower or book owner.
- Only the borrower can create or remove their own request.
- Only the book owner can update a request status.
- Grants are limited to the authenticated role.

4. Important notes
- No existing tables or user data are modified.
- Cover images remain URL/data values for this lightweight prototype; file storage is not added.
- The `status` check keeps request state limited to `pending`, `ready_for_delivery`, or `declined`.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  author text NOT NULL,
  genre text NOT NULL,
  description text NOT NULL,
  cover_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.borrow_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready_for_delivery', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_id, requester_id)
);

CREATE INDEX IF NOT EXISTS books_owner_id_idx ON public.books(owner_id);
CREATE INDEX IF NOT EXISTS books_created_at_idx ON public.books(created_at DESC);
CREATE INDEX IF NOT EXISTS borrow_requests_requester_id_idx ON public.borrow_requests(requester_id);
CREATE INDEX IF NOT EXISTS borrow_requests_owner_id_idx ON public.borrow_requests(owner_id);
CREATE INDEX IF NOT EXISTS borrow_requests_book_id_idx ON public.borrow_requests(book_id);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrow_requests ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.books TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.borrow_requests TO authenticated;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can create own profile" ON public.profiles;
CREATE POLICY "Users can create own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Signed-in users can view books" ON public.books;
CREATE POLICY "Signed-in users can view books" ON public.books FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can create own books" ON public.books;
CREATE POLICY "Users can create own books" ON public.books FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Users can update own books" ON public.books;
CREATE POLICY "Users can update own books" ON public.books FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Users can delete own books" ON public.books;
CREATE POLICY "Users can delete own books" ON public.books FOR DELETE TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can view relevant requests" ON public.borrow_requests;
CREATE POLICY "Users can view relevant requests" ON public.borrow_requests FOR SELECT TO authenticated USING (auth.uid() = requester_id OR auth.uid() = owner_id);
DROP POLICY IF EXISTS "Users can create own requests" ON public.borrow_requests;
CREATE POLICY "Users can create own requests" ON public.borrow_requests FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = requester_id
  AND requester_id <> owner_id
  AND EXISTS (SELECT 1 FROM public.books WHERE books.id = book_id AND books.owner_id = owner_id)
);
DROP POLICY IF EXISTS "Borrowers can delete own requests" ON public.borrow_requests;
CREATE POLICY "Borrowers can delete own requests" ON public.borrow_requests FOR DELETE TO authenticated USING (auth.uid() = requester_id);
DROP POLICY IF EXISTS "Owners can update request status" ON public.borrow_requests;
CREATE POLICY "Owners can update request status" ON public.borrow_requests FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
