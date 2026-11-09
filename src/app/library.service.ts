import { effect, Injectable, signal } from '@angular/core';
import { Book, BorrowRequest, BorrowRequestStatus, GENRES } from './models';
import { SessionService } from './session.service';

export type NewBookInput = Pick<Book, 'title' | 'author' | 'genre' | 'description' | 'coverUrl'>;
export type BorrowRequestAction = 'accept' | 'decline' | 'cancel' | 'confirm_handoff';

const BORROW_REQUEST_STATUSES: BorrowRequestStatus[] = [
  'pending',
  'ready_for_delivery',
  'borrowed',
  'returned',
  'declined',
  'cancelled',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBook(value: unknown): value is Book {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['ownerId'] === 'string' &&
    typeof value['ownerEmail'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['author'] === 'string' &&
    typeof value['genre'] === 'string' &&
    GENRES.some((genre) => genre === value['genre']) &&
    typeof value['description'] === 'string' &&
    typeof value['coverUrl'] === 'string' &&
    typeof value['ownerName'] === 'string' &&
    typeof value['createdAt'] === 'string' &&
    (value['availabilityStatus'] === 'available' ||
      value['availabilityStatus'] === 'reserved' ||
      value['availabilityStatus'] === 'borrowed') &&
    (typeof value['availabilityBorrowerName'] === 'string' ||
      value['availabilityBorrowerName'] === null)
  );
}

function isBorrowRequest(value: unknown): value is BorrowRequest {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['bookId'] === 'string' &&
    typeof value['bookTitle'] === 'string' &&
    typeof value['bookAuthor'] === 'string' &&
    typeof value['bookCoverUrl'] === 'string' &&
    typeof value['requesterEmail'] === 'string' &&
    typeof value['ownerEmail'] === 'string' &&
    typeof value['status'] === 'string' &&
    BORROW_REQUEST_STATUSES.some((status) => status === value['status']) &&
    typeof value['createdAt'] === 'string' &&
    (typeof value['pickupAt'] === 'string' || value['pickupAt'] === null) &&
    (value['returnStatus'] === 'pending_confirmation' ||
      value['returnStatus'] === 'confirmed' ||
      value['returnStatus'] === null) &&
    (typeof value['returnRequestedAt'] === 'string' ||
      value['returnRequestedAt'] === null)
  );
}

@Injectable({ providedIn: 'root' })
export class LibraryService {
  readonly books = signal<Book[]>([]);
  readonly availableBooks = signal<Book[]>([]);
  readonly requests = signal<BorrowRequest[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  private refreshSequence = 0;

  constructor(private readonly session: SessionService) {
    effect(() => {
      if (this.session.activeEmail()) {
        void this.refresh();
      } else {
        this.refreshSequence += 1;
        this.loading.set(false);
        this.books.set([]);
        this.availableBooks.set([]);
        this.requests.set([]);
        this.errorMessage.set(null);
      }
    });
  }

  async refresh(): Promise<void> {
    const sequence = ++this.refreshSequence;
    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const [books, availableBooks, requests] = await Promise.all([
        this.apiRequest('/api/books?scope=all'),
        this.apiRequest('/api/books?scope=available'),
        this.apiRequest('/api/requests?scope=all'),
      ]);
      if (sequence !== this.refreshSequence || !this.session.activeEmail()) return;
      if (!Array.isArray(books) || !books.every(isBook)) {
        throw new Error('The library service returned invalid book data.');
      }
      if (!Array.isArray(availableBooks) || !availableBooks.every(isBook)) {
        throw new Error('The library service returned invalid available-book data.');
      }
      if (!Array.isArray(requests) || !requests.every(isBorrowRequest)) {
        throw new Error('The library service returned invalid request data.');
      }
      this.books.set(books);
      this.availableBooks.set(availableBooks);
      this.requests.set(requests);
    } catch (error) {
      if (sequence !== this.refreshSequence) return;
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Could not load library data.',
      );
    } finally {
      if (sequence === this.refreshSequence) this.loading.set(false);
    }
  }

  async addBook(input: NewBookInput): Promise<Book> {
    const book = await this.apiRequest('/api/books', {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        author: input.author,
        genre: input.genre,
        description: input.description,
        coverUrl: input.coverUrl,
      }),
    });
    if (!isBook(book)) throw new Error('The library service returned invalid book data.');
    this.books.update((books) => [book, ...books.filter((item) => item.id !== book.id)]);
    await this.refresh();
    return book;
  }

  async requestBook(book: Book): Promise<BorrowRequest> {
    const borrowRequest = await this.apiRequest('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ bookId: book.id }),
    });
    if (!isBorrowRequest(borrowRequest)) {
      throw new Error('The library service returned invalid request data.');
    }
    this.upsertRequest(borrowRequest);
    await this.refresh();
    return borrowRequest;
  }

  async updateRequest(
    requestId: string,
    action: BorrowRequestAction,
    pickupAt?: string,
  ): Promise<BorrowRequest> {
    const borrowRequest = await this.apiRequest(`/api/requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, ...(pickupAt ? { pickupAt } : {}) }),
    });
    if (!isBorrowRequest(borrowRequest)) {
      throw new Error('The library service returned invalid request data.');
    }
    this.upsertRequest(borrowRequest);
    await this.refresh();
    return borrowRequest;
  }

  async requestReturn(requestId: string): Promise<void> {
    await this.apiRequest(`/api/requests/${requestId}/return`, {
      method: 'POST',
    });
    await this.refresh();
  }

  async acceptReturn(requestId: string): Promise<void> {
    await this.apiRequest(`/api/requests/${requestId}/return`, {
      method: 'PATCH',
    });
    await this.refresh();
  }

  private upsertRequest(borrowRequest: BorrowRequest): void {
    this.requests.update((requests) => [
      borrowRequest,
      ...requests.filter((item) => item.id !== borrowRequest.id),
    ]);
  }

  private async apiRequest(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(path, {
        ...init,
        credentials: 'include',
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new Error('Could not connect to the library service. Please try again.');
    }

    if (!response.ok) {
      throw new Error(await this.responseError(response));
    }
    try {
      return await response.json();
    } catch {
      throw new Error('The library service returned an invalid response.');
    }
  }

  private async responseError(response: Response): Promise<string> {
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && typeof payload['detail'] === 'string') {
        return payload['detail'];
      }
    } catch {
      return `The library service returned an invalid response (HTTP ${response.status}).`;
    }
    return `Library request failed (HTTP ${response.status}).`;
  }
}
