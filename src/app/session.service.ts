import { Injectable, computed, signal } from '@angular/core';
import { STORAGE_KEYS } from './storage';

interface AuthUser {
  id: string;
  email: string;
}

interface AuthResponse {
  user: AuthUser;
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (typeof value !== 'object' || value === null || !('user' in value)) return false;
  const user = value.user;
  return (
    typeof user === 'object' &&
    user !== null &&
    'id' in user &&
    typeof user.id === 'string' &&
    'email' in user &&
    typeof user.email === 'string'
  );
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly activeEmail = signal<string | null>(null);
  readonly isLoggedIn = computed(() => this.activeEmail() !== null);
  readonly ready = signal(false);
  readonly authError = signal<string | null>(null);

  private readonly initialization: Promise<void>;

  constructor() {
    localStorage.removeItem(STORAGE_KEYS.activeUser);
    this.initialization = this.restoreSession();
  }

  async waitUntilReady(): Promise<void> {
    await this.initialization;
  }

  async login(email: string, password: string): Promise<string | null> {
    return this.authenticate('/api/auth/login', email, password);
  }

  async signUp(email: string, password: string): Promise<string | null> {
    return this.authenticate('/api/auth/register', email, password);
  }

  async logout(): Promise<void> {
    this.authError.set(null);
    try {
      const response = await this.request('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error(await this.responseError(response));
      this.activeEmail.set(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Logout failed. Please try again.';
      this.authError.set(message);
      throw error;
    }
  }

  private async restoreSession(): Promise<void> {
    try {
      const response = await this.request('/api/auth/me');
      if (response.status === 401) return;
      if (!response.ok) throw new Error(await this.responseError(response));

      const payload: unknown = await response.json();
      if (!isAuthResponse(payload)) throw new Error('The authentication service returned an invalid response.');
      this.activeEmail.set(payload.user.email);
    } catch (error) {
      this.authError.set(
        error instanceof Error ? error.message : 'Could not restore your sign-in session.',
      );
    } finally {
      this.ready.set(true);
    }
  }

  private async authenticate(path: string, email: string, password: string): Promise<string | null> {
    this.authError.set(null);
    try {
      const response = await this.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) return await this.responseError(response);

      const payload: unknown = await response.json();
      if (!isAuthResponse(payload)) throw new Error('The authentication service returned an invalid response.');
      this.activeEmail.set(payload.user.email);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Authentication failed. Please try again.';
    }
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(path, { ...init, credentials: 'include' });
    } catch {
      throw new Error('Could not connect to the authentication service. Please try again.');
    }
  }

  private async responseError(response: Response): Promise<string> {
    try {
      const payload: unknown = await response.json();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'detail' in payload &&
        typeof payload.detail === 'string'
      ) {
        return payload.detail;
      }
    } catch {
      return `The authentication service returned an invalid response (HTTP ${response.status}).`;
    }
    return `Authentication failed (HTTP ${response.status}).`;
  }
}
