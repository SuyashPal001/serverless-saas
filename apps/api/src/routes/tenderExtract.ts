import { Hono } from 'hono';
import type { AppEnv } from '../types';

const RELAY_URL = (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const INTERNAL_KEY = (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

export const tenderExtractRoutes = new Hono<AppEnv>();

// POST /tender/authoring/extract-text — forward multipart to relay, return [{filename, text, status}]
tenderExtractRoutes.post('/authoring/extract-text', async (c) => {
  const body = await c.req.raw.arrayBuffer();
  const contentType = c.req.header('content-type') ?? '';

  try {
    const res = await fetch(`${RELAY_URL}/internal/tender/extract-text`, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        ...(INTERNAL_KEY ? { 'x-internal-service-key': INTERNAL_KEY } : {}),
      },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.json();
    return c.json(data, res.ok ? 200 : (res.status as any));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});
