/**
 * vertex-proxy — OpenAI-compatible HTTP server
 *
 * Sits between OpenClaw (OpenAI format) and backend AI providers.
 * Provider selection is handled by router.ts; each provider lives in adapters/.
 *
 * Port: 4001  (set PORT env var to override)
 */

import 'dotenv/config';
import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { OpenAIRequest } from './types';
import { getAdapter } from './router';

const PORT = parseInt(process.env.PORT ?? '4001', 10);
const DEFAULT_MODEL = process.env.VERTEX_MODEL ?? 'gemini-2.5-flash';

// ---------------------------------------------------------------------------
// Request body reader
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleChatCompletions(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: string;
  try {
    body = await readBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Failed to read request body', type: 'invalid_request_error' } }));
    return;
  }

  let payload: OpenAIRequest;
  try {
    payload = JSON.parse(body) as OpenAIRequest;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON', type: 'invalid_request_error' } }));
    return;
  }

  const model = payload.model ?? DEFAULT_MODEL;
  const adapter = getAdapter(model);

  try {
    await adapter.handleCompletion(payload, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[vertex-proxy] adapter error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: { message, type: 'api_error' } }));
    }
  }
}

/**
 * Native Gemini API pass-through.
 * @ai-sdk/google hits /v1/models/:model:generateContent in Google AI format.
 * web_search is now handled by Exa (real function call) so no tool transformation needed.
 */
async function handleNativeGemini(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Lazy import to avoid pulling in vertexai at top level for this edge case
  const { VertexAI } = await import('@google-cloud/vertexai');
  const PROJECT = process.env.VERTEX_PROJECT ?? '';
  const LOCATION = process.env.VERTEX_LOCATION ?? 'us-central1';
  const vertexAI = new VertexAI({ project: PROJECT, location: LOCATION });

  const body = await readBody(req);
  const modelMatch = req.url?.match(/models\/([^/:?]+)/);
  const nativeModelName = modelMatch?.[1] ?? DEFAULT_MODEL;

  console.log(`[vertex-proxy] native Gemini via Vertex AI: ${req.method} model=${nativeModelName}`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nativeRequest = (body ? JSON.parse(body) : {}) as any;
    console.log('[vertex-proxy] native-gemini tools:', JSON.stringify(nativeRequest.tools ?? null));
    const nativeModel = vertexAI.getGenerativeModel({ model: nativeModelName });
    const result = await nativeModel.generateContent(nativeRequest);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.response));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[vertex-proxy] native Gemini error:', message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'api_error' } }));
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', model: DEFAULT_MODEL }));
    return;
  }

  // Models list (some clients probe this)
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: [{ id: DEFAULT_MODEL, object: 'model', created: 0, owned_by: 'google' }],
    }));
    return;
  }

  // Chat completions (main path)
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    await handleChatCompletions(req, res);
    return;
  }

  // Native Gemini API pass-through
  if (
    req.url?.includes('v1beta') ||
    req.url?.includes('generateContent') ||
    req.url?.includes('/v1/v1beta')
  ) {
    await handleNativeGemini(req, res);
    return;
  }

  console.log(`[vertex-proxy] 404 unhandled: ${req.method} ${req.url}`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not found', type: 'invalid_request_error' } }));
});

server.listen(PORT, () => {
  console.log(`vertex-proxy listening on http://0.0.0.0:${PORT}`);
  console.log(`  default model: ${DEFAULT_MODEL}`);
});

process.on('uncaughtException', (err) => console.error('[vertex-proxy] uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('[vertex-proxy] unhandledRejection:', err));
