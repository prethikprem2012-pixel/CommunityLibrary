import { Genre } from './models';

export type Category = 'Mystery' | 'Fantasy' | 'Feel-good' | 'Learning';
export type CategoryFilter = Category | 'Everything';

export interface CategoryConfig {
  label: string;
  emoji: string;
  genres: Genre[];
  coverClass: string;
  pillActiveClass: string;
  pillInactiveClass: string;
  badgeClass: string;
}

export const EVERYTHING_FILTER = 'Everything' as const;

export const CATEGORIES: Record<Category, CategoryConfig> = {
  Mystery: {
    label: 'Mystery',
    emoji: '🔎',
    genres: ['Mystery', 'Thriller'],
    coverClass: 'bg-[#d97757]',
    pillActiveClass: 'bg-[#d97757] text-white border-[#d97757]',
    pillInactiveClass: 'bg-[#fce4de] text-[#a64a3a] border-[#f4cabb]',
    badgeClass: 'bg-[#fce4de] text-[#a64a3a]',
  },
  Fantasy: {
    label: 'Fantasy',
    emoji: '🪄',
    genres: ['Fantasy', 'Sci-Fi'],
    coverClass: 'bg-[#9b86c4]',
    pillActiveClass: 'bg-[#9b86c4] text-white border-[#9b86c4]',
    pillInactiveClass: 'bg-[#ede4f5] text-[#6b4d9a] border-[#dccfeb]',
    badgeClass: 'bg-[#ede4f5] text-[#6b4d9a]',
  },
  'Feel-good': {
    label: 'Feel-good',
    emoji: '🌈',
    genres: ['Romance', 'Classic', 'Young Adult', 'Poetry'],
    coverClass: 'bg-[#7c8a6a]',
    pillActiveClass: 'bg-[#7c8a6a] text-white border-[#7c8a6a]',
    pillInactiveClass: 'bg-[#e6ecdf] text-[#4f6440] border-[#d3dccc]',
    badgeClass: 'bg-[#e6ecdf] text-[#4f6440]',
  },
  Learning: {
    label: 'Learning',
    emoji: '🧠',
    genres: ['Non-fiction', 'Biography', 'Self-help'],
    coverClass: 'bg-[#b89222]',
    pillActiveClass: 'bg-[#b89222] text-white border-[#b89222]',
    pillInactiveClass: 'bg-[#f5ead0] text-[#8a6b15] border-[#ecd9a8]',
    badgeClass: 'bg-[#f5ead0] text-[#8a6b15]',
  },
};

export const FILTER_PILLS: CategoryFilter[] = ['Everything', 'Mystery', 'Fantasy', 'Feel-good', 'Learning'];

export function categoryForGenre(genre: Genre): Category {
  for (const key of Object.keys(CATEGORIES) as Category[]) {
    if (CATEGORIES[key].genres.includes(genre)) return key;
  }
  return 'Learning';
}

export function categoryConfig(category: Category): CategoryConfig {
  return CATEGORIES[category];
}

export function bookCategory(genre: Genre): Category {
  return categoryForGenre(genre);
}
