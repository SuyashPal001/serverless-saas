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
    // Step 1 — extract claims from the validated JWT
    // API Gateway validates the JWT, Hono makes claims available via jwtPayload
    const jwtPayload = c.get('jwtPayload');
    const cognitoId = jwtPayload.sub;
    const email = jwtPayload.email;
    const name = jwtPayload.name;

    // Step 2 — validate required claims are present
    if (!cognitoId || !email) {
        return c.json({ error: 'Invalid JWT payload' }, 401);
    }

    // Step 3 — upsert user into DB
    // Single atomic query — insert if new, update email/name if existing
    // ON CONFLICT (cognitoId) handles the case where user already exists
    const [user] = await db.insert(users)
        .values({
            cognitoId,
            email,
            name,
        })
        .onConflictDoUpdate({
            target: users.cognitoId,
            set: {
                email,
                name,
                updatedAt: new Date(),
            },
        })
        .returning();

    // Step 4 — attach userId to context for downstream middleware
    c.set('userId', user.id);

    await next();
};