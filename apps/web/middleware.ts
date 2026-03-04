import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};

export function middleware(request: NextRequest) {
    const url = request.nextUrl;
    const hostname = request.headers.get('host') || '';

    // Get the root domain from environment variables
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'yourapp.com';

    // Extract the subdomain (tenant slug)
    // e.g., acme.yourapp.com -> acme
    // e.g., yourapp.com -> undefined
    const subdomain = hostname.replace(`.${rootDomain}`, '');

    const isRootDomain = hostname === rootDomain || hostname === `www.${rootDomain}`;
    const isDashboardPath = url.pathname.startsWith('/dashboard') || url.pathname.includes('/dashboard');

    // If we're on the root domain but trying to access a dashboard path without a tenant
    // we should handle this based on whether it's a direct /[tenant]/dashboard hit or something else.
    // The structure is app/[tenant]/dashboard/

    if (isRootDomain && isDashboardPath) {
        // Redirect to login or marketing on the root domain if no tenant is provided
        // For now, let's just allow it to fall through or redirect to marketing
        return NextResponse.next();
    }

    // If we have a subdomain, it's our tenant slug
    const tenantSlug = !isRootDomain ? subdomain : null;

    // Clone the request headers and set the tenant slug
    const requestHeaders = new Headers(request.headers);
    if (tenantSlug) {
        requestHeaders.set('x-tenant-slug', tenantSlug);
    }

    // Rewrite or redirect logic can be added here if needed.
    // For now, we're just passing the header.

    return NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
}
