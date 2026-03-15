import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { db, memberships, users, roles, tenants, invitationTokens, auditLog } from '@serverless-saas/database';
import { sendEmail } from '@serverless-saas/notifications';
import type { AppEnv } from '../types';

// Public routes — GET /:token and POST /:token/accept
// Registered BEFORE tenant resolution middleware (ADR-026: user may have no tenantId)
export const invitationsPublicRoutes = new Hono<AppEnv>();

// Secure route — POST /invite
// Registered under /members path, requires full auth + tenant + permissions
export const memberInviteRoutes = new Hono<AppEnv>();

const hashToken = (raw: string): string => createHash('sha256').update(raw).digest('hex');

// GET /invitations/:token — validate token and return invite details
// Public — no auth required (invitee may not have an account yet)
invitationsPublicRoutes.get('/:token', async (c) => {
    const tokenHash = hashToken(c.req.param('token'));

    const [row] = await db
        .select({
            id: invitationTokens.id,
            status: invitationTokens.status,
            expiresAt: invitationTokens.expiresAt,
            email: invitationTokens.email,
            tenantName: tenants.name,
            tenantSlug: tenants.slug,
            roleName: roles.name,
            inviterName: users.name,
        })
        .from(invitationTokens)
        .innerJoin(tenants, eq(invitationTokens.tenantId, tenants.id))
        .innerJoin(roles, eq(invitationTokens.roleId, roles.id))
        .innerJoin(users, eq(invitationTokens.invitedBy, users.id))
        .where(eq(invitationTokens.tokenHash, tokenHash))
        .limit(1);

    if (!row) {
        return c.json({ error: 'Invitation not found', code: 'NOT_FOUND' }, 404);
    }
    if (row.status === 'accepted') {
        return c.json({ error: 'Invitation already accepted', code: 'ALREADY_ACCEPTED' }, 400);
    }
    if (row.status === 'revoked') {
        return c.json({ error: 'Invitation has been revoked', code: 'REVOKED' }, 400);
    }
    if (row.status === 'expired' || row.expiresAt < new Date()) {
        return c.json({ error: 'Invitation has expired', code: 'EXPIRED' }, 400);
    }

    return c.json({
        tenantName: row.tenantName,
        tenantSlug: row.tenantSlug,
        roleName: row.roleName,
        inviterName: row.inviterName,
        email: row.email,
        expiresAt: row.expiresAt,
    });
});

// POST /invitations/:token/accept — accept an invitation
// Requires JWT auth — user must be signed up and logged in (may have empty tenantId — ADR-026)
invitationsPublicRoutes.post('/:token/accept', async (c) => {
    const tokenHash = hashToken(c.req.param('token'));

    const userId = c.get('userId') as string | undefined;
    if (!userId) {
        return c.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, 401);
    }

    const [row] = await db
        .select({
            id: invitationTokens.id,
            status: invitationTokens.status,
            expiresAt: invitationTokens.expiresAt,
            email: invitationTokens.email,
            tenantId: invitationTokens.tenantId,
            membershipId: invitationTokens.membershipId,
            tenantSlug: tenants.slug,
        })
        .from(invitationTokens)
        .innerJoin(tenants, eq(invitationTokens.tenantId, tenants.id))
        .where(eq(invitationTokens.tokenHash, tokenHash))
        .limit(1);

    if (!row) {
        return c.json({ error: 'Invitation not found', code: 'NOT_FOUND' }, 404);
    }
    if (row.status === 'accepted') {
        return c.json({ error: 'Invitation already accepted', code: 'ALREADY_ACCEPTED' }, 400);
    }
    if (row.status === 'revoked') {
        return c.json({ error: 'Invitation has been revoked', code: 'REVOKED' }, 400);
    }
    if (row.expiresAt < new Date()) {
        return c.json({ error: 'Invitation has expired', code: 'EXPIRED' }, 400);
    }

    // Verify the authenticated user's email matches the invitation email
    const [acceptingUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!acceptingUser) {
        return c.json({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404);
    }
    if (acceptingUser.email.toLowerCase() !== row.email.toLowerCase()) {
        return c.json({ error: 'Email does not match invitation', code: 'EMAIL_MISMATCH' }, 403);
    }

    // Activate membership — set userId in case it was null at invite time (user didn't exist yet)
    await db.update(memberships)
        .set({ status: 'active', userId, joinedAt: new Date(), updatedAt: new Date() })
        .where(eq(memberships.id, row.membershipId));

    await db.update(invitationTokens)
        .set({ status: 'accepted', acceptedAt: new Date() })
        .where(eq(invitationTokens.id, row.id));

    return c.json({ success: true, tenantId: row.tenantId, tenantSlug: row.tenantSlug });
});

