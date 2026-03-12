import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv } from '../types';

const jwksUri = process.env.COGNITO_JWKS_URI;

// Initialize JWKS if URI is provided (local dev requirement)
const JWKS = jwksUri ? createRemoteJWKSet(new URL(jwksUri)) : null;

/**
 * In production (AWS Lambda + API Gateway), JWT claims are passed via the
 * Lambda event context — we extract them here and set jwtPayload on the Hono context.
 * In local development, we validate the JWT ourselves using the Cognito JWKS endpoint.
 */
export const authInjectionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    // Production path: API Gateway JWT authorizer validates the token and passes
    // claims via event.requestContext.authorizer.jwt.claims (HTTP API v2)
    const claims = (c.env?.event?.requestContext as any)?.authorizer?.jwt?.claims;
    if (claims) {
        c.set('jwtPayload', claims as Record<string, string>);
        return next();
    }

    // If already set by some other means, pass through
    if (c.get('jwtPayload')) {
        return next();
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return next();
    }

    const token = authHeader.slice(7);

    // If it's an API Key (ak_ prefix), skip JWT validation and let apiKeyAuthMiddleware handle it
    if (token.startsWith('ak_')) {
        return next();
    }

    // Local dev path: validate JWT ourselves using Cognito JWKS
    if (JWKS) {
        try {
            const { payload } = await jwtVerify(token, JWKS);
            c.set('jwtPayload', payload as Record<string, string>);
        } catch (error) {
            console.error('Local JWT validation failed:', error);
        }
    }

    await next();
});