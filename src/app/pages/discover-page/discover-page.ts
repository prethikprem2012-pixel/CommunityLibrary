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

  protected readonly filterPills = FILTER_PILLS;
  protected readonly activeFilter = signal<CategoryFilter>(EVERYTHING_FILTER);
  protected readonly query = signal('');
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly recommendations = signal<BookRecommendation[] | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly availableBooks = computed(() =>
    this.library.books().filter((book) => book.ownerEmail !== this.session.activeEmail()),
  );

  protected readonly filteredBooks = computed(() => {
    const filter = this.activeFilter();
    if (filter === EVERYTHING_FILTER) return this.availableBooks();
    const genres = CATEGORIES[filter].genres;
    return this.availableBooks().filter((book) => genres.includes(book.genre));
  });

  protected readonly requestedBookIds = computed(
    () =>
      new Set(
        this.library
          .requests()
          .filter((request) => request.requesterEmail === this.session.activeEmail())
          .map((request) => request.bookId),
      ),
  );

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

  protected requestToBorrow(book: Book): void {
    const email = this.session.activeEmail();
    if (!email) return;

    if (!this.canAfford()) {
      this.notice.set(`You need at least ${this.borrowCost} credits to request a book. Visit your Wallet to learn more.`);
      return;
    }

    this.library.requestBook(book, email);
    this.credits.chargeForBorrow(`Borrowed "${book.title}"`);
    this.notice.set(`Request sent! ${this.borrowCost} credits were deducted from your wallet.`);
  }
}
