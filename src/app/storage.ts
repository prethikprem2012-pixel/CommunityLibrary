export const STORAGE_KEYS = {
  activeUser: 'cvl.activeUser',
  books: 'cvl.books',
  requests: 'cvl.borrowRequests',
  seedVersion: 'cvl.seedVersion',
  credits: 'cvl.credits',
  ledger: 'cvl.creditLedger',
  ledgerVersion: 'cvl.creditLedgerVersion',
} as const;

export function readStorage<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}
