import type { NextRequest } from 'next/server';

/**
 * Extracts the tenant slug from the x-tenant-slug header set by middleware.
 * 
 * @param request - The incoming Next.js request
 * @returns The tenant slug as a string, or null if not present
 */
export function getTenantSlug(request: NextRequest | Request): string | null {
    return request.headers.get('x-tenant-slug');
}

export interface TenantClaims {
    tenantId: string;
    tenantSlug?: string;
    role: string;
    plan: string;
    permissions?: string[];
    [key: string]: any;
}

/**
 * Decodes the JWT token to extract tenant claims without verifying the signature.
 * This is safe for client-side routing/UX gating, but the server MUST verify the signature for API calls.
 * 
 * @param token - The raw JWT string
 * @returns The extracted TenantClaims or null if decoding fails
 */
export function decodeTenantClaims(token: string): TenantClaims | null {
    if (!token) return null;

    try {
        // JWT is separated by dots: header.payload.signature
        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }

        const payloadBase64Url = parts[1];
        // Base64Url to Base64
        const payloadBase64 = payloadBase64Url.replace(/-/g, '+').replace(/_/g, '/');

        // Decode Base64 to string
        // Works in both browser (atob) and node (Buffer) environments
        let payloadString: string;
        if (typeof window !== 'undefined') {
            payloadString = window.atob(payloadBase64);
        } else {
            payloadString = Buffer.from(payloadBase64, 'base64').toString('utf8');
        }

        const payload = JSON.parse(payloadString);

        // Assuming the claims are stored at the root of the payload or under 'custom:' (Cognito standard)
        return {
            tenantId: payload['custom:tenantId'] || payload.tenantId || '',
            role: payload['custom:role'] || payload.role || '',
            plan: payload['custom:plan'] || payload.plan || '',
            ...payload
        };
    } catch (error) {
        console.error('Failed to decode tenant claims from JWT', error);
        return null;
    }
}
