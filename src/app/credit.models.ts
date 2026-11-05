export interface LedgerEntry {
  id: string;
  amount: number;
  description: string;
  createdAt: string;
  type: 'grant' | 'lend' | 'borrow';
}

export const LEDGER_VERSION = 1;

export const WELCOME_GRANT_AMOUNT = 100;
export const LEND_REWARD_AMOUNT = 50;
export const BORROW_COST_AMOUNT = 30;

export const TOTAL_MONEY_SAVED = 1849;
export const PAPER_CONSERVED_KG = 4.2;
export const PEER_TRUST_SCORE = 100;
export const CO2_SAVED_KG = 12.8;
export const TREES_SAVED = 3;
export const WATER_CONSERVED_L = 540;

export interface SeedLedgerEntry {
  amount: number;
  description: string;
  type: LedgerEntry['type'];
}

export const SEED_LEDGER: SeedLedgerEntry[] = [
  { amount: 100, description: 'Welcome grant for joining the community', type: 'grant' },
  { amount: 50, description: 'Lent "The Hobbit" to a nearby reader', type: 'lend' },
  { amount: -30, description: 'Borrowed "The Guest List" from the shelf', type: 'borrow' },
  { amount: 50, description: 'Lent "The Midnight Library" to a nearby reader', type: 'lend' },
  { amount: -30, description: 'Borrowed "The Secret Garden" from the shelf', type: 'borrow' },
];
