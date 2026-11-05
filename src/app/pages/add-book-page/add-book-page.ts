import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { readCoverAsDataUrl } from '../../cover-image';
import { GENRES, Genre } from '../../models';
import { mockImageToText } from '../../mock-llm';
import { LibraryService } from '../../library.service';
import { SessionService } from '../../session.service';

@Component({
  selector: 'app-add-book-page',
  imports: [ReactiveFormsModule],
  templateUrl: './add-book-page.html',
})
export class AddBookPage {
  private readonly library = inject(LibraryService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly genres = GENRES;
  protected readonly coverDataUrl = signal<string | null>(null);
  protected readonly coverError = signal<string | null>(null);
  protected readonly autofilling = signal(false);
  protected readonly autofillMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    author: ['', [Validators.required, Validators.maxLength(80)]],
    genre: this.fb.nonNullable.control<Genre | ''>('', Validators.required),
    description: ['', [Validators.required, Validators.maxLength(600)]],
  });

  protected async onCoverSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    this.autofillMessage.set(null);
    try {
      this.coverDataUrl.set(await readCoverAsDataUrl(file));
      this.coverError.set(null);
    } catch (error) {
      this.coverDataUrl.set(null);
      this.coverError.set(error instanceof Error ? error.message : 'The cover could not be loaded.');
    }
  }

  protected async magicAutofill(): Promise<void> {
    const cover = this.coverDataUrl();
    if (!cover || this.autofilling()) return;

    this.autofilling.set(true);
    this.autofillMessage.set(null);
    try {
      const result = await mockImageToText(cover);
      this.form.patchValue({
        title: result.title,
        author: result.author,
        description: result.description,
        genre: result.genre,
      });
      this.autofillMessage.set('Title, author, description, and genre were filled in from your cover. Feel free to edit them.');
    } catch (error) {
      this.autofillMessage.set(
        error instanceof Error ? error.message : 'Magic Autofill failed. Please fill in the details by hand.',
      );
    } finally {
      this.autofilling.set(false);
    }
  }

  protected saveBook(): void {
    this.form.markAllAsTouched();

    const cover = this.coverDataUrl();
    if (!cover) {
      this.coverError.set('Please upload a cover image.');
    }
    const email = this.session.activeEmail();
    if (this.form.invalid || !cover || !email) return;

    const { title, author, genre, description } = this.form.getRawValue();
    if (!genre) return;

    this.library.addBook({ title: title.trim(), author: author.trim(), genre, description: description.trim(), coverUrl: cover }, email);
    this.router.navigateByUrl('/library');
  }
}
