import { Injectable, computed, signal } from '@angular/core';
import { STORAGE_KEYS, readStorage, writeStorage } from './storage';
import { Book, BorrowRequest, BorrowRequestStatus, Genre } from './models';
import { SessionService } from './session.service';
import { SEED_BOOKS, SEED_VERSION } from './seed-books';

export type NewBookInput = Pick<Book, 'title' | 'author' | 'genre' | 'description' | 'coverUrl'>;

@Injectable({ providedIn: 'root' })
export class LibraryService {
  readonly books = signal<Book[]>(this.loadBooks());
  readonly requests = signal<BorrowRequest[]>(this.loadRequests());
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor(private readonly session: SessionService) {}

  private loadBooks(): Book[] {
    const seedVersion = readStorage<number>(STORAGE_KEYS.seedVersion, 0);
    if (seedVersion < SEED_VERSION) {
      writeStorage(STORAGE_KEYS.books, SEED_BOOKS);
      writeStorage(STORAGE_KEYS.seedVersion, SEED_VERSION);
      return SEED_BOOKS;
    }
    return readStorage<Book[]>(STORAGE_KEYS.books, SEED_BOOKS);
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
    writeStorage(STORAGE_KEYS.books, this.books());
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

  acceptRequest(requestId: string): void {
    this.requests.update((requests) =>
      requests.map((request) =>
        request.id === requestId ? { ...request, status: 'ready_for_delivery' as BorrowRequestStatus } : request,
      ),
    );
    writeStorage(STORAGE_KEYS.requests, this.requests());
  }
}
