import { mpkRzeszowProvider } from './mpk-rzeszow-provider';
import { marcelProvider } from './marcel-provider';
import { pkpIntercityProvider } from './pkp-intercity-provider';
import { toProviderHealthSnapshot } from './provider-health';
import type { ProviderHealthSnapshot, ProviderId, TransportProvider } from './types';

type ProviderRegistryEntry = {
  id: ProviderId;
  operatorName: string;
  implemented: boolean;
  provider?: TransportProvider;
};

const providerRegistry: ProviderRegistryEntry[] = [
  { id: 'mpk_rzeszow', operatorName: 'MPK Rzeszów', implemented: true, provider: mpkRzeszowProvider },
  { id: 'marcel', operatorName: 'Marcel', implemented: true, provider: marcelProvider },
  { id: 'pkp_intercity', operatorName: 'PKP Intercity', implemented: true, provider: pkpIntercityProvider },
];

export function getRequestedProviderEntries(requestedProviderIds: string[]): ProviderRegistryEntry[] {
  const normalizedRequested = requestedProviderIds
    .map((providerId) => String(providerId || '').trim())
    .filter(Boolean);
  const effectiveRequested = normalizedRequested.length > 0 ? normalizedRequested : ['mpk_rzeszow'];
  const requestedSet = new Set(effectiveRequested);
  return providerRegistry.filter((entry) => requestedSet.has(entry.id));
}

export function getProviderById(providerId: string): ProviderRegistryEntry | undefined {
  return providerRegistry.find((entry) => entry.id === providerId);
}

export function getProviderHealthSnapshots(): ProviderHealthSnapshot[] {
  return providerRegistry.map((entry) => toProviderHealthSnapshot(entry.id, entry.implemented, entry.operatorName));
}
