"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CreditCard, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
    CardContent,
    CardFooter,
} from "@/components/ui/card";
import { PlanSelectorDialog } from "./PlanSelectorDialog";
import { CancelSubscriptionAction } from "./CancelSubscriptionAction";

export interface Subscription {
    plan: string;
    status: "active" | "trialing" | "cancelled" | "expired";
    billingCycle: "monthly" | "annual";
    startedAt: string;
    endedAt?: string;
    trialEndsAt?: string;
}

export function SubscriptionDetails() {
    const { tenantId } = useTenant();

    const { data: subscription, isLoading, isError, error } = useQuery<Subscription>({
        queryKey: ["subscription", tenantId],
        queryFn: () => api.get<Subscription>("/api/v1/billing/subscription"),
    });

    if (isLoading) {
        return (
            <Card className="bg-card">
                <CardHeader>
                    <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-4 w-48" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (isError) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Loading Subscription</AlertTitle>
                <AlertDescription>
                    {error instanceof Error ? error.message : "Failed to load subscription details."}
                </AlertDescription>
            </Alert>
        );
    }

    if (!subscription) {
        return null;
    }

    const statusColors = {
        active: "bg-green-500/10 text-green-500 border-green-500/20",
        trialing: "bg-blue-500/10 text-blue-500 border-blue-500/20",
        cancelled: "bg-amber-500/10 text-amber-500 border-amber-500/20",
        expired: "bg-destructive/10 text-destructive border-destructive/20",
    };

    return (
        <Card className="bg-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                    <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <CreditCard className="w-5 h-5 text-primary" />
                        Current Plan
                    </CardTitle>
                    <CardDescription className="mt-1">
                        Manage your tenant's subscription plan.
                    </CardDescription>
                </div>
                <Badge
                    variant="outline"
                    className={`px-2 py-1 text-xs uppercase font-bold tracking-widest ${statusColors[subscription.status] || ""}`}
                >
                    {subscription.status}
                </Badge>
            </CardHeader>
            <CardContent>
                <div className="flex items-end gap-3 mb-6">
                    <span className="text-4xl font-black capitalize tracking-tight text-foreground">
                        {subscription.plan}
                    </span>
                    <span className="text-sm text-muted-foreground font-medium mb-1 capitalize">
                        / {subscription.billingCycle}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarClock className="w-4 h-4" />
                        <span>
                            Started on {new Date(subscription.startedAt).toLocaleDateString()}
                        </span>
                    </div>

                    {subscription.trialEndsAt && subscription.status === "trialing" && (
                        <div className="flex items-center gap-2 text-sm text-amber-500 font-medium">
                            <CalendarClock className="w-4 h-4" />
                            <span>
                                Trial ends on {new Date(subscription.trialEndsAt).toLocaleDateString()}
                            </span>
                        </div>
                    )}

                    {subscription.endedAt && (subscription.status === "cancelled" || subscription.status === "expired") && (
                        <div className="flex items-center gap-2 text-sm text-destructive font-medium">
                            <CalendarClock className="w-4 h-4" />
                            <span>
                                Ended on {new Date(subscription.endedAt).toLocaleDateString()}
                            </span>
                        </div>
                    )}
                </div>
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row items-center gap-3 border-t border-border pt-6 mt-2">
                <PlanSelectorDialog currentPlan={subscription.plan} />
                <CancelSubscriptionAction status={subscription.status} />
            </CardFooter>
        </Card>
    );
}
