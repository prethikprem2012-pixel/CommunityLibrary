import { effect, Injectable, computed, signal } from '@angular/core';
import { readUserStorage, writeUserStorage } from './storage';
import { SessionService } from './session.service';
import {
  BORROW_COST_AMOUNT,
  LEDGER_VERSION,
  LEND_REWARD_AMOUNT,
  LedgerEntry,
  SEED_LEDGER,
  WELCOME_GRANT_AMOUNT,
} from './credit.models';

const INITIAL_BALANCE = 200;

interface CreditsState {
  balance: number;
  ledger: LedgerEntry[];
}

const USER_CREDIT_KEYS = {
  credits: 'credits',
  ledger: 'creditLedger',
  ledgerVersion: 'creditLedgerVersion',
} as const;

@Injectable({ providedIn: 'root' })
export class CreditsService {
  readonly balance = signal(0);
  readonly ledger = signal<LedgerEntry[]>([]);

  readonly totalEarned = computed(() =>
    this.ledger().filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0),
  );

  readonly totalSpent = computed(() =>
    this.ledger()
      .filter((entry) => entry.amount < 0)
      .reduce((sum, entry) => sum + Math.abs(entry.amount), 0),
  );

  constructor(private readonly session: SessionService) {
    effect(() => this.loadState(this.session.activeEmail()));
  }

  chargeForBorrow(description: string): LedgerEntry | null {
    if (this.balance() < BORROW_COST_AMOUNT) return null;
    return this.record(-BORROW_COST_AMOUNT, description, 'borrow');
  }

  rewardForLend(description: string): LedgerEntry {
    return this.record(LEND_REWARD_AMOUNT, description, 'lend');
  }

  private loadState(userId: string | null): void {
    if (!userId) {
      this.balance.set(0);
      this.ledger.set([]);
      return;
    }

    const storedVersion = readUserStorage<number>(userId, USER_CREDIT_KEYS.ledgerVersion, 0);
    if (storedVersion < LEDGER_VERSION) {
      const seeded = this.buildSeedState();
      this.saveState(userId, seeded);
      return;
    }

    const storedLedger = readUserStorage<LedgerEntry[] | null>(userId, USER_CREDIT_KEYS.ledger, null);
    const storedBalance = readUserStorage<number | null>(userId, USER_CREDIT_KEYS.credits, null);
    if (storedLedger && storedLedger.length > 0) {
      const balance = storedBalance ?? storedLedger.reduce((sum, entry) => sum + entry.amount, 0);
      this.setState({ balance, ledger: storedLedger });
      return;
    }

    const seeded = this.buildSeedState();
    this.saveState(userId, seeded);
  }

  private buildSeedState(): CreditsState {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const ledger: LedgerEntry[] = SEED_LEDGER.map((entry, index) => ({
      ...entry,
      id: `seed-ledger-${index}`,
      createdAt: new Date(now - index * day).toISOString(),
    }));
    const balance = INITIAL_BALANCE + ledger.reduce((sum, entry) => sum + entry.amount, 0);
    return { balance, ledger };
  }

  private record(amount: number, description: string, type: LedgerEntry['type']): LedgerEntry {
    const userId = this.session.activeEmail();
    if (!userId) throw new Error('Cannot update credits without an active user.');

    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      amount,
      description,
      createdAt: new Date().toISOString(),
      type,
    };
    this.ledger.update((ledger) => [entry, ...ledger]);
    this.balance.update((balance) => balance + amount);
    writeUserStorage(userId, USER_CREDIT_KEYS.ledger, this.ledger());
    writeUserStorage(userId, USER_CREDIT_KEYS.credits, this.balance());
    return entry;
  }

  private saveState(userId: string, state: CreditsState): void {
    writeUserStorage(userId, USER_CREDIT_KEYS.ledger, state.ledger);
    writeUserStorage(userId, USER_CREDIT_KEYS.credits, state.balance);
    writeUserStorage(userId, USER_CREDIT_KEYS.ledgerVersion, LEDGER_VERSION);
    this.setState(state);
  }

  private setState(state: CreditsState): void {
    this.balance.set(state.balance);
    this.ledger.set(state.ledger);
  }
}
