"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markProviderSuccess = markProviderSuccess;
exports.markProviderError = markProviderError;
exports.getProviderHealth = getProviderHealth;
exports.toProviderHealthSnapshot = toProviderHealthSnapshot;
const runtimeHealth = new Map();
function markProviderSuccess(provider, status = 'ok') {
    const current = runtimeHealth.get(provider) || { status: 'unknown' };
    runtimeHealth.set(provider, {
        ...current,
        status,
        lastSuccessAt: new Date().toISOString(),
        lastError: status === 'ok' ? undefined : current.lastError,
    });
}
function markProviderError(provider, error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = runtimeHealth.get(provider) || { status: 'unknown' };
    runtimeHealth.set(provider, {
        ...current,
        status: 'error',
        lastErrorAt: new Date().toISOString(),
        lastError: message.slice(0, 300),
    });
}
function getProviderHealth(provider) {
    return runtimeHealth.get(provider) || { status: 'unknown' };
}
function toProviderHealthSnapshot(provider, implemented, operatorName) {
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
