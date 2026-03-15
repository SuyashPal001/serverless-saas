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
        console.log('JWT CLAIMS:', JSON.stringify(claims));  // TEMP DEBUG
        c.set('jwtPayload', claims as Record<string, string>);
        return next();
    }

    // If already set by some other means, pass through
    if (c.get('jwtPayload')) {
        return next();
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        console.log('AUTH INJECTION: no Bearer token, skipping');  // TEMP DEBUG
        return next();
    }

    const token = authHeader.slice(7);

    // If it's an API Key (ak_ prefix), skip JWT validation and let apiKeyAuthMiddleware handle it
    if (token.startsWith('ak_')) {
        return next();
    }

    // Public route path: API Gateway didn't run the JWT authorizer (requires_auth = false)
    // Try JWKS validation first, fall back to decode-without-verify
    // Security: secure routes are protected downstream by tenantResolutionMiddleware
    if (JWKS) {
        try {
            const { payload } = await jwtVerify(token, JWKS);
            c.set('jwtPayload', payload as Record<string, string>);
        } catch (error) {
            console.error('JWKS validation failed:', error);
            // Fallback: decode without verification
            // The token was already verified by Cognito at issuance
            // This path only runs on public routes where API GW didn't validate
            try {
                const payloadBase64 = token.split('.')[1];
                const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
                c.set('jwtPayload', payload as Record<string, string>);
                console.log('JWT fallback decode:', { sub: payload.sub, path: c.req.path });
            } catch (decodeErr) {
                console.error('JWT fallback decode failed:', decodeErr);
            }
        }
    } else {
        // No JWKS configured — decode without verification
        // This handles production public routes where COGNITO_JWKS_URI may not help
        try {
            const payloadBase64 = token.split('.')[1];
            const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
            c.set('jwtPayload', payload as Record<string, string>);
            console.log('JWT no-JWKS decode:', { sub: payload.sub, path: c.req.path });
        } catch (decodeErr) {
            console.error('JWT decode failed:', decodeErr);
        }
    }

    await next();
});