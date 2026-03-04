// @serverless-saas/api
export {};

import { handle } from 'hono/aws-lambda';
import { app } from './app';

// Lambda handler — Hono handles routing
export const handler = handle(app);
