"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRequestedProviderEntries = getRequestedProviderEntries;
exports.getProviderById = getProviderById;
exports.getProviderHealthSnapshots = getProviderHealthSnapshots;
const mpk_rzeszow_provider_1 = require("./mpk-rzeszow-provider");
const marcel_provider_1 = require("./marcel-provider");
const pkp_intercity_provider_1 = require("./pkp-intercity-provider");
const provider_health_1 = require("./provider-health");
const providerRegistry = [
    { id: 'mpk_rzeszow', operatorName: 'MPK Rzeszów', implemented: true, provider: mpk_rzeszow_provider_1.mpkRzeszowProvider },
    { id: 'marcel', operatorName: 'Marcel', implemented: true, provider: marcel_provider_1.marcelProvider },
    { id: 'pkp_intercity', operatorName: 'PKP Intercity', implemented: true, provider: pkp_intercity_provider_1.pkpIntercityProvider },
];
function getRequestedProviderEntries(requestedProviderIds) {
    const normalizedRequested = requestedProviderIds
        .map((providerId) => String(providerId || '').trim())
        .filter(Boolean);
    const effectiveRequested = normalizedRequested.length > 0 ? normalizedRequested : ['mpk_rzeszow'];
    const requestedSet = new Set(effectiveRequested);
    return providerRegistry.filter((entry) => requestedSet.has(entry.id));
}
function getProviderById(providerId) {
    return providerRegistry.find((entry) => entry.id === providerId);
}
function getProviderHealthSnapshots() {
    return providerRegistry.map((entry) => (0, provider_health_1.toProviderHealthSnapshot)(entry.id, entry.implemented, entry.operatorName));
}
