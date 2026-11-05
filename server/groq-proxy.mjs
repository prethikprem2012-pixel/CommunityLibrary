import { createServer } from 'node:http';
import OpenAI from 'openai';

const port = Number(process.env.GROQ_PROXY_PORT ?? 3001);
const apiKey = process.env.GROQ_API_KEY ?? process.env.VITE_GROQ_API_KEY ?? '';
const model = process.env.GROQ_MODEL ?? process.env.VITE_GROQ_MODEL ?? 'qwen/qwen3.8-27b';
const maxBodyBytes = 4 * 1024 * 1024;
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

const groq = apiKey
  ? new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' })
  : null;

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new Error('The uploaded cover is too large. Please choose a smaller image.');
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('The request body must contain valid JSON.');
  }
}

function parseModelResponse(content) {
  if (!content) {
    throw new Error('The model returned an empty response. Please try again.');
  }

  const text = content.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;

  try {
    return JSON.parse(json);
  } catch {
    throw new Error('The model response was not valid JSON. Please try again.');
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, { configured: Boolean(groq) });
  }

  if (request.method !== 'POST' || url.pathname !== '/api/groq/autofill') {
    return sendJson(response, 404, { error: 'API route not found.' });
  }

  if (!groq) {
    return sendJson(response, 503, {
      error: 'Groq API key is missing. Set GROQ_API_KEY in .env and restart the API server.',
    });
  }

  try {
    const body = await readJsonBody(request);
    if (
      typeof body.coverDataUrl !== 'string' ||
      !/^data:image\/(?:jpeg|png|webp);base64,/.test(body.coverDataUrl)
    ) {
      return sendJson(response, 400, { error: 'Please upload a valid JPG, PNG, or WebP cover image.' });
    }

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
            { type: 'image_url', image_url: { url: body.coverDataUrl, detail: 'high' } },
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
      throw new Error('The model response is missing valid book details. Please try again.');
    }

    return sendJson(response, 200, {
      title: title.slice(0, 120),
      author: author.slice(0, 80),
      description: description.slice(0, 220),
      genre,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected Groq API error.';
    console.error(`Groq autofill failed: ${message}`);
    return sendJson(response, 502, { error: `Groq autofill failed: ${message}` });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Groq API proxy listening at http://127.0.0.1:${port}`);
  console.log(`Groq API key configured: ${Boolean(groq)}`);
});
