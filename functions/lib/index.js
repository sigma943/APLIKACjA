"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearAdminLogs = exports.unblockDevice = exports.blockDevice = exports.setOperatorRole = exports.rollbackMaintenanceEndpoint = exports.disableMaintenanceEndpoint = exports.setActiveMaintenanceEndpoint = exports.testMaintenanceEndpoint = exports.saveMaintenanceEndpoint = exports.transportApi = exports.transportGateway = exports.einfoProxyGet = exports.listDevicesForAdmin = exports.registerDeviceIdentity = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const service_1 = require("./transport/service");
const route_geometry_1 = require("./transport/route-geometry");
(0, app_1.initializeApp)();
const db = (0, firestore_1.getFirestore)();
const requireAuth = (uid) => {
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Auth required.');
    }
    return uid;
};
const getCaller = async (uid) => {
    const callerSnap = await db.collection('devices').doc(uid).get();
    if (!callerSnap.exists) {
        throw new https_1.HttpsError('permission-denied', 'Caller device not registered.');
    }
    return callerSnap.data();
};
const canManageRoles = (caller) => caller.role === 'owner' ||
    (caller.role === 'admin' && caller.permissions?.canChangeRoles);
const canManageBans = (caller) => caller.role === 'owner' ||
    (caller.role === 'admin' && (caller.permissions?.canBan || caller.permissions?.ban));
