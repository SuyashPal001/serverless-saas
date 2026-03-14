import type { Context, Next } from 'hono';
import { db } from '@serverless-saas/database';
import { users } from '@serverless-saas/database/schema/auth';

/**
 * User Upsert Middleware — Volca Pattern (ADR-024)
 *
 * Runs on every authenticated API request.
 * Creates the user in our DB if they don't exist yet,
 * or updates their email/name if they changed it (e.g. Google profile update).
 *
 * This replaces the Post Confirmation Lambda trigger — one place handles
 * all signup methods (email/password, Google OAuth, invite flow).
 *
 * Attaches userId to context so downstream middleware can use it.
 */
export const userUpsertMiddleware = async (c: Context, next: Next) => {
    const jwtPayload = c.get('jwtPayload');

    // Skip upsert if no JWT payload (e.g. API key request or non-authenticated)
    if (!jwtPayload) {
        return next();
    }

    const cognitoId = jwtPayload.sub;
    const email = jwtPayload.email as string;
    const name = jwtPayload.name as string | undefined;

    if (!cognitoId || !email) {
        console.log('401 reason: invalid jwt payload', { path: c.req.path, hasCognitoId: !!cognitoId, hasEmail: !!email });
        return c.json({ error: 'Invalid JWT payload' }, 401);
    }

    const [user] = await db.insert(users)
        .values({
            cognitoId: cognitoId,
            email: email,
            name: name || ""
        })
        .onConflictDoUpdate({
            target: users.cognitoId,
            set: { email, name: name || "", updatedAt: new Date() },
        })
        .returning();

    c.set('userId', user.id);

    await next();
};