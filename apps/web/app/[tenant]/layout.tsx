import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { decodeTenantClaims } from "@/lib/tenant";
import { TenantProvider } from "./tenant-provider";
import { UpgradePromptProvider } from "@/components/platform/UpgradePromptProvider";

export default async function TenantLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ tenant: string }>;
}) {
    const { tenant } = await params;

    // Await Next.js 15 cookies and headers
    const cookieStore = await cookies();
    const token = cookieStore.get("platform_token")?.value;

    if (!token) {
        redirect("/auth/login");
    }

    const claims = decodeTenantClaims(token);
    if (claims) {
        claims.tenantSlug = tenant;
    }

    if (!claims) {
        // Alternatively redirect to login if claims are malformed
        redirect("/auth/login");
    }

    // Fetch permissions from API server-side
    try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiBase}/api/v1/auth/me`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            cache: 'no-store', // Don't cache permissions
        });

        if (response.ok) {
            const profile = await response.json();
            claims.permissions = profile.permissions || [];
        } else {
            // On failure, set empty array and continue
            claims.permissions = [];
        }
    } catch (error) {
        console.error('Failed to fetch permissions:', error);
        // On failure, set empty array and continue (don't block the page)
        claims.permissions = [];
    }

    return (
        <TenantProvider claims={claims}>
            <UpgradePromptProvider>
                <div className="tenant-context-wrapper" data-tenant={tenant}>
                    {children}
                </div>
            </UpgradePromptProvider>
        </TenantProvider>
    );
}
