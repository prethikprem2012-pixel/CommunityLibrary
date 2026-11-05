import { Component, computed, input } from '@angular/core';
import { Book } from '../models';
import { bookCategory, categoryConfig } from '../categories';

@Component({
  selector: 'app-book-card',
  templateUrl: './book-card.html',
})
export class BookCard {
  readonly book = input.required<Book>();

  protected readonly config = computed(() => categoryConfig(bookCategory(this.book().genre)));
}