// POST /members/invite — send a tenant invitation
// Secure — requires members:create permission, registered under /members path
memberInviteRoutes.post('/invite', async (c) => {
    const requestContext = c.get('requestContext') as any;
    const tenantId = requestContext?.tenant?.id;
    const permissions = requestContext?.permissions ?? [];
    const userId = c.get('userId') as string;

    if (!permissions.includes('members:create')) {
        return c.json({ error: 'Forbidden', code: 'INSUFFICIENT_PERMISSIONS' }, 403);
    }

    try {
    const schema = z.object({
        email: z.string().email(),
        roleId: z.string().uuid(),
    });

    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.errors[0].message }, 400);
    }

    const { email, roleId } = result.data;

    // Check invitee is not already an active member of this tenant
    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (existingUser) {
        const [existingMembership] = await db.select({ id: memberships.id }).from(memberships).where(and(
            eq(memberships.userId, existingUser.id),
            eq(memberships.tenantId, tenantId),
            eq(memberships.status, 'active'),
        )).limit(1);
        if (existingMembership) {
            return c.json({ error: 'User is already an active member of this tenant', code: 'ALREADY_MEMBER' }, 409);
        }
    }

    // Check for existing pending invitation
    const [existingInvitation] = await db.select({ id: invitationTokens.id })
        .from(invitationTokens)
        .where(and(
            eq(invitationTokens.email, email),
            eq(invitationTokens.tenantId, tenantId),
            eq(invitationTokens.status, 'pending'),
        ))
        .limit(1);
    if (existingInvitation) {
        return c.json({ error: 'A pending invitation already exists for this email', code: 'INVITATION_PENDING' }, 409);
    }

    // Fetch tenant name for email — name is not stored in requestContext.tenant (ADR-013 cache shape)
    const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const tenantName = tenant?.name ?? 'the workspace';

    // Create membership with status 'invited' — userId null if invitee has no account yet
    const [membership] = await db.insert(memberships).values({
        userId: existingUser?.id ?? null,
        tenantId,
        roleId,
        memberType: 'human',
        status: 'invited',
        invitedBy: userId,
        invitedAt: new Date(),
    }).returning();

    // Generate token — raw token sent via email only, never stored or returned in response
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [token] = await db.insert(invitationTokens).values({
        tenantId,
        membershipId: membership.id,
        email,
        tokenHash,
        roleId,
        invitedBy: userId,
        status: 'pending',
        expiresAt,
    }).returning();

    const appUrl = process.env.APP_URL ?? '';
    try {
        await sendEmail({
            to: email,
            subject: `You've been invited to ${tenantName}`,
            html: `<p>You've been invited to join <strong>${tenantName}</strong>.</p><p><a href="${appUrl}/auth/invite/${rawToken}">Click here to accept your invitation</a></p><p>This invitation expires in 7 days.</p>`,
        });
    } catch (emailErr) {
        console.error('Invitation email send failed:', emailErr);
    }

    try {
        await db.insert(auditLog).values({
            tenantId,
            actorId: userId,
            actorType: 'human',
            action: 'member_invited',
            resource: 'membership',
            resourceId: membership.id,
            metadata: { email, roleId },
            traceId: c.get('traceId') ?? '',
        });
    } catch (auditErr) {
        console.error('Audit log write failed:', auditErr);
    }

    return c.json({ success: true, invitationId: token.id }, 201);
    } catch (err) {
        console.error('INVITE_ERROR:', err instanceof Error ? err.message : err, err instanceof Error ? err.stack : '');
        throw err;
    }
});
