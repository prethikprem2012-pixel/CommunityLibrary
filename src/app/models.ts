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
  title: string;
  author: string;
  genre: Genre;
  description: string;
  coverUrl: string;
  ownerEmail: string;
  createdAt: string;
}

export type BorrowRequestStatus = 'pending' | 'ready_for_delivery' | 'declined';

export interface BorrowRequest {
  id: string;
  bookId: string;
  bookTitle: string;
  requesterEmail: string;
  ownerEmail: string;
  status: BorrowRequestStatus;
  createdAt: string;
  pickupAt?: string;
  approvedByUserId?: string;
}
