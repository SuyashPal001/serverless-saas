// Local dev server — same app, different entry point
// Production uses index.ts (Lambda handler)
// Local uses this file (Node HTTP server)

import { serve } from '@hono/node-server';
import { app } from './app';

const port = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port }, () => {
  console.log(`Foundation API running at http://localhost:${port}`);
});
