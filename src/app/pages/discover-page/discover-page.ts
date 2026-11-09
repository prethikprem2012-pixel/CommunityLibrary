import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BookCard } from '../../book-card/book-card';
import { Book } from '../../models';
import { BookRecommendation, mockTextToRecommendations } from '../../mock-llm';
import { LibraryService } from '../../library.service';
import { SessionService } from '../../session.service';
import { CreditsService } from '../../credits.service';
import { BORROW_COST_AMOUNT } from '../../credit.models';
import { CATEGORIES, CategoryFilter, EVERYTHING_FILTER, FILTER_PILLS } from '../../categories';

@Component({
  selector: 'app-discover-page',
  imports: [BookCard, RouterLink],
  templateUrl: './discover-page.html',
})
export class DiscoverPage {
  protected readonly CATEGORIES = CATEGORIES;
  protected readonly borrowCost = BORROW_COST_AMOUNT;
  private readonly library = inject(LibraryService);
  private readonly session = inject(SessionService);
  private readonly credits = inject(CreditsService);
  protected readonly libraryError = this.library.errorMessage;
  protected readonly libraryLoading = this.library.loading;

  protected readonly filterPills = FILTER_PILLS;
  protected readonly activeFilter = signal<CategoryFilter>(EVERYTHING_FILTER);
  protected readonly query = signal('');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly recommendations = signal<BookRecommendation[] | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly requestingBookIds = signal<Set<string>>(new Set());

  protected readonly availableBooks = computed(() =>
    this.library.availableBooks(),
  );

  protected readonly filteredBooks = computed(() => {
    const filter = this.activeFilter();
    if (filter === EVERYTHING_FILTER) return this.availableBooks();
    const genres = CATEGORIES[filter].genres;
    return this.availableBooks().filter((book) => genres.includes(book.genre));
  });

  protected readonly myRequestStatusByBook = computed(() => {
    const statuses = new Map<string, string>();
    for (const request of this.library.requests()) {
      if (request.requesterEmail !== this.session.activeEmail()) continue;

      if (request.status === 'pending') statuses.set(request.bookId, 'Request sent');
      if (request.status === 'ready_for_delivery') {
        statuses.set(request.bookId, 'Accepted - ready for pickup');
      }
      if (request.status === 'borrowed') {
        statuses.set(
          request.bookId,
          request.returnStatus === 'pending_confirmation' ? 'Return requested' : 'Borrowed',
        );
      }
    }
    return statuses;
  });

  protected requestStatusLabel(bookId: string): string | null {
    return this.myRequestStatusByBook().get(bookId) ?? null;
  }

  protected unavailableLabel(book: Book): string | null {
    if (book.availabilityStatus === 'borrowed') {
      return book.availabilityBorrowerName
        ? `Borrowed by ${book.availabilityBorrowerName}`
        : 'Currently borrowed';
    }
    if (book.availabilityStatus === 'reserved') return 'Reserved for pickup';
    return null;
  }

  protected readonly canAfford = computed(() => this.credits.balance() >= this.borrowCost);

  protected pillClass(filter: CategoryFilter): string {
    const base = 'rounded-full border px-5 py-2 text-sm font-bold transition';
    if (filter === EVERYTHING_FILTER) {
      return this.activeFilter() === filter
        ? `${base} bg-stone-900 text-white border-stone-900`
        : `${base} bg-white text-stone-600 border-stone-200 hover:border-stone-400`;
    }
    const config = CATEGORIES[filter];
    return this.activeFilter() === filter
      ? `${base} ${config.pillActiveClass}`
      : `${base} ${config.pillInactiveClass}`;
  }

  protected onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected selectFilter(filter: CategoryFilter): void {
    this.activeFilter.set(filter);
    this.recommendations.set(null);
    this.errorMessage.set(null);
  }

  protected reloadLibrary(): void {
    void this.library.refresh();
  }

  protected async search(): Promise<void> {
    const mood = this.query().trim();
    if (!mood || this.loading()) return;

    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      const results = await mockTextToRecommendations(mood, this.availableBooks());
      this.recommendations.set(results);
    } catch {
      this.errorMessage.set('We could not find recommendations right now. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async requestToBorrow(book: Book): Promise<void> {
    const email = this.session.activeEmail();
    if (!email) return;

    if (this.requestingBookIds().has(book.id)) return;
    if (
      book.availabilityStatus !== 'available' ||
      this.requestStatusLabel(book.id) !== null
    ) {
      return;
    }
    if (!this.canAfford()) {
      this.notice.set(`You need at least ${this.borrowCost} credits to request a book. Visit your Wallet to learn more.`);
      return;
    }

    this.notice.set(null);
    this.errorMessage.set(null);
    this.requestingBookIds.update((ids) => new Set(ids).add(book.id));
    try {
      await this.library.requestBook(book);
      this.credits.chargeForBorrow(`Borrowed "${book.title}"`);
      this.notice.set(`Request sent! ${this.borrowCost} credits were deducted from your wallet.`);
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'The request could not be sent. Please try again.',
      );
    } finally {
      this.requestingBookIds.update((ids) => {
        const next = new Set(ids);
        next.delete(book.id);
        return next;
      });
    }
  }
}
