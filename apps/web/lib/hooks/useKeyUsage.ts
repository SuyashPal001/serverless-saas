import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface UsageDataPoint {
  date: string;
  value: number;
}

export interface KeyUsageResponse {
  data: UsageDataPoint[];
  total: number;
  keyId: string;
  keyName: string;
}

export function useKeyUsage(keyId: string | null) {
  return useQuery<KeyUsageResponse>({
    queryKey: ['api-key-usage', keyId],
    queryFn: () => api.get(`/api/v1/api-keys/${keyId}/usage`),
    enabled: !!keyId,  // only fetch when keyId is provided
  });
}
