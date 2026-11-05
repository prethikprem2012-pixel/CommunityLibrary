import { Book, Genre } from './models';

export interface VisionAutofillResult {
  title: string;
  author: string;
  description: string;
  genre: Genre;
}

export interface BookRecommendation {
  book: Book;
  reason: string;
}

const MOCK_LATENCY_MS = 1200;

const MOOD_RULES: { keywords: string[]; genres: Genre[] }[] = [
  { keywords: ['thrill', 'mystery', 'suspense', 'detective', 'crime', 'puzzle', 'dark', 'clue'], genres: ['Mystery', 'Thriller'] },
  { keywords: ['magic', 'dragon', 'epic', 'quest', 'adventure', 'kingdom', 'wizard'], genres: ['Fantasy'] },
  { keywords: ['love', 'romance', 'heart', 'cozy', 'sweet', 'warm'], genres: ['Romance'] },
  { keywords: ['space', 'future', 'robot', 'alien', 'science', 'tech', 'galaxy'], genres: ['Sci-Fi'] },
  { keywords: ['learn', 'study', 'history', 'facts', 'real', 'true', 'biography', 'career'], genres: ['Non-fiction', 'Biography', 'Self-help'] },
  { keywords: ['classic', 'timeless', 'literature', 'vintage'], genres: ['Classic'] },
  { keywords: ['teen', 'school', 'growing', 'friendship'], genres: ['Young Adult'] },
  { keywords: ['poem', 'poetry', 'verse', 'feeling', 'emotion'], genres: ['Poetry'] },
];

const REASON_TEMPLATES = [
  'A great match for a {genre} mood.',
  'Readers who enjoy {genre} tend to love this one.',
  'Plenty of {genre} energy on every page.',
  'Your request points right at this {genre} pick.',
];

const FALLBACK_REASON = 'Nothing matched perfectly, but this one is worth a look.';

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mockImageToText(coverDataUrl: string): Promise<VisionAutofillResult> {
  const response = await fetch('/api/groq/autofill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coverDataUrl }),
  });

  let payload: VisionAutofillResult | { error?: string };
  try {
    payload = (await response.json()) as VisionAutofillResult | { error?: string };
  } catch {
    throw new Error(
      `The Groq API returned a non-JSON response (HTTP ${response.status}). Verify the Vercel function is deployed and check its logs.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      'error' in payload && payload.error
        ? payload.error
        : `Groq request failed with HTTP ${response.status}.`,
    );
  }

  if (!('title' in payload) || !('author' in payload) || !('description' in payload) || !('genre' in payload)) {
    throw new Error('The Groq API returned incomplete book details.');
  }

  return payload;
}

/**
 * MOCK: Text-to-recommendation LLM.
 * Future integration: send the mood query and a compact catalog summary to your LLM and
 * ask it to return ranked book ids with reasons. Keep the return shape so the UI does not change.
 */
export async function mockTextToRecommendations(
  query: string,
  availableBooks: Book[],
): Promise<BookRecommendation[]> {
  await delay(MOCK_LATENCY_MS);

  const normalized = query.toLowerCase();
  const targetGenres = new Set<Genre>();
  for (const rule of MOOD_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      rule.genres.forEach((genre) => targetGenres.add(genre));
    }
  }

  const queryWords = normalized.split(/\W+/).filter((word) => word.length > 3);

  const scored = availableBooks
    .map((book) => {
      const haystack = `${book.title} ${book.description}`.toLowerCase();
      const wordHits = queryWords.filter((word) => haystack.includes(word)).length;
      const genreHit = targetGenres.has(book.genre) ? 2 : 0;
      return { book, score: genreHit + wordHits };
    })
    .filter((entry) => entry.score > 0);

  if (scored.length === 0) {
    return shuffle(availableBooks)
      .slice(0, 3)
      .map((book) => ({ book, reason: FALLBACK_REASON }));
  }

  return shuffle(scored)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ book }) => ({
      book,
      reason: pickRandom(REASON_TEMPLATES).replace('{genre}', book.genre),
    }));
}
