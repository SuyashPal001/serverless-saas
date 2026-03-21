"use client";

import { useTheme } from "next-themes";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    TooltipProps,
} from "recharts";
import { UsageDataPoint } from "@/lib/hooks/useUsage";

interface UsageChartProps {
    data: UsageDataPoint[];
}

function CustomTooltip({ active, payload, label }: any) {
    if (active && payload && payload.length) {
        return (
            <div className="rounded-lg border bg-background p-2 shadow-sm">
                <p className="text-[0.70rem] uppercase text-muted-foreground mb-1">
                    {new Date(label).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                    })}
                </p>
                <div className="flex flex-col">
                    <span className="font-bold text-foreground">
                        {payload[0].value?.toLocaleString()}
                    </span>
                </div>
            </div>
        );
    }
    return null;
}

export function UsageChart({ data }: UsageChartProps) {
    const { resolvedTheme } = useTheme();
    const primaryColor = resolvedTheme === "dark" ? "hsl(210 40% 98%)" : "hsl(222.2 47.4% 11.2%)"; // Default fallback, but using current color. Wait, let's use a simpler approach.

    return (
        <div className="h-[300px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart
                    data={data}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                    <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(value: string | number) =>
                            new Date(value).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                            })
                        }
                    />
                    <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(value: number) =>
                            value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toString()
                        }
                    />
                    <Tooltip cursor={{ fill: "hsl(var(--muted)/0.5)" }} content={<CustomTooltip />} />
                    <Bar
                        dataKey="value"
                        fill="hsl(var(--primary))"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={40}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
