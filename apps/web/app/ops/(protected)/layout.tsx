import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeTenantClaims } from "@/lib/tenant";
import { OpsShell } from "../_components/OpsShell";

export default async function OpsProtectedLayout({ children }: { children: React.ReactNode }) {
    const cookieStore = await cookies();
    const token = cookieStore.get("platform_token")?.value;

    if (!token) redirect("/ops/login");

    const claims = decodeTenantClaims(token);
    if (!claims || claims.role !== "platform_admin") redirect("/ops-unauthorized");

    return <OpsShell>{children}</OpsShell>;
}
