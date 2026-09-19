import { useQuery } from '@tanstack/react-query';
import { fetchNetwork, fetchState } from '../api/client';

export function useNetwork() {
  return useQuery({
    queryKey: ['network'],
    queryFn: fetchNetwork,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}

export function useNetworkState(timestamp?: string) {
  return useQuery({
    queryKey: ['state', timestamp],
    queryFn: () => fetchState(timestamp),
    refetchInterval: 30000,
    retry: 2,
  });
}
