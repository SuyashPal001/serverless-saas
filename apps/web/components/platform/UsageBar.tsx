'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useTenant } from '@/app/[tenant]/tenant-provider';
import { cn } from '@/lib/utils';

interface EntitlementsResponse {
    messages: {
        used: number;
        limit: number;
        unlimited: boolean;
    };
    [key: string]: unknown;
}

export function UsageBar() {
    const { tenantSlug } = useTenant();

    const { data } = useQuery<EntitlementsResponse>({
        queryKey: ['entitlements', tenantSlug],
        queryFn: () => apiGet('/api/v1/entitlements'),
        staleTime: 60_000,
    });

    const messages = data?.messages;
    if (!messages) return null;

    if (messages.unlimited) {
        return (
            <div className="px-3 py-2 mb-2">
                <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{messages.used.toLocaleString()}</span> messages this month
                </p>
            </div>
        );
    }

    const ratio = messages.limit > 0 ? messages.used / messages.limit : 0;
    const pct = Math.min(ratio * 100, 100);
    const isAtLimit = ratio >= 1;
    const isWarning = ratio >= 0.8 && ratio < 1;

    return (
        <div className="px-3 py-2 mb-2 space-y-1.5">
            <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                    <span className={cn('font-medium', isAtLimit ? 'text-red-500' : 'text-foreground')}>
                        {messages.used.toLocaleString()}
                    </span>
                    {' / '}
                    {messages.limit.toLocaleString()} messages
                </p>
            </div>

            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                <div
                    className={cn(
                        'h-full rounded-full transition-all',
                        isAtLimit  ? 'bg-red-500' :
                        isWarning  ? 'bg-amber-500' :
                                     'bg-muted-foreground/40'
                    )}
                    style={{ width: `${pct}%` }}
                />
            </div>

            {isAtLimit && (
                <Link
                    href={`/${tenantSlug}/dashboard/billing`}
                    className="text-[11px] text-red-500 hover:text-red-400 font-medium transition-colors"
                >
                    Upgrade for more →
                </Link>
            )}
        </div>
    );
}
