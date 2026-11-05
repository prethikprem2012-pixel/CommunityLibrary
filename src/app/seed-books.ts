import { Book } from './models';

const SEED_OWNER_A = 'alex.reader@gmail.com';
const SEED_OWNER_B = 'priya.study@gmail.com';

export const SEED_VERSION = 3;

export const SEED_BOOKS: Book[] = [
  {
    id: 'seed-1',
    title: 'The Guest List',
    author: 'Lucy Foley',
    genre: 'Mystery',
    description: 'A remote island wedding spirals into a nightmare when a guest is found dead—and everyone has a motive.',
    coverUrl: 'https://images.pexels.com/photos/40705380/pexels-photo-40705380.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ownerEmail: SEED_OWNER_A,
    createdAt: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'seed-2',
    title: 'The Hobbit',
    author: 'J. R. R. Tolkien',
    genre: 'Fantasy',
    description: 'A reluctant hobbit joins a company of dwarves on a perilous quest to reclaim a treasure guarded by a dragon.',
    coverUrl: 'https://images.pexels.com/photos/39604076/pexels-photo-39604076.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ownerEmail: SEED_OWNER_B,
    createdAt: '2026-10-05T10:00:00.000Z',
  },
  {
    id: 'seed-3',
    title: 'The Midnight Library',
    author: 'Matt Haig',
    genre: 'Classic',
    description: 'Between life and death lies a library where each book is a chance to try another version of your life.',
    coverUrl: 'https://images.pexels.com/photos/31529531/pexels-photo-31529531.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ownerEmail: SEED_OWNER_A,
    createdAt: '2026-10-07T10:00:00.000Z',
  },
  {
    id: 'seed-4',
    title: 'The Secret Garden',
    author: 'Frances Hodgson Burnett',
    genre: 'Classic',
    description: 'A lonely orphan discovers a hidden, neglected garden—and in tending it, brings new life to everyone around her.',
    coverUrl: 'https://images.pexels.com/photos/29474530/pexels-photo-29474530.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    ownerEmail: SEED_OWNER_B,
    createdAt: '2026-10-09T10:00:00.000Z',
  },
];
