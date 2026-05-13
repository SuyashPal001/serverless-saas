import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@serverless-saas/database';
import { users } from '@serverless-saas/database/schema/auth';
import { adminInitiateAuth, setUserPassword } from '@serverless-saas/auth';
import type { Context } from 'hono';
import type { AppEnv } from '../types';

// POST /auth/change-password
export async function handleChangePassword(c: Context<AppEnv>) {
    const userId = c.get('userId') as string;
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);

    const body = await c.req.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
        return c.json({ error: 'currentPassword and newPassword are required' }, 400);
    }

    if (newPassword.length < 8) {
        return c.json({ error: 'New password must be at least 8 characters', code: 'VALIDATION_ERROR' }, 400);
    }

    const [user] = await db
        .select({ email: users.email }).from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
    if (!user) return c.json({ error: 'User not found', code: 'NOT_FOUND' }, 404);

    try {
        await adminInitiateAuth(user.email, currentPassword);
    } catch (err: any) {
        const code = err.name || '';
        if (code === 'NotAuthorizedException') {
            return c.json({ error: 'Current password is incorrect', code: 'WRONG_CURRENT_PASSWORD' }, 401);
        }
        if (code === 'UserNotFoundException') {
            return c.json({ error: 'Password change is not available for accounts that sign in with Google or SSO.', code: 'SOCIAL_ACCOUNT_NO_PASSWORD' }, 409);
        }
        console.error('Password verification failed:', err);
        return c.json({ error: 'Failed to verify current password', code: 'INTERNAL_ERROR' }, 500);
    }

    try {
        await setUserPassword(user.email, newPassword);
    } catch (err: any) {
        const code = err.name || '';
        if (code === 'InvalidPasswordException') {
            return c.json({ error: err.message || 'New password does not meet requirements', code: 'INVALID_NEW_PASSWORD' }, 400);
        }
        console.error('Password update failed:', err);
        return c.json({ error: 'Failed to update password', code: 'INTERNAL_ERROR' }, 500);
    }

    return c.json({ success: true });
}
