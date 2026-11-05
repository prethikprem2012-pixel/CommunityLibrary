import { Injectable, computed, signal } from '@angular/core';
import { STORAGE_KEYS, readStorage, writeStorage } from './storage';
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

@Injectable({ providedIn: 'root' })
export class CreditsService {
  private readonly state = this.loadState();

  readonly balance = signal<number>(this.state.balance);
  readonly ledger = signal<LedgerEntry[]>(this.state.ledger);

  readonly totalEarned = computed(() =>
    this.ledger().filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0),
  );

  readonly totalSpent = computed(() =>
    this.ledger()
      .filter((entry) => entry.amount < 0)
      .reduce((sum, entry) => sum + Math.abs(entry.amount), 0),
  );

  chargeForBorrow(description: string): LedgerEntry | null {
    if (this.balance() < BORROW_COST_AMOUNT) return null;
    return this.record(-BORROW_COST_AMOUNT, description, 'borrow');
  }

  rewardForLend(description: string): LedgerEntry {
    return this.record(LEND_REWARD_AMOUNT, description, 'lend');
  }

  private loadState(): CreditsState {
    const storedVersion = readStorage<number>(STORAGE_KEYS.ledgerVersion, 0);
    if (storedVersion < LEDGER_VERSION) {
      const seeded = this.buildSeedState();
      writeStorage(STORAGE_KEYS.ledger, seeded.ledger);
      writeStorage(STORAGE_KEYS.credits, seeded.balance);
      writeStorage(STORAGE_KEYS.ledgerVersion, LEDGER_VERSION);
      return seeded;
    }

    const storedLedger = readStorage<LedgerEntry[] | null>(STORAGE_KEYS.ledger, null);
    const storedBalance = readStorage<number | null>(STORAGE_KEYS.credits, null);
    if (storedLedger && storedLedger.length > 0) {
      const balance = storedBalance ?? storedLedger.reduce((sum, entry) => sum + entry.amount, 0);
      return { balance, ledger: storedLedger };
    }

    const seeded = this.buildSeedState();
    writeStorage(STORAGE_KEYS.ledger, seeded.ledger);
    writeStorage(STORAGE_KEYS.credits, seeded.balance);
    writeStorage(STORAGE_KEYS.ledgerVersion, LEDGER_VERSION);
    return seeded;
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
    const entry: LedgerEntry = {
      id: crypto.randomUUID(),
      amount,
      description,
      createdAt: new Date().toISOString(),
      type,
    };
    this.ledger.update((ledger) => [entry, ...ledger]);
    this.balance.update((balance) => balance + amount);
    writeStorage(STORAGE_KEYS.ledger, this.ledger());
    writeStorage(STORAGE_KEYS.credits, this.balance());
    return entry;
  }
}
