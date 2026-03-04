"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Users, Activity, Bot } from "lucide-react";
import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
    CardContent,
} from "@/components/ui/card";

interface EntitlementMetrics {
    used: number;
    limit: number;
    unlimited: boolean;
}

export interface Entitlements {
    seats: EntitlementMetrics;
    api_calls: EntitlementMetrics;
    agents: EntitlementMetrics;
}

function MetricProgress({
    label,
    icon: Icon,
    metrics
}: {
    label: string,
    icon: React.ElementType,
    metrics: EntitlementMetrics
}) {
    const percentage = metrics.unlimited
        ? 0
        : Math.min(Math.round((metrics.used / metrics.limit) * 100), 100);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-foreground">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    {label}
                </span>
                <span className="text-muted-foreground">
                    <span className="text-foreground font-semibold">
                        {metrics.used.toLocaleString()}
                    </span>
                    {metrics.unlimited ? "" : ` / ${metrics.limit.toLocaleString()}`}
                </span>
            </div>

            {!metrics.unlimited && (
                <div className="h-2 w-full bg-accent rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all ${percentage > 90 ? "bg-destructive" : percentage > 75 ? "bg-amber-500" : "bg-primary"
                            }`}
                        style={{ width: `${percentage}%` }}
                    />
                </div>
            )}
            {metrics.unlimited && (
                <div className="h-2 w-full bg-primary/20 rounded-full flex items-center justify-center">
                    <span className="text-[8px] uppercase font-bold tracking-widest text-primary leading-none">
                        Unlimited
                    </span>
                </div>
            )}
        </div>
    );
}

export function EntitlementsSummary() {
    const { tenantId } = useTenant();

    const { data: entitlements, isLoading, isError, error } = useQuery<Entitlements>({
        queryKey: ["entitlements", tenantId],
        queryFn: () => api.get<Entitlements>("/api/v1/entitlements"),
    });

    if (isLoading) {
        return (
            <Card className="bg-card">
                <CardHeader>
                    <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent>
                    <div className="space-y-6">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (isError) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Loading Entitlements</AlertTitle>
                <AlertDescription>
                    {error instanceof Error ? error.message : "Failed to load entitlements."}
                </AlertDescription>
            </Alert>
        );
    }

    if (!entitlements) {
        return null;
    }

    return (
        <Card className="bg-card">
            <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold">Plan Usage</CardTitle>
                <CardDescription>
                    Current resources consumed in this billing cycle.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-6">
                    <MetricProgress
                        label="Team Seats"
                        icon={Users}
                        metrics={entitlements.seats}
                    />
                    <MetricProgress
                        label="API Calls"
                        icon={Activity}
                        metrics={entitlements.api_calls}
                    />
                    <MetricProgress
                        label="Active Agents"
                        icon={Bot}
                        metrics={entitlements.agents}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
