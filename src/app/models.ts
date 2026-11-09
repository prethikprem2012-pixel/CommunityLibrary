export const GENRES = [
  'Mystery',
  'Thriller',
  'Fantasy',
  'Romance',
  'Sci-Fi',
  'Non-fiction',
  'Biography',
  'Classic',
  'Self-help',
  'Young Adult',
  'Poetry',
] as const;

export type Genre = (typeof GENRES)[number];

export interface Book {
  id: string;
  ownerId: string;
  title: string;
  author: string;
  genre: Genre;
  description: string;
  coverUrl: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: string;
  availabilityStatus: 'available' | 'reserved' | 'borrowed';
  availabilityBorrowerName: string | null;
}

export type BorrowRequestStatus =
  | 'pending'
  | 'ready_for_delivery'
  | 'borrowed'
  | 'returned'
  | 'declined'
  | 'cancelled';

export interface BorrowRequest {
  id: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookCoverUrl: string;
  requesterEmail: string;
  ownerEmail: string;
  status: BorrowRequestStatus;
  createdAt: string;
  pickupAt: string | null;
  returnStatus: 'pending_confirmation' | 'confirmed' | null;
  returnRequestedAt: string | null;
}
