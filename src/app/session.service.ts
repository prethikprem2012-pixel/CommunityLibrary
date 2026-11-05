import { Injectable, computed, signal } from '@angular/core';
import { STORAGE_KEYS, readStorage, writeStorage } from './storage';
const GMAIL_PATTERN = /^[^\s@]+@gmail\.com$/i;

function isGmailAddress(email: string): boolean {
  return GMAIL_PATTERN.test(email.trim());
}

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

  login(email: string, _password: string): string | null {
    if (!isGmailAddress(email)) return 'Please use an address that ends in @gmail.com.';
    const normalized = email.trim().toLowerCase();
    writeStorage(SESSION_KEY, normalized);
    this.activeEmail.set(normalized);
    return null;
  }

  async signUp(email: string, password: string): Promise<string | null> {
    return this.login(email, password);
  }

  async logout(): Promise<void> {
    localStorage.removeItem(SESSION_KEY);
    this.activeEmail.set(null);
  }

  private restoreSession(): string | null {
    return readStorage<string | null>(SESSION_KEY, null);
  }
}
