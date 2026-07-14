// Direct-from-browser Anthropic API client (spec §2). Personal single-user
// app: the key lives in localStorage and never leaves the device except to
// api.anthropic.com. Never log the key or request headers.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

interface ApiTextBlock {
  type: string;
  text?: string;
}

interface ApiResponse {
  content?: ApiTextBlock[];
  stop_reason?: string;
  error?: { type?: string; message?: string };
}

function headers(apiKey: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

export class ClaudeApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'ClaudeApiError';
  }
}

async function post(apiKey: string, body: object): Promise<ApiResponse> {
  let res: Response;
  try {
    res = await fetch(API_URL, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) });
  } catch {
    throw new ClaudeApiError("Couldn't reach the Claude API — check your internet connection.");
  }
  const data = (await res.json().catch(() => ({}))) as ApiResponse;
  if (!res.ok) {
    const detail = data.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new ClaudeApiError('The API key was rejected. Check it in Settings.', 401);
    }
    if (res.status === 429) {
      throw new ClaudeApiError('Rate limited by the API — wait a minute and try again.', 429);
    }
    throw new ClaudeApiError(`Claude API error: ${detail}`, res.status);
  }
  return data;
}

function firstText(data: ApiResponse): string {
  const block = data.content?.find((b) => b.type === 'text' && typeof b.text === 'string');
  if (!block?.text) throw new ClaudeApiError('The API reply contained no text.');
  return block.text;
}

/** One generation call. max_tokens must stay ≥ 4000 (the JSON reply is large). */
export async function callClaudeForPlan(prompt: string, apiKey: string): Promise<string> {
  const data = await post(apiKey, {
    model: MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });
  return firstText(data);
}

/** Cheap connectivity/key check for Settings. */
export async function testConnection(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const data = await post(apiKey, {
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    });
    firstText(data);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
