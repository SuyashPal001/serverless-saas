import { SubscriptionDetails } from "@/components/platform/billing/SubscriptionDetails";
import { EntitlementsSummary } from "@/components/platform/billing/EntitlementsSummary";
import { PermissionGate } from "@/components/platform/PermissionGate";

export default async function BillingPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    await params;

    return (
        <PermissionGate resource="billing" action="read">
            <div className="space-y-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                        Billing & Subscription
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Manage your subscription plan, payment methods, and monitor usage.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <SubscriptionDetails />
                    <EntitlementsSummary />
                </div>
            </div>
        </PermissionGate>
    );
}
