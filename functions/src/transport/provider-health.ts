import type { ProviderHealthSnapshot, ProviderId, ProviderRuntimeStatus } from './types';

type MutableHealthState = {
  status: ProviderRuntimeStatus;
  lastSuccessAt?: string;
  lastErrorAt?: string;
  lastError?: string;
};

const runtimeHealth = new Map<ProviderId, MutableHealthState>();

export function markProviderSuccess(provider: ProviderId, status: Extract<ProviderRuntimeStatus, 'ok' | 'stale'> = 'ok') {
  const current = runtimeHealth.get(provider) || { status: 'unknown' as ProviderRuntimeStatus };
  runtimeHealth.set(provider, {
    ...current,
    status,
    lastSuccessAt: new Date().toISOString(),
    lastError: status === 'ok' ? undefined : current.lastError,
  });
}

export function markProviderError(provider: ProviderId, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const current = runtimeHealth.get(provider) || { status: 'unknown' as ProviderRuntimeStatus };
  runtimeHealth.set(provider, {
    ...current,
    status: 'error',
    lastErrorAt: new Date().toISOString(),
    lastError: message.slice(0, 300),
  });
}

export function getProviderHealth(provider: ProviderId): MutableHealthState {
  return runtimeHealth.get(provider) || { status: 'unknown' };
}

export function toProviderHealthSnapshot(
  provider: ProviderId,
  implemented: boolean,
  operatorName: string,
): ProviderHealthSnapshot {
  const state = getProviderHealth(provider);
  return {
    provider,
    implemented,
    operatorName,
    status: implemented ? state.status : 'unsupported',
    lastSuccessAt: state.lastSuccessAt,
    lastErrorAt: state.lastErrorAt,
    lastError: state.lastError,
  };
}
