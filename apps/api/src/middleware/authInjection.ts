import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv } from '../types';

const jwksUri = process.env.COGNITO_JWKS_URI;

// Initialize JWKS if URI is provided (local dev requirement)
const JWKS = jwksUri ? createRemoteJWKSet(new URL(jwksUri)) : null;

/**
 * In production (AWS Lambda + API Gateway), jwtPayload is already set on the context.
 * In local development, we need to extract and validate the JWT ourselves.
 * This middleware ensures jwtPayload is available for downstream middleware.
 */
export const authInjectionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    // If already set (Production Lambda Path), pass through
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

    // Attempt JWT validation if JWKS is available (local dev)
    if (JWKS) {
        try {
            const { payload } = await jwtVerify(token, JWKS);
            c.set('jwtPayload', payload as Record<string, string>);
        } catch (error) {
            console.error('Local JWT validation failed:', error);
            // We don't block here because apiKeyAuth might still handle it or it might be a public route
            // userUpsert or downstream auth middleware will handle missing/invalid identities
        }
    }

    await next();
});
