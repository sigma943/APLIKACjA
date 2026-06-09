import { markProviderError, markProviderSuccess } from './provider-health';
import { getProviderById, getProviderHealthSnapshots, getRequestedProviderEntries } from './provider-registry';
import type { ProviderRuntimeStatus, TransportVehicle } from './types';

type FetchVehiclesParams = {
  providerIds: string[];
  includeInactive: boolean;
  bbox?: [number, number, number, number] | null;
};

export async function fetchVehiclesForProviders(params: FetchVehiclesParams) {
  const entries = getRequestedProviderEntries(params.providerIds);
  const providerStatuses: Record<string, ProviderRuntimeStatus> = {};
  const vehiclesByProvider = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.implemented || !entry.provider) {
        providerStatuses[entry.id] = 'unsupported';
        return [] as TransportVehicle[];
      }

      try {
        const result = await entry.provider.getVehicles({
          includeInactive: params.includeInactive,
          bbox: params.bbox,
        });
        const status = result.cache === 'stale' ? 'stale' : 'ok';
        providerStatuses[entry.id] = status;
        markProviderSuccess(entry.id, status);
        return result.vehicles;
      } catch (error) {
        providerStatuses[entry.id] = 'error';
        markProviderError(entry.id, error);
        return [] as TransportVehicle[];
      }
    }),
  );

  const mergedVehicles = vehiclesByProvider.flat();
  const cacheState = Object.values(providerStatuses).some((status) => status === 'stale')
    ? 'stale'
    : Object.values(providerStatuses).every((status) => status === 'unsupported')
      ? 'miss'
      : 'fresh';

  return {
    vehicles: mergedVehicles,
    providers: providerStatuses,
    meta: {
      generatedAt: new Date().toISOString(),
      cache: cacheState,
    },
  };
}

export async function fetchVehicleDetails(providerId: string, vehicleId: string, includeInactive = true) {
  const entry = getProviderById(providerId);
  if (!entry || !entry.implemented || !entry.provider) return null;

  try {
    const vehicle = await entry.provider.getVehicleDetails(vehicleId, { includeInactive });
    if (vehicle) markProviderSuccess(entry.id, 'ok');
    return vehicle;
  } catch (error) {
    markProviderError(entry.id, error);
    throw error;
  }
}

export function getProvidersHealth() {
  return {
    generatedAt: new Date().toISOString(),
    providers: getProviderHealthSnapshots(),
  };
}