const writeAudit = async (title, description, iconType, actorId) => {
    await db.collection('admin_logs').add({
        title,
        description,
        iconType,
        category: 'OPERATOR',
        actorId,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
};
const targetLabelForAudit = (id, data) => {
    const role = String(data?.role || 'user');
    const displayName = String(data?.displayName || '').trim();
    if ((role === 'owner' || role === 'admin') && displayName)
        return displayName.slice(0, 120);
    const info = String(data?.deviceInfo || '').trim();
    if (info) {
        const main = info.split(';')[0]?.trim() || info;
        return `${main} (${id.slice(0, 8)})`;
    }
    return `Urzadzenie (${id.slice(0, 8)})`;
};
const hasAnyTrue = (value, keys) => {
    if (!value || typeof value !== 'object')
        return false;
    const o = value;
    return keys.some((k) => o[k] === true);
};
const canReadDevicesList = (caller) => {
    if (caller?.role === 'owner')
        return true;
    if (caller?.role !== 'admin')
        return false;
    const perms = caller?.permissions;
    return hasAnyTrue(perms, ['monitor', 'canViewList']);
};
const canReadMaintenance = (caller) => {
    if (caller?.role === 'owner')
        return true;
    if (caller?.role !== 'admin')
        return false;
    return hasAnyTrue(caller?.permissions, ['globalSettings', 'globalSettingsEdit']);
};
const canWriteMaintenance = (caller) => {
    if (caller?.role === 'owner')
        return true;
    if (caller?.role !== 'admin')
        return false;
    return caller?.permissions?.globalSettingsEdit === true;
};
const PERMISSION_KEYS = [
    'monitor',
    'shield',
    'users',
    'group',
    'logs',
    'ban',
    'canChangeRoles',
    'disableMap',
    'disableStops',
    'globalSettings',
    'globalSettingsEdit',
    'canBan',
    'canViewList',
];
const permissionKeySet = new Set(PERMISSION_KEYS);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const assertValidDeviceId = (id) => {
    if (!id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid target device id.');
    }
};
const callerHasPermission = (caller, key) => {
    if (caller?.role === 'owner')
        return true;
    if (caller?.role !== 'admin' || !isPlainObject(caller?.permissions))
        return false;
    const perms = caller.permissions;
    if (key === 'canBan')
        return perms.canBan === true || perms.ban === true;
    if (key === 'canViewList')
        return perms.canViewList === true || perms.monitor === true;
    return perms[key] === true;
};
const sanitizePermissionsForRole = (requested, role, caller) => {
    if (requested != null && !isPlainObject(requested)) {
        throw new https_1.HttpsError('invalid-argument', 'permissions must be an object.');
    }
    const req = (requested || {});
    for (const key of Object.keys(req)) {
        if (!permissionKeySet.has(key) || typeof req[key] !== 'boolean') {
            throw new https_1.HttpsError('invalid-argument', `Invalid permission field: ${key}`);
        }
    }
    if (role === 'owner') {
        if (caller?.role !== 'owner') {
            throw new https_1.HttpsError('permission-denied', 'Only owner can assign owner role.');
        }
        return permissionsForRole('owner');
    }
    const base = permissionsForRole(role);
    if (role === 'user') {
        if (caller?.role === 'owner') {
            return {
                ...base,
                disableMap: req.disableMap === true,
                disableStops: req.disableMap === true ? false : req.disableStops === true,
            };
        }
        for (const key of Object.keys(req)) {
            if (req[key] === true) {
                throw new https_1.HttpsError('permission-denied', 'Admin cannot grant user restrictions or elevated permissions.');
            }
        }
        return base;
    }
    const result = {
        ...base,
        monitor: true,
        canViewList: true,
        disableMap: false,
        disableStops: false,
    };
    for (const key of PERMISSION_KEYS) {
        if (key === 'monitor' || key === 'canViewList' || key === 'disableMap' || key === 'disableStops')
            continue;
        if (typeof req[key] !== 'boolean')
            continue;
        if (caller?.role !== 'owner' && req[key] === true && !callerHasPermission(caller, key)) {
            throw new https_1.HttpsError('permission-denied', `Cannot grant permission above caller rights: ${key}`);
        }
        result[key] = req[key] === true;
    }
    result.canBan = result.ban || result.canBan;
    return result;
};
const sanitizeDisplayName = (raw) => {
    if (raw == null)
        return null;
    if (typeof raw !== 'string')
        throw new https_1.HttpsError('invalid-argument', 'displayName must be a string.');
    const value = raw.trim().slice(0, 120);
    return value || null;
};
const normalizeInstallationId = (raw) => {
    const v = String(raw || '').trim().slice(0, 128);
    if (!v)
        return '';
    return v.replace(/[^a-zA-Z0-9_-]/g, '');
};
const normalizeDeviceInfo = (raw) => String(raw || '').trim().slice(0, 200);
const blockedInstallationRef = (installationId) => db.collection('blocked_installations').doc(installationId);
const normalizeStoredRole = (value) => {
    return value === 'owner' || value === 'admin' || value === 'user' ? value : null;
};
const normalizeStoredStatus = (value) => {
    return value === 'active' || value === 'banned' ? value : null;
};
const permissionsFromStoredProfile = (permissions, role) => {
    return isPlainObject(permissions) ? { ...permissionsForRole(role), ...permissions } : permissionsForRole(role);
};
const permissionsForRole = (role) => {
    if (role === 'owner') {
        return {
            monitor: true,
            shield: true,
            users: true,
            group: true,
            logs: true,
            ban: true,
            canChangeRoles: true,
            disableMap: false,
            disableStops: false,
            globalSettings: true,
            globalSettingsEdit: true,
            canBan: true,
            canViewList: true,
        };
    }
    if (role === 'admin') {
        return {
            monitor: true,
            shield: false,
            users: false,
            group: false,
            logs: false,
            ban: true,
            canChangeRoles: false,
            disableMap: false,
            disableStops: false,
            globalSettings: false,
            globalSettingsEdit: false,
            canBan: true,
            canViewList: true,
        };
    }
    return {
        monitor: false,
        shield: false,
        users: false,
        group: false,
        logs: false,
        ban: false,
        canChangeRoles: false,
        disableMap: false,
        disableStops: false,
        globalSettings: false,
        globalSettingsEdit: false,
        canBan: false,
        canViewList: false,
    };
};
const isAllFalsePermissions = (value) => {
    if (!value || typeof value !== 'object')
        return true;
    const keys = [
        'monitor',
        'shield',
        'users',
        'group',
        'logs',
        'ban',
        'globalSettings',
        'globalSettingsEdit',
        'canBan',
        'canViewList',
        'canChangeRoles',
    ];
    return keys.every((k) => value[k] !== true);
};
const toHttpsError = (err, fallbackMessage) => {
    if (err instanceof https_1.HttpsError)
        return err;
    const message = err instanceof Error ? err.message : String(err);
    return new https_1.HttpsError('internal', `${fallbackMessage}: ${message}`);
};
const toClientDeviceItem = (id, data) => {
    const lastSeenMs = typeof data.lastSeenAt?.toMillis === 'function'
        ? data.lastSeenAt.toMillis()
        : typeof data.lastSeenAt?._seconds === 'number'
            ? data.lastSeenAt._seconds * 1000
            : null;
    return {
        id,
        deviceInfo: typeof data.deviceInfo === 'string' ? data.deviceInfo : '',
        displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
        role: (data.role || 'user'),
        firstLogin: typeof data.firstLogin === 'string' ? data.firstLogin : '',
        status: data.status === 'banned' ? 'banned' : 'active',
        permissions: data.permissions && typeof data.permissions === 'object' ? data.permissions : {},
        banDetails: data.banDetails && typeof data.banDetails === 'object' ? data.banDetails : undefined,
        installationId: typeof data.installationId === 'string' ? data.installationId : undefined,
        identityVersion: typeof data.identityVersion === 'number' ? data.identityVersion : undefined,
        lastSeenAtMs: lastSeenMs,
    };
};
exports.registerDeviceIdentity = (0, https_1.onCall)(async (request) => {
    try {
        const uid = requireAuth(request.auth?.uid);
        const requestedInstallationId = normalizeInstallationId(request.data?.installationId);
        const deviceInfo = normalizeDeviceInfo(request.data?.deviceInfo);
        if (!requestedInstallationId) {
            throw new https_1.HttpsError('invalid-argument', 'installationId is required.');
        }
        const alternateInstallationId = requestedInstallationId.startsWith('android_')
            ? normalizeInstallationId(requestedInstallationId.slice('android_'.length))
            : normalizeInstallationId(`android_${requestedInstallationId}`);
        const deviceRef = db.collection('devices').doc(uid);
        const now = firestore_1.FieldValue.serverTimestamp();
        const requestedInstallationRef = db.collection('installations').doc(requestedInstallationId);
        const alternateInstallationRef = alternateInstallationId && alternateInstallationId !== requestedInstallationId
            ? db.collection('installations').doc(alternateInstallationId)
            : null;
        const [existingSnap, requestedBlockedSnap, alternateBlockedSnap, requestedInstallationSnap, alternateInstallationSnap] = await Promise.all([
            deviceRef.get(),
            blockedInstallationRef(requestedInstallationId).get(),
            alternateInstallationId && alternateInstallationId !== requestedInstallationId
                ? blockedInstallationRef(alternateInstallationId).get()
                : Promise.resolve(null),
            requestedInstallationRef.get(),
            alternateInstallationRef ? alternateInstallationRef.get() : Promise.resolve(null),
        ]);
        const installationSnap = requestedInstallationSnap.exists
            ? requestedInstallationSnap
            : (alternateInstallationSnap && alternateInstallationSnap.exists ? alternateInstallationSnap : requestedInstallationSnap);
        const installationId = installationSnap.exists ? installationSnap.id : requestedInstallationId;
        const installationRef = db.collection('installations').doc(installationId);
        const blockedSnap = blockedInstallationRef(installationId).id === requestedInstallationId
            ? requestedBlockedSnap
            : (alternateBlockedSnap && alternateBlockedSnap.exists ? alternateBlockedSnap : requestedBlockedSnap);
        const blocked = blockedSnap.exists ? blockedSnap.data() : null;
        const isBlocked = blocked?.active === true;
        const status = isBlocked ? 'banned' : 'active';
        const patch = {
            installationId,
            identityVersion: 2,
            deviceInfo,
            lastSeenAt: now,
            status,
            updatedAt: now,
        };
        const installation = installationSnap.exists ? installationSnap.data() : null;
        const lastUid = String(installation?.lastUid || '').trim();
        let previousUidToDeduplicate = '';
        const installationRole = normalizeStoredRole(installation?.role);
        const installationStatus = normalizeStoredStatus(installation?.status);
        // If UID changed (e.g. reinstall / cleared data), inherit role and remove the old row
        // so the admin device list does not show duplicate entries for the same physical device.
        if (!existingSnap.exists && lastUid && lastUid !== uid) {
            const prevSnap = await db.collection('devices').doc(lastUid).get();
            if (prevSnap.exists) {
                const prev = prevSnap.data();
                const prevInstallationId = normalizeInstallationId(prev?.installationId);
                if (prevInstallationId === installationId) {
                    previousUidToDeduplicate = lastUid;
                    const prevRole = (prev?.role || 'user');
                    const prevStatus = prev?.status === 'banned' ? 'banned' : 'active';
                    patch.role = prevRole;
                    patch.permissions = prev?.permissions && typeof prev.permissions === 'object'
                        ? prev.permissions
                        : permissionsForRole(prevRole);
                    patch.verified = prevRole === 'owner' || prevRole === 'admin' || prev?.verified === true;
                    if (!isBlocked)
                        patch.status = prevStatus;
                    if (prevStatus === 'banned' && prev?.banDetails && typeof prev.banDetails === 'object') {
                        patch.banDetails = prev.banDetails;
                    }
                    if (typeof prev.displayName === 'string' && prev.displayName.trim()) {
                        patch.displayName = prev.displayName.trim().slice(0, 120);
                    }
                    if (typeof prev.deviceName === 'string' && prev.deviceName.trim()) {
                        patch.deviceName = prev.deviceName.trim().slice(0, 120);
                    }
                }
            }
        }
        // Fallback for Android reinstalls where installationId changed:
        // restore identity only for previously privileged devices (owner/admin)
        // matched by normalized deviceInfo. Never promote plain user this way.
        if (!existingSnap.exists && !('role' in patch) && deviceInfo) {
            const sameInfoSnap = await db
                .collection('devices')
                .where('deviceInfo', '==', deviceInfo)
                .limit(20)
                .get();
            let privilegedCandidate = null;
            for (const docSnap of sameInfoSnap.docs) {
                const candidateUid = docSnap.id;
                if (!candidateUid || candidateUid === uid)
                    continue;
                const candidate = docSnap.data();
                const candidateRole = normalizeStoredRole(candidate?.role);
                if (candidateRole !== 'owner' && candidateRole !== 'admin')
                    continue;
                const lastSeenMs = typeof candidate?.lastSeenAt?.toMillis === 'function'
                    ? candidate.lastSeenAt.toMillis()
                    : typeof candidate?.lastSeenAt?._seconds === 'number'
                        ? candidate.lastSeenAt._seconds * 1000
                        : 0;
                const candidateStatus = candidate?.status === 'banned' ? 'banned' : 'active';
                const nextCandidate = {
                    uid: candidateUid,
                    role: candidateRole,
                    status: candidateStatus,
                    permissions: candidate?.permissions && typeof candidate.permissions === 'object'
                        ? candidate.permissions
                        : permissionsForRole(candidateRole),
                    verified: true,
                    lastSeenMs,
                    banDetails: candidate?.banDetails,
                    displayName: typeof candidate?.displayName === 'string' ? candidate.displayName : undefined,
                    deviceName: typeof candidate?.deviceName === 'string' ? candidate.deviceName : undefined,
                };
                if (!privilegedCandidate ||
                    (candidateRole === 'owner' && privilegedCandidate.role !== 'owner') ||
                    (candidateRole === privilegedCandidate.role && lastSeenMs >= privilegedCandidate.lastSeenMs)) {
                    privilegedCandidate = nextCandidate;
                }
            }
            if (privilegedCandidate) {
                previousUidToDeduplicate = privilegedCandidate.uid;
                patch.role = privilegedCandidate.role;
                patch.permissions = privilegedCandidate.permissions;
                patch.verified = privilegedCandidate.verified;
                if (!isBlocked)
                    patch.status = privilegedCandidate.status;
                if (privilegedCandidate.status === 'banned' && isPlainObject(privilegedCandidate.banDetails)) {
                    patch.banDetails = privilegedCandidate.banDetails;
                }
                if (typeof privilegedCandidate.displayName === 'string' && privilegedCandidate.displayName.trim()) {
                    patch.displayName = privilegedCandidate.displayName.trim().slice(0, 120);
                }
                if (typeof privilegedCandidate.deviceName === 'string' && privilegedCandidate.deviceName.trim()) {
                    patch.deviceName = privilegedCandidate.deviceName.trim().slice(0, 120);
                }
            }
        }
        if (!existingSnap.exists) {
            if (!('role' in patch) && installationRole) {
                patch.role = installationRole;
                patch.permissions = permissionsFromStoredProfile(installation?.permissions, installationRole);
                patch.verified = installationRole === 'owner' || installationRole === 'admin' || installation?.verified === true;
                if (!isBlocked)
                    patch.status = installationStatus || 'active';
                if (installationStatus === 'banned' && isPlainObject(installation?.banDetails)) {
                    patch.banDetails = installation.banDetails;
                }
                if (typeof installation?.displayName === 'string' && installation.displayName.trim()) {
                    patch.displayName = installation.displayName.trim().slice(0, 120);
                }
                if (typeof installation?.deviceName === 'string' && installation.deviceName.trim()) {
                    patch.deviceName = installation.deviceName.trim().slice(0, 120);
                }
            }
            if (!('role' in patch))
                patch.role = 'user';
            patch.firstLogin = new Date().toISOString();
            if (!('permissions' in patch))
                patch.permissions = permissionsForRole(patch.role);
        }
        else {
            const existing = existingSnap.data();
            const existingRole = normalizeStoredRole(existing?.role) || 'user';
            const existingStatus = existing?.status === 'banned' ? 'banned' : 'active';
            patch.role = existingRole;
            patch.permissions = existing?.permissions && typeof existing.permissions === 'object'
                ? existing.permissions
                : permissionsForRole(existingRole);
            if (!isBlocked)
                patch.status = existingStatus;
            if (existingStatus === 'banned' && existing?.banDetails && typeof existing.banDetails === 'object') {
                patch.banDetails = existing.banDetails;
            }
            patch.verified = existingRole === 'owner' || existingRole === 'admin' || existing?.verified === true;
            if (typeof existing?.displayName === 'string' && existing.displayName.trim()) {
                patch.displayName = existing.displayName.trim().slice(0, 120);
            }
            if (typeof existing?.deviceName === 'string' && existing.deviceName.trim()) {
                patch.deviceName = existing.deviceName.trim().slice(0, 120);
            }
            if ((existingRole === 'admin' || existingRole === 'owner') &&
                isAllFalsePermissions(existing?.permissions)) {
                patch.permissions = permissionsForRole(existingRole);
            }
        }
        if (isBlocked) {
            patch.banDetails = {
                reason: String(blocked?.reason || 'Blokada instalacji'),
                expiresAt: String(blocked?.expiresAt || ''),
                gifUrl: 'https://media.giphy.com/media/3oEjI67Egb8G9jqs3m/giphy.gif',
            };
        }
        await deviceRef.set(patch, { merge: true });
        if (previousUidToDeduplicate) {
            await db.collection('devices').doc(previousUidToDeduplicate).delete();
        }
        const installationPatch = {
            installationId,
            knownUids: firestore_1.FieldValue.arrayUnion(uid),
            lastUid: uid,
            lastSeenAt: now,
            updatedAt: now,
        };
        for (const key of ['role', 'permissions', 'status', 'verified', 'banDetails', 'displayName', 'deviceName']) {
            if (key in patch)
                installationPatch[key] = patch[key];
        }
        await installationRef.set(installationPatch, { merge: true });
        return {
            ok: true,
            installationId,
            status: String(patch.status || status),
            ...(previousUidToDeduplicate ? { dedupedPreviousUid: previousUidToDeduplicate } : {}),
        };
    }
    catch (err) {
        throw toHttpsError(err, 'registerDeviceIdentity failed');
    }
});
exports.listDevicesForAdmin = (0, https_1.onCall)(async (request) => {
    try {
        const uid = requireAuth(request.auth?.uid);
        const caller = await getCaller(uid);
        if (!canReadDevicesList(caller)) {
            throw new https_1.HttpsError('permission-denied', 'Insufficient permissions to list devices.');
        }
        const snap = await db.collection('devices').limit(500).get();
        const items = snap.docs.map((d) => toClientDeviceItem(d.id, d.data()));
        return { ok: true, items };
    }
    catch (err) {
        throw toHttpsError(err, 'listDevicesForAdmin failed');
    }
});
const UPSTREAM = 'http://einfo.zgpks.rzeszow.pl/api';
const UPSTREAM_HEADERS = {
    Accept: 'application/json',
    'Accept-Language': 'pl,en;q=0.9',
    Referer: 'http://einfo.zgpks.rzeszow.pl/',
    Origin: 'http://einfo.zgpks.rzeszow.pl',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};
exports.einfoProxyGet = (0, https_1.onCall)(async (request) => {
    const path = String(request.data?.path || '').replace(/^\//, '');
    const query = String(request.data?.query || '');
    if (!path)
        throw new https_1.HttpsError('invalid-argument', 'path is required');
    if (path.includes('..'))
        throw new https_1.HttpsError('invalid-argument', 'invalid path');
    const url = `${UPSTREAM}/${path}${query && query.startsWith('?') ? query : query ? `?${query}` : ''}`;
    const res = await fetch(url, { headers: UPSTREAM_HEADERS });
    const text = await res.text();
    if (!res.ok) {
        throw new https_1.HttpsError('unavailable', `Upstream ${res.status}: ${text.slice(0, 300)}`);
    }
    try {
        return { ok: true, data: JSON.parse(text) };
    }
    catch {
        throw new https_1.HttpsError('unavailable', `Invalid JSON: ${text.slice(0, 300)}`);
    }
});
const parseBooleanParam = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
};
const parseBboxParam = (value) => {
    const raw = String(value || '').trim();
    if (!raw)
        return null;
    const parts = raw.split(',').map((segment) => Number(segment.trim()));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)))
        return null;
    return [parts[0], parts[1], parts[2], parts[3]];
};
const DEFAULT_TRANSPORT_ENDPOINT_ID = 'default-transport-api';
const DEFAULT_TRANSPORT_API_URL = 'https://us-central1-aplikacja-b20fa.cloudfunctions.net/transportApi';
const MAINTENANCE_ENDPOINT_ROLES = new Set(['production', 'backup', 'staging', 'legacy', 'test']);
const cleanIdPart = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
const normalizeEndpointUrl = (value) => {
    const raw = String(value || '').trim().replace(/\/+$/, '');
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        throw new https_1.HttpsError('invalid-argument', 'Endpoint URL is invalid.');
    }
    if (parsed.protocol !== 'https:') {
        throw new https_1.HttpsError('invalid-argument', 'Endpoint URL must use HTTPS.');
    }
    return parsed.toString().replace(/\/+$/, '');
};
const endpointHealthUrl = (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/health/providers`;
const sanitizeMaintenanceEndpoint = (input, existing) => {
    const url = normalizeEndpointUrl(input.url ?? existing?.url ?? DEFAULT_TRANSPORT_API_URL);
    const role = String(input.role ?? existing?.role ?? 'production').trim().toLowerCase();
    if (!MAINTENANCE_ENDPOINT_ROLES.has(role)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid endpoint role.');
    }
    const priority = Number(input.priority ?? existing?.priority ?? 1);
    if (!Number.isFinite(priority) || priority < 1 || priority > 99) {
        throw new https_1.HttpsError('invalid-argument', 'Priority must be between 1 and 99.');
    }
    return {
        name: String(input.name ?? existing?.name ?? 'Główny (PROD)').trim().slice(0, 80) || 'Endpoint',
        url,
        role,
        priority: Math.round(priority),
        region: String(input.region ?? existing?.region ?? 'PL').trim().slice(0, 24) || 'PL',
        source: String(input.source ?? existing?.source ?? 'Firestore').trim().slice(0, 60) || 'Firestore',
        fallbackEnabled: Boolean(input.fallbackEnabled ?? existing?.fallbackEnabled ?? true),
        enabled: input.enabled == null ? Boolean(existing?.enabled ?? true) : Boolean(input.enabled),
    };
};
const testMaintenanceUrl = async (url) => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
        const res = await fetch(endpointHealthUrl(url), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        const latencyMs = Date.now() - startedAt;
        let providerCount = 0;
        try {
            const payload = await res.clone().json();
            if (payload && typeof payload === 'object') {
                providerCount = Object.keys(payload.providers || payload || {}).length;
            }
        }
        catch {
            providerCount = 0;
        }
        return {
            ok: res.ok,
            status: res.ok ? 'success' : 'error',
            statusCode: res.status,
            latencyMs,
            providerCount,
            testedAt: new Date().toISOString(),
            message: res.ok ? 'OK' : `HTTP ${res.status}`,
        };
    }
    catch (error) {
        return {
            ok: false,
            status: 'error',
            statusCode: 0,
            latencyMs: Date.now() - startedAt,
            providerCount: 0,
            testedAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
        };
    }
    finally {
        clearTimeout(timeout);
    }
};
const ensureDefaultMaintenanceEndpoint = async () => {
    const endpointRef = db.collection('maintenance_endpoints').doc(DEFAULT_TRANSPORT_ENDPOINT_ID);
    const settingsRef = db.collection('admin_settings').doc('maintenance');
    const [endpointSnap, settingsSnap] = await Promise.all([endpointRef.get(), settingsRef.get()]);
    if (!endpointSnap.exists) {
        await endpointRef.set({
            name: 'Główny (PROD)',
            url: DEFAULT_TRANSPORT_API_URL,
            role: 'production',
            priority: 1,
            region: 'PL',
            source: 'Firestore',
            fallbackEnabled: true,
            enabled: true,
            active: !settingsSnap.exists,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedBy: 'system',
        }, { merge: true });
    }
    if (!settingsSnap.exists || !String(settingsSnap.data()?.activeEndpointId || '').trim()) {
        await settingsRef.set({
            activeEndpointId: DEFAULT_TRANSPORT_ENDPOINT_ID,
            previousEndpointId: '',
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedBy: 'system',
        }, { merge: true });
    }
};
const writeMaintenanceChange = async (action, endpointId, actorId, summary, before, after) => {
    await db.collection('maintenance_changes').add({
        action,
        endpointId,
        actorId,
        summary,
        before: before ?? null,
        after: after ?? null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
};
const activeMaintenanceEndpoint = async () => {
    await ensureDefaultMaintenanceEndpoint();
    const settingsSnap = await db.collection('admin_settings').doc('maintenance').get();
    const activeEndpointId = String(settingsSnap.data()?.activeEndpointId || DEFAULT_TRANSPORT_ENDPOINT_ID);
    const endpointSnap = await db.collection('maintenance_endpoints').doc(activeEndpointId).get();
    const data = endpointSnap.exists ? endpointSnap.data() || {} : {};
    const url = String(data.url || DEFAULT_TRANSPORT_API_URL).trim().replace(/\/+$/, '');
    const enabled = data.enabled !== false;
    return enabled ? url : DEFAULT_TRANSPORT_API_URL;
};
const proxyTargetUrl = (baseUrl, request) => {
    const base = baseUrl.replace(/\/+$/, '');
    const path = String(request.path || '/');
    const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
    const url = `${base}${path}${query}`;
    if (url.startsWith('https://us-central1-aplikacja-b20fa.cloudfunctions.net/transportGateway')) {
        return `${DEFAULT_TRANSPORT_API_URL}${path}${query}`;
    }
    return url;
};
exports.transportGateway = (0, https_1.onRequest)({ cors: true, timeoutSeconds: 60 }, async (request, response) => {
    try {
        if (request.method === 'OPTIONS') {
            response.status(204).end();
            return;
        }
        if (request.method !== 'GET' && request.method !== 'POST') {
            response.status(405).json({ error: 'Method not allowed' });
            return;
        }
        const targetBase = await activeMaintenanceEndpoint();
        const target = proxyTargetUrl(targetBase, request);
        const headers = { Accept: 'application/json' };
        const contentType = request.get('content-type');
        if (contentType)
            headers['Content-Type'] = contentType;
        const upstream = await fetch(target, {
            method: request.method,
            headers,
            body: request.method === 'POST' ? JSON.stringify(request.body || {}) : undefined,
        });
        const text = await upstream.text();
        response.status(upstream.status);
        response.set('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
        response.send(text);
    }
    catch (error) {
        response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
exports.transportApi = (0, https_1.onRequest)({ cors: true, timeoutSeconds: 60 }, async (request, response) => {
    try {
        if (request.method === 'OPTIONS') {
            response.status(204).end();
            return;
        }
        if (request.method !== 'GET' && request.method !== 'POST') {
            response.status(405).json({ error: 'Method not allowed' });
            return;
        }
        const path = String(request.path || '/').replace(/\/+$/, '') || '/';
        if (path === '/' || path === '') {
            response.json({
                ok: true,
                endpoints: [
                    '/vehicles?providers=mpk_rzeszow,marcel,pkp_intercity',
                    '/vehicle/mpk_rzeszow/:vehicleId',
                    '/vehicle/marcel/:vehicleId',
                    '/vehicle/pkp_intercity/:vehicleId',
                    '/routes/geometry',
                    '/health/providers',
                ],
            });
            return;
        }
        if (path === '/routes/geometry') {
            let body = {};
            if (request.method === 'POST' && request.body) {
                if (typeof request.body === 'string') {
                    body = JSON.parse(request.body || '{}');
                }
                else if (typeof request.body === 'object') {
                    body = request.body;
                }
            }
            const stopsFromQuery = typeof request.query.stops === 'string'
                ? JSON.parse(request.query.stops)
                : undefined;
            const payload = {
                carrier: request.query.carrier ?? body.carrier ?? body.provider,
                line: request.query.line ?? body.line,
                direction: request.query.direction ?? body.direction,
                variant: request.query.variant ?? body.variant,
                dataVersion: request.query.dataVersion ?? body.dataVersion,
                mode: request.query.mode ?? body.mode,
                stops: stopsFromQuery ?? body.stops,
            };
            const route = await (0, route_geometry_1.resolveRouteGeometry)(payload);
            response.json(route);
            return;
        }
        if (path === '/vehicles') {
            const providers = String(request.query.providers || '')
                .split(',')
                .map((provider) => provider.trim())
                .filter(Boolean);
            const payload = await (0, service_1.fetchVehiclesForProviders)({
                providerIds: providers,
                includeInactive: parseBooleanParam(request.query.includeInactive),
                bbox: parseBboxParam(request.query.bbox),
            });
            response.json(payload);
            return;
        }
        if (path === '/health/providers') {
            response.json((0, service_1.getProvidersHealth)());
            return;
        }
        const vehicleMatch = path.match(/^\/vehicle\/([^/]+)\/([^/]+)$/);
        if (vehicleMatch) {
            const providerId = decodeURIComponent(vehicleMatch[1]);
            const vehicleId = decodeURIComponent(vehicleMatch[2]);
            const includeInactive = request.query.includeInactive == null ? true : parseBooleanParam(request.query.includeInactive);
            const vehicle = await (0, service_1.fetchVehicleDetails)(providerId, vehicleId, includeInactive);
            if (!vehicle) {
                response.status(404).json({ error: 'Vehicle not found' });
                return;
            }
            response.json({ vehicle });
            return;
        }
        response.status(404).json({ error: 'Not found' });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response.status(500).json({ error: message });
    }
});
exports.saveMaintenanceEndpoint = (0, https_1.onCall)(async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (!canWriteMaintenance(caller)) {
        throw new https_1.HttpsError('permission-denied', 'Insufficient permissions.');
    }
    await ensureDefaultMaintenanceEndpoint();
    const payload = (request.data?.endpoint || request.data || {});
    const explicitId = cleanIdPart(payload.id);
    const endpointId = explicitId || cleanIdPart(payload.name) || `endpoint-${Date.now()}`;
    const ref = db.collection('maintenance_endpoints').doc(endpointId);
    const beforeSnap = await ref.get();
    const before = beforeSnap.exists ? beforeSnap.data() : null;
    const endpoint = sanitizeMaintenanceEndpoint(payload, before || undefined);
    await ref.set({
        ...endpoint,
        active: Boolean(before?.active),
        createdAt: before?.createdAt || firestore_1.FieldValue.serverTimestamp(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedBy: uid,
    }, { merge: true });
    await writeMaintenanceChange('save', endpointId, uid, `Zapisano endpoint ${endpoint.name}`, before, endpoint);
    await writeAudit('Konserwacja: zapisano endpoint', `${endpoint.name} (${endpoint.url})`, 'edit_role', uid);
    return { ok: true, endpointId };
});
exports.testMaintenanceEndpoint = (0, https_1.onCall)(async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (!canReadMaintenance(caller)) {
        throw new https_1.HttpsError('permission-denied', 'Insufficient permissions.');
    }
    await ensureDefaultMaintenanceEndpoint();
    const endpointId = cleanIdPart(request.data?.endpointId);
    let url = request.data?.url ? normalizeEndpointUrl(request.data.url) : '';
    if (!url && endpointId) {
        const snap = await db.collection('maintenance_endpoints').doc(endpointId).get();
        if (!snap.exists)
            throw new https_1.HttpsError('not-found', 'Endpoint not found.');
        url = normalizeEndpointUrl(snap.data()?.url);
    }
    if (!url)
        throw new https_1.HttpsError('invalid-argument', 'Endpoint URL or endpointId is required.');
    const result = await testMaintenanceUrl(url);
    if (endpointId) {
        await db.collection('maintenance_endpoints').doc(endpointId).set({
            lastTest: result,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, { merge: true });
        await writeMaintenanceChange('test', endpointId, uid, `Test endpointu: ${result.status} ${result.latencyMs} ms`, null, result);
    }
    return { ok: true, result };
});
exports.setActiveMaintenanceEndpoint = (0, https_1.onCall)(async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (!canWriteMaintenance(caller)) {
        throw new https_1.HttpsError('permission-denied', 'Insufficient permissions.');
    }
    await ensureDefaultMaintenanceEndpoint();
    const endpointId = cleanIdPart(request.data?.endpointId);
    if (!endpointId)
        throw new https_1.HttpsError('invalid-argument', 'endpointId is required.');
    const endpointRef = db.collection('maintenance_endpoints').doc(endpointId);
    const endpointSnap = await endpointRef.get();
    if (!endpointSnap.exists)
        throw new https_1.HttpsError('not-found', 'Endpoint not found.');
    const endpoint = endpointSnap.data() || {};
    if (endpoint.enabled === false)
        throw new https_1.HttpsError('failed-precondition', 'Disabled endpoint cannot be active.');
    const settingsRef = db.collection('admin_settings').doc('maintenance');
    const settingsSnap = await settingsRef.get();
    const previousEndpointId = String(settingsSnap.data()?.activeEndpointId || '');
    const batch = db.batch();
    if (previousEndpointId) {
        batch.set(db.collection('maintenance_endpoints').doc(previousEndpointId), { active: false }, { merge: true });
    }
    batch.set(endpointRef, { active: true, updatedAt: firestore_1.FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
    batch.set(settingsRef, {
        activeEndpointId: endpointId,
        previousEndpointId: previousEndpointId && previousEndpointId !== endpointId ? previousEndpointId : String(settingsSnap.data()?.previousEndpointId || ''),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedBy: uid,
    }, { merge: true });
    await batch.commit();
    await writeMaintenanceChange('activate', endpointId, uid, `Ustawiono aktywny endpoint: ${endpoint.name || endpointId}`, { previousEndpointId }, endpoint);
    await writeAudit('Konserwacja: zmieniono aktywny endpoint', `${previousEndpointId || '-'} -> ${endpointId}`, 'edit_role', uid);
    return { ok: true };
});
exports.disableMaintenanceEndpoint = (0, https_1.onCall)(async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (!canWriteMaintenance(caller)) {
        throw new https_1.HttpsError('permission-denied', 'Insufficient permissions.');
    }
    await ensureDefaultMaintenanceEndpoint();
    const endpointId = cleanIdPart(request.data?.endpointId);
    if (!endpointId)
        throw new https_1.HttpsError('invalid-argument', 'endpointId is required.');
    const ref = db.collection('maintenance_endpoints').doc(endpointId);
    const snap = await ref.get();
    if (!snap.exists)
        throw new https_1.HttpsError('not-found', 'Endpoint not found.');
    const endpoint = snap.data() || {};
    if (endpoint.active === true) {
        throw new https_1.HttpsError('failed-precondition', 'Active endpoint cannot be disabled. Activate another endpoint first.');
    }
    await ref.set({ enabled: false, updatedAt: firestore_1.FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
    await writeMaintenanceChange('disable', endpointId, uid, `Wyłączono endpoint: ${endpoint.name || endpointId}`, endpoint, { enabled: false });
    await writeAudit('Konserwacja: wyłączono endpoint', `${endpoint.name || endpointId}`, 'edit_role', uid);
    return { ok: true };
});
exports.rollbackMaintenanceEndpoint = (0, https_1.onCall)(async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (!canWriteMaintenance(caller)) {
        throw new https_1.HttpsError('permission-denied', 'Insufficient permissions.');
    }
    await ensureDefaultMaintenanceEndpoint();
    const settingsRef = db.collection('admin_settings').doc('maintenance');
    const settingsSnap = await settingsRef.get();
    const activeEndpointId = String(settingsSnap.data()?.activeEndpointId || DEFAULT_TRANSPORT_ENDPOINT_ID);
    const previousEndpointId = String(settingsSnap.data()?.previousEndpointId || '').trim();
    if (!previousEndpointId) {
        throw new https_1.HttpsError('failed-precondition', 'No previous endpoint to rollback.');
    }
    const previousSnap = await db.collection('maintenance_endpoints').doc(previousEndpointId).get();
    if (!previousSnap.exists || previousSnap.data()?.enabled === false) {
        throw new https_1.HttpsError('failed-precondition', 'Previous endpoint is unavailable.');
    }
    const batch = db.batch();
    batch.set(db.collection('maintenance_endpoints').doc(activeEndpointId), { active: false }, { merge: true });
    batch.set(db.collection('maintenance_endpoints').doc(previousEndpointId), { active: true, updatedAt: firestore_1.FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
    batch.set(settingsRef, {
        activeEndpointId: previousEndpointId,
        previousEndpointId: activeEndpointId,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedBy: uid,
    }, { merge: true });
    await batch.commit();
    await writeMaintenanceChange('rollback', previousEndpointId, uid, `Rollback: ${activeEndpointId} -> ${previousEndpointId}`);
    await writeAudit('Konserwacja: rollback endpointu', `${activeEndpointId} -> ${previousEndpointId}`, 'edit_role', uid);
    return { ok: true };
});
exports.setOperatorRole = (0, https_1.onCall)(async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (!canManageRoles(caller)) {
        throw new https_1.HttpsError('permission-denied', 'Insufficient permissions.');
    }
    const targetDeviceId = String(request.data?.targetDeviceId || '');
    const role = request.data?.role;
    const requestedPermissions = request.data?.permissions || {};
    if (!targetDeviceId || !['owner', 'admin', 'user'].includes(role)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid role update payload.');
    }
    assertValidDeviceId(targetDeviceId);
    if (targetDeviceId === uid) {
        throw new https_1.HttpsError('permission-denied', 'Cannot change own role or permissions.');
    }
    const targetRef = db.collection('devices').doc(targetDeviceId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Target device not found.');
    }
    const target = targetSnap.data();
    if (caller.role !== 'owner' && target.role !== 'user') {
        throw new https_1.HttpsError('permission-denied', 'Only owner can manage owners and admins.');
    }
    if (caller.role !== 'owner' && role === 'owner') {
        throw new https_1.HttpsError('permission-denied', 'Admin cannot assign owner role.');
    }
    const permissions = sanitizePermissionsForRole(requestedPermissions, role, caller);
    const displayName = sanitizeDisplayName(request.data?.displayName);
    const patch = {
        role,
        permissions,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedBy: uid,
    };
    if (displayName)
        patch.displayName = displayName;
    await targetRef.set(patch, { merge: true });
    const installationId = normalizeInstallationId(target.installationId);
    if (installationId) {
        await db.collection('installations').doc(installationId).set({
            installationId,
            role,
            permissions,
            ...(displayName ? { displayName } : {}),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, { merge: true });
    }
    await writeAudit('Zmieniono role operatora', `${targetLabelForAudit(targetDeviceId, target)} -> ${role}`, 'role_change', uid);
    return { ok: true };
});
exports.blockDevice = (0, https_1.onCall)(async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (!canManageBans(caller)) {
        throw new https_1.HttpsError('permission-denied', 'Insufficient permissions.');
    }
    const targetDeviceId = String(request.data?.targetDeviceId || '');
    const reason = String(request.data?.reason || 'Naruszenie regulaminu').trim().slice(0, 300);
    const expiresAt = request.data?.expiresAt ? String(request.data.expiresAt) : '';
    if (!targetDeviceId) {
        throw new https_1.HttpsError('invalid-argument', 'targetDeviceId is required.');
    }
    assertValidDeviceId(targetDeviceId);
    if (targetDeviceId === uid) {
        throw new https_1.HttpsError('permission-denied', 'Cannot ban own device.');
    }
    if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid expiresAt.');
    }
    const targetRef = db.collection('devices').doc(targetDeviceId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Target device not found.');
    }
    const target = targetSnap.data();
    if (caller.role !== 'owner' && target.role !== 'user') {
        throw new https_1.HttpsError('permission-denied', 'Only owner can ban owners and admins.');
    }
    const targetLabel = targetLabelForAudit(targetDeviceId, target);
    const installationId = normalizeInstallationId(target.installationId);
    const gifUrl = typeof request.data?.gifUrl === 'string' ? request.data.gifUrl.trim().slice(0, 500) : '';
    const silent = request.data?.silent === true;
    if (target.status === 'banned') {
        if (installationId) {
            await blockedInstallationRef(installationId).set({
                active: true,
                reason,
                expiresAt,
                gifUrl,
                silent,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
                updatedBy: uid,
            }, { merge: true });
        }
        return { ok: true, alreadyBanned: true };
    }
    await targetRef.set({
        status: 'banned',
        banDetails: {
            reason,
            expiresAt,
            gifUrl,
            silent,
            bannedAt: new Date().toISOString(),
        },
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedBy: uid,
    }, { merge: true });
    if (installationId) {
        await blockedInstallationRef(installationId).set({
            active: true,
            reason,
            expiresAt,
            gifUrl,
            silent,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, { merge: true });
    }
    await writeAudit('Nadano bana urzadzeniu', `${targetLabel}. Powod: ${reason}`, 'ban', uid);
    return { ok: true };
});
exports.unblockDevice = (0, https_1.onCall)(async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (!canManageBans(caller)) {
        throw new https_1.HttpsError('permission-denied', 'Insufficient permissions.');
    }
    const targetDeviceId = String(request.data?.targetDeviceId || '');
    if (!targetDeviceId) {
        throw new https_1.HttpsError('invalid-argument', 'targetDeviceId is required.');
    }
    assertValidDeviceId(targetDeviceId);
    if (targetDeviceId === uid) {
        throw new https_1.HttpsError('permission-denied', 'Cannot unblock own device.');
    }
    const targetRef = db.collection('devices').doc(targetDeviceId);
    const targetSnap = await targetRef.get();
    if (!targetSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Target device not found.');
    }
    const target = targetSnap.data();
    if (caller.role !== 'owner' && target.role !== 'user') {
        throw new https_1.HttpsError('permission-denied', 'Only owner can unblock owners and admins.');
    }
    const targetLabel = targetLabelForAudit(targetDeviceId, target);
    const installationId = normalizeInstallationId(target.installationId);
    await targetRef.set({
        status: 'active',
        banDetails: firestore_1.FieldValue.delete(),
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
        updatedBy: uid,
    }, { merge: true });
    if (installationId) {
        await blockedInstallationRef(installationId).set({
            active: false,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedBy: uid,
        }, { merge: true });
    }
    await writeAudit('Zdjeto blokade urzadzenia', `Odblokowano: ${targetLabel}`, 'edit_role', uid);
    return { ok: true };
});
exports.clearAdminLogs = (0, https_1.onCall)(async (request) => {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (caller.role !== 'owner') {
        throw new https_1.HttpsError('permission-denied', 'Only owner can clear logs.');
    }
    let deleted = 0;
    for (;;) {
        const snap = await db.collection('admin_logs').limit(400).get();
        if (snap.empty)
            break;
        const batch = db.batch();
        snap.docs.forEach((logDoc) => batch.delete(logDoc.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < 400)
            break;
    }
    return { ok: true, deleted };
});
