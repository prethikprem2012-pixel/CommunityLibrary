import { Injectable, computed, signal } from '@angular/core';
import { STORAGE_KEYS, clearUserStorage, readStorage, writeStorage } from './storage';

const SESSION_KEY = STORAGE_KEYS.activeUser;

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly activeEmail = signal<string | null>(this.restoreSession());
  readonly isLoggedIn = computed(() => this.activeEmail() !== null);
  readonly ready = signal(true);

  constructor() {}

  async waitUntilReady(): Promise<void> {
    return;
  }

  login(userId: string, _password: string): string | null {
    const normalized = userId.trim().toLowerCase();
    if (!normalized) return 'Please enter a user ID.';
    writeStorage(SESSION_KEY, normalized);
    this.activeEmail.set(normalized);
    return null;
  }

  async signUp(email: string, password: string): Promise<string | null> {
    return this.login(email, password);
  }

  async logout(): Promise<void> {
    const userId = this.activeEmail();
    if (userId) clearUserStorage(userId);
    localStorage.removeItem(SESSION_KEY);
    this.activeEmail.set(null);
  }

  private restoreSession(): string | null {
    return readStorage<string | null>(SESSION_KEY, null);
  }
}
