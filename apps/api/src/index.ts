// @serverless-saas/api
export { };

import { handle } from 'hono/aws-lambda';
import { app } from './app';

export const handler = async (event: any, context: any) => {
    console.log('RAW PATH:', event.rawPath, 'ROUTE KEY:', event.routeKey);
    return handle(app)(event, context);
};