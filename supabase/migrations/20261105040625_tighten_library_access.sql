/*
# Tighten Community Library access controls

1. Purpose
- Remove accidental anonymous table privileges left by the database defaults.
- Correct the borrow-request ownership check so the selected book must belong to the recorded owner.
- Restrict writes to user-editable columns and prevent clients from changing ownership, requester identity, timestamps, or request status through broad table grants.

2. Security changes
- Anonymous users receive no access to profiles, books, or borrow requests.
- Authenticated users can insert books without supplying an owner; the database fills `owner_id` from the signed-in session.
- Authenticated users can update only editable book and profile fields.
- Authenticated users can create requests with a book and owner, while the database fills the requester from the signed-in session.
- Only book owners can update the request `status` column.

3. Data safety
- No rows, tables, or columns are deleted.
- Existing RLS policies remain in place except for the corrected request insert policy.
*/

REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.books FROM anon;
REVOKE ALL ON public.borrow_requests FROM anon;

REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT INSERT (id, email, display_name) ON public.profiles TO authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;

REVOKE INSERT, UPDATE ON public.books FROM authenticated;
GRANT INSERT (title, author, genre, description, cover_url) ON public.books TO authenticated;
GRANT UPDATE (title, author, genre, description, cover_url) ON public.books TO authenticated;

REVOKE INSERT, UPDATE ON public.borrow_requests FROM authenticated;
GRANT INSERT (book_id, owner_id) ON public.borrow_requests TO authenticated;
GRANT UPDATE (status) ON public.borrow_requests TO authenticated;

DROP POLICY IF EXISTS "Users can create own requests" ON public.borrow_requests;
CREATE POLICY "Users can create own requests" ON public.borrow_requests
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = requester_id
  AND requester_id <> owner_id
  AND EXISTS (
    SELECT 1
    FROM public.books AS owned_book
    WHERE owned_book.id = public.borrow_requests.book_id
      AND owned_book.owner_id = public.borrow_requests.owner_id
  )
);
