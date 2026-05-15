import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface UsageDataPoint {
    date: string;
    value: number;
}

export interface UsageResponse {
    data: UsageDataPoint[];
    total: number;
    limit: number;
    period: 'daily' | 'monthly';
    metric: string;
}

interface UseUsageOptions {
    tenantId: string | null;
    metric?: string;
    period?: 'daily' | 'monthly';
}

export function useUsage({ tenantId, metric = 'api_calls', period = 'daily' }: UseUsageOptions) {
    return useQuery<UsageResponse>({
        queryKey: ['usage', tenantId, metric, period],
        queryFn: () => api.get<UsageResponse>(`/api/v1/usage?metric=${metric}&period=${period}`),
        enabled: !!tenantId,
    });
}
