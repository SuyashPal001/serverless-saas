import express from 'express';
import { handleMcpRequest } from './server';

const PORT = 3002;
const app = express();

app.use(express.json());

// ── MCP endpoint ──────────────────────────────────────────────────────────────
// All MCP JSON-RPC messages (tools/list, tools/call) come through here.
// x-tenant-id is mandatory; x-agent-id is optional (enables policy checks).
app.post('/mcp', async (req, res) => {
  try {
    await handleMcpRequest(req, res);
  } catch (err) {
    console.error('[mcp] unhandled error:', (err as Error).message);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mcp-server', port: PORT });
});

app.listen(PORT, () => {
  console.log(`[mcp-server] listening on port ${PORT}`);
});
