import { Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BookCard } from '../../book-card/book-card';
import { Book, BorrowRequest } from '../../models';
import { LibraryService } from '../../library.service';
import { SessionService } from '../../session.service';

interface BookStatus {
  label: string;
  classes: string;
}

@Component({
  selector: 'app-library-page',
  imports: [BookCard, DatePipe, RouterLink],
  templateUrl: './library-page.html',
})
export class LibraryPage {
  private readonly library = inject(LibraryService);
  private readonly session = inject(SessionService);

  protected readonly myBooks = computed(() =>
    this.library.books().filter((book) => book.ownerEmail === this.session.activeEmail()),
  );

  protected readonly pendingRequests = computed(() =>
    this.requestsForMe().filter((request) => request.status === 'pending'),
  );

  protected readonly readyRequests = computed(() =>
    this.requestsForMe().filter((request) => request.status === 'ready_for_delivery'),
  );

  private readonly requestsForMe = computed(() =>
    this.library.requests().filter((request) => request.ownerEmail === this.session.activeEmail()),
  );

  protected bookStatus(book: Book): BookStatus {
    const requests = this.library.requests().filter((request) => request.bookId === book.id);
    if (requests.some((request) => request.status === 'ready_for_delivery')) {
      return { label: 'Ready for delivery', classes: 'bg-brand-600 text-white' };
    }
    if (requests.some((request) => request.status === 'pending')) {
      return { label: 'Requested', classes: 'bg-accent-100 text-accent-700' };
    }
    return { label: 'On your shelf', classes: 'bg-stone-100 text-stone-600' };
  }

  protected accept(request: BorrowRequest): void {
    this.library.acceptRequest(request.id);
  }
}
