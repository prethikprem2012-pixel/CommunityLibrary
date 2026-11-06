import { effect, Injectable, computed, signal } from '@angular/core';
import { STORAGE_KEYS, readStorage, readUserStorage, writeStorage, writeUserStorage } from './storage';
import { Book, BorrowRequest, BorrowRequestStatus, Genre } from './models';
import { SessionService } from './session.service';
import { SEED_BOOKS } from './seed-books';

export type NewBookInput = Pick<Book, 'title' | 'author' | 'genre' | 'description' | 'coverUrl'>;

@Injectable({ providedIn: 'root' })
export class LibraryService {
  readonly books = signal<Book[]>(this.loadBooks());
  readonly requests = signal<BorrowRequest[]>(this.loadRequests());
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor(private readonly session: SessionService) {
    effect(() => {
      if (this.session.activeEmail()) {
        this.books.set(this.loadBooks());
      }
    });
  }

  private loadBooks(): Book[] {
    const storedBooks = readStorage<Book[] | null>(STORAGE_KEYS.masterBooks, null);
    if (storedBooks !== null) return storedBooks;

    const legacyBooks = readStorage<Book[] | null>(STORAGE_KEYS.legacyBooks, null);
    const books = legacyBooks
      ? [...SEED_BOOKS, ...legacyBooks.filter((book) => !SEED_BOOKS.some((seed) => seed.id === book.id))]
      : SEED_BOOKS;
    writeStorage(STORAGE_KEYS.masterBooks, books);
    return books;
  }

  private loadRequests(): BorrowRequest[] {
    return readStorage<BorrowRequest[]>(STORAGE_KEYS.requests, []);
  }

  addBook(input: NewBookInput, ownerEmail: string): void {
    const book: Book = {
      id: crypto.randomUUID(),
      title: input.title,
      author: input.author,
      genre: input.genre,
      description: input.description,
      coverUrl: input.coverUrl,
      ownerEmail,
      createdAt: new Date().toISOString(),
    };
    this.books.update((books) => [book, ...books]);
    writeStorage(STORAGE_KEYS.masterBooks, this.books());

    const userBooks = readUserStorage<Book[]>(ownerEmail, STORAGE_KEYS.userBooks, []);
    writeUserStorage(ownerEmail, STORAGE_KEYS.userBooks, [book, ...userBooks]);
  }

  requestBook(book: Book, requesterEmail: string): void {
    const request: BorrowRequest = {
      id: crypto.randomUUID(),
      bookId: book.id,
      bookTitle: book.title,
      requesterEmail,
      ownerEmail: book.ownerEmail,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.requests.update((requests) => [request, ...requests]);
    writeStorage(STORAGE_KEYS.requests, this.requests());
  }

  acceptRequest(requestId: string, pickupAt: string, approvedByUserId: string): void {
    this.requests.update((requests) =>
      requests.map((request) =>
        request.id === requestId
          ? {
              ...request,
              status: 'ready_for_delivery' as BorrowRequestStatus,
              pickupAt,
              approvedByUserId,
            }
          : request,
      ),
    );
    writeStorage(STORAGE_KEYS.requests, this.requests());
  }
}
