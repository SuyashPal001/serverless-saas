import { UsageSummary } from "@/components/platform/billing/UsageSummary";
import { PermissionGate } from "@/components/platform/PermissionGate";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export default async function UsageDetailsPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    const { tenant } = await params;

    return (
        <PermissionGate resource="billing" action="read">
            <div className="space-y-6">
                <div>
                    <Link 
                        href={`/${tenant}/dashboard/billing`}
                        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        Back to Billing
                    </Link>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                        Usage Details
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Detailed breakdown of your workspace API usage over time.
                    </p>
                </div>

                <UsageSummary />
            </div>
        </PermissionGate>
    );
}
