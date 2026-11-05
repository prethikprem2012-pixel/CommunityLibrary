import OpenAI from 'openai';

const model = process.env.GROQ_MODEL ?? 'qwen/qwen3.8-27b';
const maxDataUrlLength = 4 * 1024 * 1024;
const genres = [
  'Mystery',
  'Thriller',
  'Fantasy',
  'Romance',
  'Sci-Fi',
  'Non-fiction',
  'Biography',
  'Classic',
  'Self-help',
  'Young Adult',
  'Poetry',
];

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function parseModelResponse(content) {
  if (!content) {
    throw new Error('The model returned an empty response.');
  }

  const text = content.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;
  const result = JSON.parse(json);

  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('The model response was not a JSON object.');
  }

  return result;
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return sendJson(response, 503, {
      error: 'Groq is not configured. Add GROQ_API_KEY to the Vercel project environment variables.',
    });
  }

  const coverDataUrl = request.body?.coverDataUrl;
  if (
    typeof coverDataUrl !== 'string' ||
    coverDataUrl.length > maxDataUrlLength ||
    !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(coverDataUrl)
  ) {
    return sendJson(response, 400, {
      error: 'Please upload a valid JPG, PNG, or WebP cover image under 4 MB.',
    });
  }

  try {
    const groq = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Read this book cover. Return only a JSON object with exactly these string fields: title, author, description, genre. Extract the title and author exactly as shown. Description must be at most two short lines and 220 characters. Genre must be one of: Mystery, Thriller, Fantasy, Romance, Sci-Fi, Non-fiction, Biography, Classic, Self-help, Young Adult, Poetry. If the author is not visible, return "Unknown Author".',
            },
            { type: 'image_url', image_url: { url: coverDataUrl, detail: 'high' } },
          ],
        },
      ],
    });

    const result = parseModelResponse(completion.choices[0]?.message?.content);
    const title = typeof result.title === 'string' ? result.title.trim() : '';
    const author = typeof result.author === 'string' ? result.author.trim() : '';
    const description = typeof result.description === 'string' ? result.description.trim() : '';
    const genre =
      typeof result.genre === 'string'
        ? genres.find((item) => item.toLowerCase() === result.genre.trim().toLowerCase())
        : undefined;

    if (!title || !author || !description || !genre) {
      throw new Error('The model response is missing valid book details.');
    }

    return sendJson(response, 200, {
      title: title.slice(0, 120),
      author: author.slice(0, 80),
      description: description.slice(0, 220),
      genre,
    });
  } catch (error) {
    console.error('Groq autofill failed:', error);
    return sendJson(response, 502, {
      error: 'Groq autofill failed. Check the Groq API key, model setting, and Vercel function logs.',
    });
  }
}
