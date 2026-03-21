"use client";

import { useState } from "react";
import { useUsage } from "@/lib/hooks/useUsage";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { UsageChart } from "./UsageChart";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Activity, BarChart3 } from "lucide-react";
import {
    Card,
    CardDescription,
    CardHeader,
    CardTitle,
    CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function UsageSummary() {
    const { tenantId } = useTenant();
    const [period, setPeriod] = useState<"daily" | "monthly">("daily");

    const { data: usage, isLoading, isError, error } = useUsage({
        tenantId,
        metric: "api_calls",
        period,
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
                        <Skeleton className="h-48 w-full" />
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (isError) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Loading Usage</AlertTitle>
                <AlertDescription className="flex flex-col gap-2 items-start mt-2">
                    <p>{error instanceof Error ? error.message : "Failed to load usage data."}</p>
                    <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                        Retry
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }

    if (!usage) {
        return null;
    }

    const percentage = usage.limit === 0
        ? 0
        : Math.min(Math.round((usage.total / usage.limit) * 100), 100);

    const isNearLimit = percentage >= 80;

    return (
        <Card className="bg-card">
            <CardHeader className="pb-4 flex flex-row items-start justify-between">
                <div>
                    <CardTitle className="text-xl font-bold">Usage This Month</CardTitle>
                    <CardDescription>
                        Monitor your API consumption and limits.
                    </CardDescription>
                </div>
                <div className="flex bg-muted p-1 rounded-lg">
                    <button
                        onClick={() => setPeriod("daily")}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors ${period === "daily" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        Daily
                    </button>
                    <button
                        onClick={() => setPeriod("monthly")}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors ${period === "monthly" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
                            }`}
                    >
                        Monthly
                    </button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="space-y-6">
                    {/* Progress Section */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 font-medium text-foreground">
                                <Activity className="w-4 h-4 text-muted-foreground" />
                                API Calls
                            </span>
                            <span className="text-muted-foreground">
                                <span className="text-foreground font-semibold">
                                    {usage.total.toLocaleString()}
                                </span>
                                {` / ${usage.limit.toLocaleString()}`}
                            </span>
                        </div>

                        <div className="h-2 w-full bg-accent rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${percentage > 90 ? "bg-destructive" : percentage > 75 ? "bg-amber-500" : "bg-primary"
                                    }`}
                                style={{ width: `${percentage}%` }}
                            />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                                You've used {percentage}% of your plan
                            </span>
                            {isNearLimit && (
                                <Button variant="link" className="h-auto p-0 text-xs text-primary">
                                    Upgrade Plan
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Chart Section */}
                    <div className="pt-4 border-t">
                        <div className="flex items-center gap-2 mb-2 text-sm font-medium">
                            <BarChart3 className="w-4 h-4 text-muted-foreground" />
                            {period === "daily" ? "Daily Usage" : "Monthly Usage"}
                        </div>
                        {usage.data.length > 0 ? (
                            <UsageChart data={usage.data} />
                        ) : (
                            <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
                                <BarChart3 className="w-8 h-8 mb-2 opacity-20" />
                                <p className="text-sm">No usage data yet</p>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
