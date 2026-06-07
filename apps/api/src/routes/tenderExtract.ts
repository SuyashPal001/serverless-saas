import { Hono } from 'hono';
import type { AppEnv } from '../types';

const relayUrl = () => (process.env.RELAY_URL ?? 'http://localhost:3001').trim();
const internalKey = () => (process.env.INTERNAL_SERVICE_KEY ?? '').trim();

export const tenderExtractRoutes = new Hono<AppEnv>();

// POST /tender/authoring/extract-text — forward multipart to relay, return [{filename, text, status}]
tenderExtractRoutes.post('/authoring/extract-text', async (c) => {
  const body = await c.req.raw.arrayBuffer();
  const contentType = c.req.header('content-type') ?? '';

  try {
    const key = internalKey();
    const res = await fetch(`${relayUrl()}/internal/tender/extract-text`, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        ...(key ? { 'x-internal-service-key': key } : {}),
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
