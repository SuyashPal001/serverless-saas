import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { decodeTenantClaims } from "@/lib/tenant";
import { TenantProvider } from "./tenant-provider";

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

    if (!claims) {
        // Alternatively redirect to login if claims are malformed
        redirect("/auth/login");
    }

    return (
        <TenantProvider claims={claims}>
            <div className="tenant-context-wrapper" data-tenant={tenant}>
                {children}
            </div>
        </TenantProvider>
    );
}
