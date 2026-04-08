import express from 'express';
import { handleRequest } from './gateway';

const PORT = Number(process.env.PORT ?? 3002);
const app  = express();

app.use(express.json());

// ── MCP endpoint ──────────────────────────────────────────────────────────────
// All JSON-RPC messages (tools/list, tools/call) arrive here.
// x-tenant-id is mandatory — every operation is scoped to one tenant.
app.post('/mcp', async (req, res) => {
  const tenantId = req.headers['x-tenant-id'];

  if (!tenantId || typeof tenantId !== 'string') {
    res.status(401).json({ error: 'missing tenant' });
    return;
  }

  try {
    const response = await handleRequest(tenantId, req.body);
    res.json(response);
  } catch (err) {
    // handleRequest should never throw — this is a safety net
    console.error('[mcp-server] unexpected error:', (err as Error).message);
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal server error' },
      id: null,
    });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', port: PORT });
});

app.listen(PORT, () => {
  console.log(`[mcp-server] listening on port ${PORT}`);
});
