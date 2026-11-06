export const STORAGE_KEYS = {
  activeUser: 'cvl.activeUser',
  masterBooks: 'cvl.masterBookCatalogue',
  legacyBooks: 'cvl.books',
  userBooks: 'books',
  requests: 'cvl.borrowRequests',
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

function userStoragePrefix(userId: string): string {
  const encodedUserId = encodeURIComponent(userId.trim().toLowerCase()).replace(/\./g, '%2E');
  return `cvl.user.${encodedUserId}.`;
}

export function readUserStorage<T>(userId: string, key: string, fallback: T): T {
  return readStorage(`${userStoragePrefix(userId)}${key}`, fallback);
}

export function writeUserStorage<T>(userId: string, key: string, value: T): void {
  writeStorage(`${userStoragePrefix(userId)}${key}`, value);
}

export function clearUserStorage(userId: string): void {
  const prefix = userStoragePrefix(userId);
  const keysToRemove: string[] = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) keysToRemove.push(key);
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
}
