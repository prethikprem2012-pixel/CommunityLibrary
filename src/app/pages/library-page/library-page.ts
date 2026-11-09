import { Component, computed, inject, signal } from '@angular/core';
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

  protected readonly libraryError = this.library.errorMessage;
  protected readonly loading = this.library.loading;
  protected readonly myBooks = computed(() =>
    this.library.books().filter((book) => book.ownerEmail === this.session.activeEmail()),
  );
  protected readonly pendingRequests = computed(() =>
    this.library
      .requests()
      .filter(
        (request) =>
          request.ownerEmail === this.session.activeEmail() && request.status === 'pending',
      ),
  );
  protected readonly readyRequests = computed(() =>
    this.library.requests().filter(
      (request) =>
        request.status === 'ready_for_delivery' &&
        (request.ownerEmail === this.session.activeEmail() ||
          request.requesterEmail === this.session.activeEmail()),
    ),
  );
  protected readonly borrowedRequests = computed(() =>
    this.library.requests().filter(
      (request) =>
        request.status === 'borrowed' &&
        (request.ownerEmail === this.session.activeEmail() ||
          request.requesterEmail === this.session.activeEmail()),
    ),
  );
  protected readonly myRequests = computed(() =>
    this.library
      .requests()
      .filter((request) => request.requesterEmail === this.session.activeEmail()),
  );
  protected readonly pickupTimes = signal<Record<string, string>>({});
  protected readonly pickupErrors = signal<Record<string, string>>({});
  protected readonly actionErrors = signal<Record<string, string>>({});
  protected readonly workingRequestIds = signal<Set<string>>(new Set());
  protected readonly minimumPickupTime = this.toLocalDateTimeValue(
    new Date(Date.now() + 5 * 60 * 1000),
  );

  protected sessionEmail(): string | null {
    return this.session.activeEmail();
  }

  protected reloadLibrary(): void {
    void this.library.refresh();
  }

  private readonly defaultPickupTime = (() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return this.toLocalDateTimeValue(tomorrow);
  })();

  protected bookStatus(book: Book): BookStatus {
    const requests = this.library.requests().filter((request) => request.bookId === book.id);
    if (requests.some((request) => request.status === 'ready_for_delivery' || request.status === 'borrowed')) {
      return { label: 'On loan', classes: 'bg-brand-600 text-white' };
    }
    if (requests.some((request) => request.status === 'pending')) {
      return { label: 'Requested', classes: 'bg-accent-100 text-accent-700' };
    }
    return { label: 'On your shelf', classes: 'bg-stone-100 text-stone-600' };
  }

  protected pickupTime(request: BorrowRequest): string {
    return this.pickupTimes()[request.id] ?? this.defaultPickupTime;
  }

  protected updatePickupTime(request: BorrowRequest, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.pickupTimes.update((times) => ({ ...times, [request.id]: value }));
    this.pickupErrors.update((errors) => ({ ...errors, [request.id]: '' }));
  }

  protected async approve(request: BorrowRequest): Promise<void> {
    const pickupAt = new Date(this.pickupTime(request));
    if (!Number.isFinite(pickupAt.getTime()) || pickupAt.getTime() <= Date.now()) {
      this.pickupErrors.update((errors) => ({
        ...errors,
        [request.id]: 'Choose a pickup time in the future.',
      }));
      return;
    }
    await this.performAction(request.id, () =>
      this.library.updateRequest(request.id, 'accept', pickupAt.toISOString()),
    );
  }

  protected async decline(request: BorrowRequest): Promise<void> {
    await this.performAction(request.id, () =>
      this.library.updateRequest(request.id, 'decline'),
    );
  }

  protected async cancel(request: BorrowRequest): Promise<void> {
    await this.performAction(request.id, () =>
      this.library.updateRequest(request.id, 'cancel'),
    );
  }

  protected async confirmHandoff(request: BorrowRequest): Promise<void> {
    await this.performAction(request.id, () =>
      this.library.updateRequest(request.id, 'confirm_handoff'),
    );
  }

  protected async requestReturn(request: BorrowRequest): Promise<void> {
    await this.performAction(request.id, () => this.library.requestReturn(request.id));
  }

  protected async acceptReturn(request: BorrowRequest): Promise<void> {
    await this.performAction(request.id, () => this.library.acceptReturn(request.id));
  }

  private async performAction(requestId: string, action: () => Promise<unknown>): Promise<void> {
    if (this.workingRequestIds().has(requestId)) return;
    this.actionErrors.update((errors) => ({ ...errors, [requestId]: '' }));
    this.workingRequestIds.update((ids) => new Set(ids).add(requestId));
    try {
      await action();
    } catch (error) {
      this.actionErrors.update((errors) => ({
        ...errors,
        [requestId]:
          error instanceof Error ? error.message : 'The request could not be updated.',
      }));
    } finally {
      this.workingRequestIds.update((ids) => {
        const next = new Set(ids);
        next.delete(requestId);
        return next;
      });
    }
  }

  private toLocalDateTimeValue(date: Date): string {
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 16);
  }
}
