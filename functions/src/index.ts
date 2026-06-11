import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { fetchVehicleDetails, fetchVehiclesForProviders, getProvidersHealth } from './transport/service';
import { resolveRouteGeometry } from './transport/route-geometry';

initializeApp();
const db = getFirestore();

type DeviceRole = 'owner' | 'admin' | 'user';
type DeviceStatus = 'active' | 'banned';
type DevicePermissions = {
  monitor: boolean;
  shield: boolean;
  users: boolean;
  group: boolean;
  logs: boolean;
  ban: boolean;
  canChangeRoles: boolean;
  disableMap: boolean;
  disableStops: boolean;
  globalSettings: boolean;
  globalSettingsEdit: boolean;
  canBan: boolean;
  canViewList: boolean;
};

const requireAuth = (uid?: string) => {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Auth required.');
  }
  return uid;
};

const getCaller = async (uid: string) => {
  const callerSnap = await db.collection('devices').doc(uid).get();
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'Caller device not registered.');
  }
  return callerSnap.data() as any;
};

const canManageRoles = (caller: any) =>
  caller.role === 'owner' ||
  (caller.role === 'admin' && caller.permissions?.canChangeRoles);

const canManageBans = (caller: any) =>
  caller.role === 'owner' ||
  (caller.role === 'admin' && (caller.permissions?.canBan || caller.permissions?.ban));

const writeAudit = async (title: string, description: string, iconType: string, actorId: string) => {
  await db.collection('admin_logs').add({
    title,
    description,
    iconType,
    category: 'OPERATOR',
    actorId,
    createdAt: FieldValue.serverTimestamp(),
  });
};

const targetLabelForAudit = (id: string, data: any): string => {
  const role = String(data?.role || 'user');
  const displayName = String(data?.displayName || '').trim();
  if ((role === 'owner' || role === 'admin') && displayName) return displayName.slice(0, 120);
  const info = String(data?.deviceInfo || '').trim();
  if (info) {
    const main = info.split(';')[0]?.trim() || info;
    return `${main} (${id.slice(0, 8)})`;
  }
  return `Urzadzenie (${id.slice(0, 8)})`;
};

const hasAnyTrue = (value: unknown, keys: string[]): boolean => {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return keys.some((k) => o[k] === true);
};

const canReadDevicesList = (caller: any): boolean => {
  if (caller?.role === 'owner') return true;
  if (caller?.role !== 'admin') return false;
  const perms = caller?.permissions;
  return hasAnyTrue(perms, ['monitor', 'canViewList']);
};

const canReadMaintenance = (caller: any): boolean => {
  if (caller?.role === 'owner') return true;
  if (caller?.role !== 'admin') return false;
  return hasAnyTrue(caller?.permissions, ['globalSettings', 'globalSettingsEdit']);
};

const canWriteMaintenance = (caller: any): boolean => {
  if (caller?.role === 'owner') return true;
  if (caller?.role !== 'admin') return false;
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
] as const;

const permissionKeySet = new Set<string>(PERMISSION_KEYS);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertValidDeviceId = (id: string) => {
  if (!id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new HttpsError('invalid-argument', 'Invalid target device id.');
  }
};

const callerHasPermission = (caller: any, key: string): boolean => {
  if (caller?.role === 'owner') return true;
  if (caller?.role !== 'admin' || !isPlainObject(caller?.permissions)) return false;
  const perms = caller.permissions as Record<string, unknown>;
  if (key === 'canBan') return perms.canBan === true || perms.ban === true;
  if (key === 'canViewList') return perms.canViewList === true || perms.monitor === true;
  return perms[key] === true;
};

const sanitizePermissionsForRole = (
  requested: unknown,
  role: DeviceRole,
  caller: any,
): DevicePermissions => {
  if (requested != null && !isPlainObject(requested)) {
    throw new HttpsError('invalid-argument', 'permissions must be an object.');
  }

  const req = (requested || {}) as Record<string, unknown>;
  for (const key of Object.keys(req)) {
    if (!permissionKeySet.has(key) || typeof req[key] !== 'boolean') {
      throw new HttpsError('invalid-argument', `Invalid permission field: ${key}`);
    }
  }

  if (role === 'owner') {
    if (caller?.role !== 'owner') {
      throw new HttpsError('permission-denied', 'Only owner can assign owner role.');
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
        throw new HttpsError('permission-denied', 'Admin cannot grant user restrictions or elevated permissions.');
      }
    }
    return base;
  }

  const result: DevicePermissions = {
    ...base,
    monitor: true,
    canViewList: true,
    disableMap: false,
    disableStops: false,
  };

  for (const key of PERMISSION_KEYS) {
    if (key === 'monitor' || key === 'canViewList' || key === 'disableMap' || key === 'disableStops') continue;
    if (typeof req[key] !== 'boolean') continue;
    if (caller?.role !== 'owner' && req[key] === true && !callerHasPermission(caller, key)) {
      throw new HttpsError('permission-denied', `Cannot grant permission above caller rights: ${key}`);
    }
    (result as unknown as Record<string, boolean>)[key] = req[key] === true;
  }

  result.canBan = result.ban || result.canBan;
  return result;
};

const sanitizeDisplayName = (raw: unknown): string | null => {
  if (raw == null) return null;
  if (typeof raw !== 'string') throw new HttpsError('invalid-argument', 'displayName must be a string.');
  const value = raw.trim().slice(0, 120);
  return value || null;
};

const normalizeInstallationId = (raw: unknown): string => {
  const v = String(raw || '').trim().slice(0, 128);
  if (!v) return '';
  return v.replace(/[^a-zA-Z0-9_-]/g, '');
};

const normalizeDeviceInfo = (raw: unknown): string => String(raw || '').trim().slice(0, 200);

const blockedInstallationRef = (installationId: string) =>
  db.collection('blocked_installations').doc(installationId);

const normalizeStoredRole = (value: unknown): DeviceRole | null => {
  return value === 'owner' || value === 'admin' || value === 'user' ? value : null;
};

const normalizeStoredStatus = (value: unknown): DeviceStatus | null => {
  return value === 'active' || value === 'banned' ? value : null;
};

const permissionsFromStoredProfile = (permissions: unknown, role: DeviceRole): DevicePermissions => {
  return isPlainObject(permissions) ? { ...permissionsForRole(role), ...permissions } : permissionsForRole(role);
};

const permissionsForRole = (role: DeviceRole): DevicePermissions => {
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

const isAllFalsePermissions = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return true;
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
  ] as const;
  return keys.every((k) => (value as Record<string, unknown>)[k] !== true);
};

const toHttpsError = (err: unknown, fallbackMessage: string): HttpsError => {
  if (err instanceof HttpsError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new HttpsError('internal', `${fallbackMessage}: ${message}`);
};

const toClientDeviceItem = (id: string, data: any) => {
  const lastSeenMs =
    typeof data.lastSeenAt?.toMillis === 'function'
      ? data.lastSeenAt.toMillis()
      : typeof data.lastSeenAt?._seconds === 'number'
        ? data.lastSeenAt._seconds * 1000
        : null;

  return {
    id,
    deviceInfo: typeof data.deviceInfo === 'string' ? data.deviceInfo : '',
    displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
    role: (data.role || 'user') as DeviceRole,
    firstLogin: typeof data.firstLogin === 'string' ? data.firstLogin : '',
    status: data.status === 'banned' ? 'banned' : 'active',
    permissions: data.permissions && typeof data.permissions === 'object' ? data.permissions : {},
    banDetails: data.banDetails && typeof data.banDetails === 'object' ? data.banDetails : undefined,
    installationId: typeof data.installationId === 'string' ? data.installationId : undefined,
    identityVersion: typeof data.identityVersion === 'number' ? data.identityVersion : undefined,
    lastSeenAtMs: lastSeenMs,
  };
};

export const registerDeviceIdentity = onCall(async (request) => {
  try {
    const uid = requireAuth(request.auth?.uid);
    const requestedInstallationId = normalizeInstallationId(request.data?.installationId);
    const deviceInfo = normalizeDeviceInfo(request.data?.deviceInfo);

    if (!requestedInstallationId) {
      throw new HttpsError('invalid-argument', 'installationId is required.');
    }

    const alternateInstallationId = requestedInstallationId.startsWith('android_')
      ? normalizeInstallationId(requestedInstallationId.slice('android_'.length))
      : normalizeInstallationId(`android_${requestedInstallationId}`);

    const deviceRef = db.collection('devices').doc(uid);
    const now = FieldValue.serverTimestamp();

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
    const blocked = blockedSnap.exists ? blockedSnap.data() as any : null;
    const isBlocked = blocked?.active === true;
    const status: DeviceStatus = isBlocked ? 'banned' : 'active';
    const patch: Record<string, unknown> = {
      installationId,
      identityVersion: 2,
      deviceInfo,
      lastSeenAt: now,
      status,
      updatedAt: now,
    };

    const installation = installationSnap.exists ? (installationSnap.data() as any) : null;
    const lastUid = String(installation?.lastUid || '').trim();
    let previousUidToDeduplicate = '';
    const installationRole = normalizeStoredRole(installation?.role);
    const installationStatus = normalizeStoredStatus(installation?.status);

    // If UID changed (e.g. reinstall / cleared data), inherit role and remove the old row
    // so the admin device list does not show duplicate entries for the same physical device.
    if (!existingSnap.exists && lastUid && lastUid !== uid) {
      const prevSnap = await db.collection('devices').doc(lastUid).get();
      if (prevSnap.exists) {
        const prev = prevSnap.data() as any;
        const prevInstallationId = normalizeInstallationId(prev?.installationId);
        if (prevInstallationId === installationId) {
          previousUidToDeduplicate = lastUid;
          const prevRole = (prev?.role || 'user') as DeviceRole;
          const prevStatus: DeviceStatus = prev?.status === 'banned' ? 'banned' : 'active';
          patch.role = prevRole;
          patch.permissions = prev?.permissions && typeof prev.permissions === 'object'
            ? prev.permissions
            : permissionsForRole(prevRole);
          patch.verified = prevRole === 'owner' || prevRole === 'admin' || prev?.verified === true;
          if (!isBlocked) patch.status = prevStatus;
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

    // Fallback for Android reinstalls where local web storage or Firebase UID changed:
    // restore the previous row matched by the same normalized native device info.
    // The normal path above still prefers the stable installationId; this is only a
    // recovery path for already-known devices that lost that local identity.
    if (!existingSnap.exists && !('role' in patch) && deviceInfo) {
      const sameInfoSnap = await db
        .collection('devices')
        .where('deviceInfo', '==', deviceInfo)
        .limit(20)
        .get();

      let deviceInfoCandidate:
        | { uid: string; role: DeviceRole; status: DeviceStatus; permissions: DevicePermissions; verified: boolean; lastSeenMs: number; banDetails?: unknown; displayName?: string; deviceName?: string }
        | null = null;

      const roleRank = (role: DeviceRole) => (role === 'owner' ? 3 : role === 'admin' ? 2 : 1);

      for (const docSnap of sameInfoSnap.docs) {
        const candidateUid = docSnap.id;
        if (!candidateUid || candidateUid === uid) continue;
        const candidate = docSnap.data() as any;
        const candidateRole = normalizeStoredRole(candidate?.role);
        if (!candidateRole) continue;

        const lastSeenMs =
          typeof candidate?.lastSeenAt?.toMillis === 'function'
            ? candidate.lastSeenAt.toMillis()
            : typeof candidate?.lastSeenAt?._seconds === 'number'
              ? candidate.lastSeenAt._seconds * 1000
              : 0;
        const candidateStatus: DeviceStatus = candidate?.status === 'banned' ? 'banned' : 'active';
        const nextCandidate = {
          uid: candidateUid,
          role: candidateRole,
          status: candidateStatus,
          permissions: candidate?.permissions && typeof candidate.permissions === 'object'
            ? candidate.permissions
            : permissionsForRole(candidateRole),
          verified: candidateRole === 'owner' || candidateRole === 'admin' || candidate?.verified === true,
          lastSeenMs,
          banDetails: candidate?.banDetails,
          displayName: typeof candidate?.displayName === 'string' ? candidate.displayName : undefined,
          deviceName: typeof candidate?.deviceName === 'string' ? candidate.deviceName : undefined,
        };
        if (
          !deviceInfoCandidate ||
          roleRank(candidateRole) > roleRank(deviceInfoCandidate.role) ||
          (candidateRole === deviceInfoCandidate.role && lastSeenMs >= deviceInfoCandidate.lastSeenMs)
        ) {
          deviceInfoCandidate = nextCandidate;
        }
      }

      if (deviceInfoCandidate) {
        previousUidToDeduplicate = deviceInfoCandidate.uid;
        patch.role = deviceInfoCandidate.role;
        patch.permissions = deviceInfoCandidate.permissions;
        patch.verified = deviceInfoCandidate.verified;
        if (!isBlocked) patch.status = deviceInfoCandidate.status;
        if (deviceInfoCandidate.status === 'banned' && isPlainObject(deviceInfoCandidate.banDetails)) {
          patch.banDetails = deviceInfoCandidate.banDetails;
        }
        if (typeof deviceInfoCandidate.displayName === 'string' && deviceInfoCandidate.displayName.trim()) {
          patch.displayName = deviceInfoCandidate.displayName.trim().slice(0, 120);
        }
        if (typeof deviceInfoCandidate.deviceName === 'string' && deviceInfoCandidate.deviceName.trim()) {
          patch.deviceName = deviceInfoCandidate.deviceName.trim().slice(0, 120);
        }
      }
    }

    if (!existingSnap.exists) {
      if (!('role' in patch) && installationRole) {
        patch.role = installationRole;
        patch.permissions = permissionsFromStoredProfile(installation?.permissions, installationRole);
        patch.verified = installationRole === 'owner' || installationRole === 'admin' || installation?.verified === true;
        if (!isBlocked) patch.status = installationStatus || 'active';
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
      if (!('role' in patch)) patch.role = 'user';
      patch.firstLogin = new Date().toISOString();
      if (!('permissions' in patch)) patch.permissions = permissionsForRole(patch.role as DeviceRole);
    } else {
      const existing = existingSnap.data() as any;
      const existingRole = normalizeStoredRole(existing?.role) || 'user';
      const existingStatus: DeviceStatus = existing?.status === 'banned' ? 'banned' : 'active';
      patch.role = existingRole;
      patch.permissions = existing?.permissions && typeof existing.permissions === 'object'
        ? existing.permissions
        : permissionsForRole(existingRole);
      if (!isBlocked) patch.status = existingStatus;
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
      if (
        (existingRole === 'admin' || existingRole === 'owner') &&
        isAllFalsePermissions(existing?.permissions)
      ) {
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

    const installationPatch: Record<string, unknown> = {
      installationId,
      knownUids: FieldValue.arrayUnion(uid),
      lastUid: uid,
      lastSeenAt: now,
      updatedAt: now,
    };
    for (const key of ['role', 'permissions', 'status', 'verified', 'banDetails', 'displayName', 'deviceName'] as const) {
      if (key in patch) installationPatch[key] = patch[key];
    }
    await installationRef.set(installationPatch, { merge: true });

    return {
      ok: true,
      installationId,
      status: String(patch.status || status),
      ...(previousUidToDeduplicate ? { dedupedPreviousUid: previousUidToDeduplicate } : {}),
    };
  } catch (err: unknown) {
    throw toHttpsError(err, 'registerDeviceIdentity failed');
  }
});

export const listDevicesForAdmin = onCall(async (request) => {
  try {
    const uid = requireAuth(request.auth?.uid);
    const caller = await getCaller(uid);
    if (!canReadDevicesList(caller)) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to list devices.');
    }

    const snap = await db.collection('devices').limit(500).get();
    const items = snap.docs.map((d) => toClientDeviceItem(d.id, d.data() as any));
    return { ok: true, items };
  } catch (err: unknown) {
    throw toHttpsError(err, 'listDevicesForAdmin failed');
  }
});

const UPSTREAM = 'http://einfo.zgpks.rzeszow.pl/api';
const UPSTREAM_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Accept-Language': 'pl,en;q=0.9',
  Referer: 'http://einfo.zgpks.rzeszow.pl/',
  Origin: 'http://einfo.zgpks.rzeszow.pl',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export const einfoProxyGet = onCall(async (request) => {
  const path = String(request.data?.path || '').replace(/^\//, '');
  const query = String(request.data?.query || '');
  if (!path) throw new HttpsError('invalid-argument', 'path is required');
  if (path.includes('..')) throw new HttpsError('invalid-argument', 'invalid path');

  const url = `${UPSTREAM}/${path}${query && query.startsWith('?') ? query : query ? `?${query}` : ''}`;
  const res = await fetch(url, { headers: UPSTREAM_HEADERS });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpsError('unavailable', `Upstream ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    throw new HttpsError('unavailable', `Invalid JSON: ${text.slice(0, 300)}`);
  }
});

const parseBooleanParam = (value: unknown) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const parseBboxParam = (value: unknown): [number, number, number, number] | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split(',').map((segment) => Number(segment.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
};

const DEFAULT_TRANSPORT_ENDPOINT_ID = 'default-transport-api';
const DEFAULT_TRANSPORT_API_URL = 'https://us-central1-aplikacja-b20fa.cloudfunctions.net/transportApi';
const MAINTENANCE_ENDPOINT_ROLES = new Set(['production', 'backup', 'staging', 'legacy', 'test']);

type MaintenanceEndpointInput = {
  id?: string;
  name?: string;
  url?: string;
  role?: string;
  priority?: number;
  region?: string;
  source?: string;
  fallbackEnabled?: boolean;
  enabled?: boolean;
};

const cleanIdPart = (value: unknown) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const normalizeEndpointUrl = (value: unknown) => {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpsError('invalid-argument', 'Endpoint URL is invalid.');
  }
  if (parsed.protocol !== 'https:') {
    throw new HttpsError('invalid-argument', 'Endpoint URL must use HTTPS.');
  }
  return parsed.toString().replace(/\/+$/, '');
};

const endpointHealthUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/health/providers`;

const sanitizeMaintenanceEndpoint = (input: MaintenanceEndpointInput, existing?: Record<string, unknown>) => {
  const url = normalizeEndpointUrl(input.url ?? existing?.url ?? DEFAULT_TRANSPORT_API_URL);
  const role = String(input.role ?? existing?.role ?? 'production').trim().toLowerCase();
  if (!MAINTENANCE_ENDPOINT_ROLES.has(role)) {
    throw new HttpsError('invalid-argument', 'Invalid endpoint role.');
  }
  const priority = Number(input.priority ?? existing?.priority ?? 1);
  if (!Number.isFinite(priority) || priority < 1 || priority > 99) {
    throw new HttpsError('invalid-argument', 'Priority must be between 1 and 99.');
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

const testMaintenanceUrl = async (url: string) => {
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
      const payload = await res.clone().json() as any;
      if (payload && typeof payload === 'object') {
        providerCount = Object.keys(payload.providers || payload || {}).length;
      }
    } catch {
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
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      statusCode: 0,
      latencyMs: Date.now() - startedAt,
      providerCount: 0,
      testedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system',
    }, { merge: true });
  }

  if (!settingsSnap.exists || !String(settingsSnap.data()?.activeEndpointId || '').trim()) {
    await settingsRef.set({
      activeEndpointId: DEFAULT_TRANSPORT_ENDPOINT_ID,
      previousEndpointId: '',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system',
    }, { merge: true });
  }
};

const writeMaintenanceChange = async (
  action: string,
  endpointId: string,
  actorId: string,
  summary: string,
  before?: unknown,
  after?: unknown,
) => {
  await db.collection('maintenance_changes').add({
    action,
    endpointId,
    actorId,
    summary,
    before: before ?? null,
    after: after ?? null,
    createdAt: FieldValue.serverTimestamp(),
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

const proxyTargetUrl = (baseUrl: string, request: any) => {
  const base = baseUrl.replace(/\/+$/, '');
  const path = String(request.path || '/');
  const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
  const url = `${base}${path}${query}`;
  if (url.startsWith('https://us-central1-aplikacja-b20fa.cloudfunctions.net/transportGateway')) {
    return `${DEFAULT_TRANSPORT_API_URL}${path}${query}`;
  }
  return url;
};

export const transportGateway = onRequest({ cors: true, timeoutSeconds: 60 }, async (request, response) => {
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
    const headers: Record<string, string> = { Accept: 'application/json' };
    const contentType = request.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? JSON.stringify(request.body || {}) : undefined,
    });
    const text = await upstream.text();
    response.status(upstream.status);
    response.set('content-type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
    response.send(text);
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export const transportApi = onRequest({ cors: true, timeoutSeconds: 60 }, async (request, response) => {
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
      let body: any = {};
      if (request.method === 'POST' && request.body) {
        if (typeof request.body === 'string') {
          body = JSON.parse(request.body || '{}');
        } else if (typeof request.body === 'object') {
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
      const route = await resolveRouteGeometry(payload);
      response.json(route);
      return;
    }

    if (path === '/vehicles') {
      const providers = String(request.query.providers || '')
        .split(',')
        .map((provider) => provider.trim())
        .filter(Boolean);
      const payload = await fetchVehiclesForProviders({
        providerIds: providers,
        includeInactive: parseBooleanParam(request.query.includeInactive),
        bbox: parseBboxParam(request.query.bbox),
      });
      response.json(payload);
      return;
    }

    if (path === '/health/providers') {
      response.json(getProvidersHealth());
      return;
    }

    const vehicleMatch = path.match(/^\/vehicle\/([^/]+)\/([^/]+)$/);
    if (vehicleMatch) {
      const providerId = decodeURIComponent(vehicleMatch[1]);
      const vehicleId = decodeURIComponent(vehicleMatch[2]);
      const includeInactive = request.query.includeInactive == null ? true : parseBooleanParam(request.query.includeInactive);
      const vehicle = await fetchVehicleDetails(providerId, vehicleId, includeInactive);

      if (!vehicle) {
        response.status(404).json({ error: 'Vehicle not found' });
        return;
      }

      response.json({ vehicle });
      return;
    }

    response.status(404).json({ error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(500).json({ error: message });
  }
});

export const saveMaintenanceEndpoint = onCall(async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const caller = await getCaller(uid);
  if (!canWriteMaintenance(caller)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions.');
  }

  await ensureDefaultMaintenanceEndpoint();
  const payload = (request.data?.endpoint || request.data || {}) as MaintenanceEndpointInput;
  const explicitId = cleanIdPart(payload.id);
  const endpointId = explicitId || cleanIdPart(payload.name) || `endpoint-${Date.now()}`;
  const ref = db.collection('maintenance_endpoints').doc(endpointId);
  const beforeSnap = await ref.get();
  const before = beforeSnap.exists ? beforeSnap.data() : null;
  const endpoint = sanitizeMaintenanceEndpoint(payload, before || undefined);

  await ref.set({
    ...endpoint,
    active: Boolean(before?.active),
    createdAt: before?.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  }, { merge: true });

  await writeMaintenanceChange('save', endpointId, uid, `Zapisano endpoint ${endpoint.name}`, before, endpoint);
  await writeAudit('Konserwacja: zapisano endpoint', `${endpoint.name} (${endpoint.url})`, 'edit_role', uid);
  return { ok: true, endpointId };
});

export const testMaintenanceEndpoint = onCall(async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const caller = await getCaller(uid);
  if (!canReadMaintenance(caller)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions.');
  }

  await ensureDefaultMaintenanceEndpoint();
  const endpointId = cleanIdPart(request.data?.endpointId);
  let url = request.data?.url ? normalizeEndpointUrl(request.data.url) : '';
  if (!url && endpointId) {
    const snap = await db.collection('maintenance_endpoints').doc(endpointId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Endpoint not found.');
    url = normalizeEndpointUrl(snap.data()?.url);
  }
  if (!url) throw new HttpsError('invalid-argument', 'Endpoint URL or endpointId is required.');

  const result = await testMaintenanceUrl(url);
  if (endpointId) {
    await db.collection('maintenance_endpoints').doc(endpointId).set({
      lastTest: result,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    }, { merge: true });
    await writeMaintenanceChange('test', endpointId, uid, `Test endpointu: ${result.status} ${result.latencyMs} ms`, null, result);
  }
  return { ok: true, result };
});

export const setActiveMaintenanceEndpoint = onCall(async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const caller = await getCaller(uid);
  if (!canWriteMaintenance(caller)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions.');
  }

  await ensureDefaultMaintenanceEndpoint();
  const endpointId = cleanIdPart(request.data?.endpointId);
  if (!endpointId) throw new HttpsError('invalid-argument', 'endpointId is required.');
  const endpointRef = db.collection('maintenance_endpoints').doc(endpointId);
  const endpointSnap = await endpointRef.get();
  if (!endpointSnap.exists) throw new HttpsError('not-found', 'Endpoint not found.');
  const endpoint = endpointSnap.data() || {};
  if (endpoint.enabled === false) throw new HttpsError('failed-precondition', 'Disabled endpoint cannot be active.');

  const settingsRef = db.collection('admin_settings').doc('maintenance');
  const settingsSnap = await settingsRef.get();
  const previousEndpointId = String(settingsSnap.data()?.activeEndpointId || '');
  const batch = db.batch();
  if (previousEndpointId) {
    batch.set(db.collection('maintenance_endpoints').doc(previousEndpointId), { active: false }, { merge: true });
  }
  batch.set(endpointRef, { active: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
  batch.set(settingsRef, {
    activeEndpointId: endpointId,
    previousEndpointId: previousEndpointId && previousEndpointId !== endpointId ? previousEndpointId : String(settingsSnap.data()?.previousEndpointId || ''),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  }, { merge: true });
  await batch.commit();

  await writeMaintenanceChange('activate', endpointId, uid, `Ustawiono aktywny endpoint: ${endpoint.name || endpointId}`, { previousEndpointId }, endpoint);
  await writeAudit('Konserwacja: zmieniono aktywny endpoint', `${previousEndpointId || '-'} -> ${endpointId}`, 'edit_role', uid);
  return { ok: true };
});

export const disableMaintenanceEndpoint = onCall(async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const caller = await getCaller(uid);
  if (!canWriteMaintenance(caller)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions.');
  }

  await ensureDefaultMaintenanceEndpoint();
  const endpointId = cleanIdPart(request.data?.endpointId);
  if (!endpointId) throw new HttpsError('invalid-argument', 'endpointId is required.');
  const ref = db.collection('maintenance_endpoints').doc(endpointId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Endpoint not found.');
  const endpoint = snap.data() || {};
  if (endpoint.active === true) {
    throw new HttpsError('failed-precondition', 'Active endpoint cannot be disabled. Activate another endpoint first.');
  }

  await ref.set({ enabled: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
  await writeMaintenanceChange('disable', endpointId, uid, `Wyłączono endpoint: ${endpoint.name || endpointId}`, endpoint, { enabled: false });
  await writeAudit('Konserwacja: wyłączono endpoint', `${endpoint.name || endpointId}`, 'edit_role', uid);
  return { ok: true };
});

export const rollbackMaintenanceEndpoint = onCall(async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const caller = await getCaller(uid);
  if (!canWriteMaintenance(caller)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions.');
  }

  await ensureDefaultMaintenanceEndpoint();
  const settingsRef = db.collection('admin_settings').doc('maintenance');
  const settingsSnap = await settingsRef.get();
  const activeEndpointId = String(settingsSnap.data()?.activeEndpointId || DEFAULT_TRANSPORT_ENDPOINT_ID);
  const previousEndpointId = String(settingsSnap.data()?.previousEndpointId || '').trim();
  if (!previousEndpointId) {
    throw new HttpsError('failed-precondition', 'No previous endpoint to rollback.');
  }
  const previousSnap = await db.collection('maintenance_endpoints').doc(previousEndpointId).get();
  if (!previousSnap.exists || previousSnap.data()?.enabled === false) {
    throw new HttpsError('failed-precondition', 'Previous endpoint is unavailable.');
  }

  const batch = db.batch();
  batch.set(db.collection('maintenance_endpoints').doc(activeEndpointId), { active: false }, { merge: true });
  batch.set(db.collection('maintenance_endpoints').doc(previousEndpointId), { active: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
  batch.set(settingsRef, {
    activeEndpointId: previousEndpointId,
    previousEndpointId: activeEndpointId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  }, { merge: true });
  await batch.commit();

  await writeMaintenanceChange('rollback', previousEndpointId, uid, `Rollback: ${activeEndpointId} -> ${previousEndpointId}`);
  await writeAudit('Konserwacja: rollback endpointu', `${activeEndpointId} -> ${previousEndpointId}`, 'edit_role', uid);
  return { ok: true };
});

export const setOperatorRole = onCall(async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const caller = await getCaller(uid);
  if (!canManageRoles(caller)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions.');
  }

  const targetDeviceId = String(request.data?.targetDeviceId || '');
  const role = request.data?.role as DeviceRole;
  const requestedPermissions = request.data?.permissions || {};
  if (!targetDeviceId || !['owner', 'admin', 'user'].includes(role)) {
    throw new HttpsError('invalid-argument', 'Invalid role update payload.');
  }
  assertValidDeviceId(targetDeviceId);
  if (targetDeviceId === uid) {
    throw new HttpsError('permission-denied', 'Cannot change own role or permissions.');
  }
  const targetRef = db.collection('devices').doc(targetDeviceId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'Target device not found.');
  }
  const target = targetSnap.data() as any;
  if (caller.role !== 'owner' && target.role !== 'user') {
    throw new HttpsError('permission-denied', 'Only owner can manage owners and admins.');
  }
  if (caller.role !== 'owner' && role === 'owner') {
    throw new HttpsError('permission-denied', 'Admin cannot assign owner role.');
  }

  const permissions = sanitizePermissionsForRole(requestedPermissions, role, caller);
  const displayName = sanitizeDisplayName(request.data?.displayName);
  const patch: Record<string, unknown> = {
    role,
    permissions,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  };
  if (displayName) patch.displayName = displayName;

  await targetRef.set(patch, { merge: true });

  const installationId = normalizeInstallationId(target.installationId);
  if (installationId) {
    await db.collection('installations').doc(installationId).set(
      {
        installationId,
        role,
        permissions,
        ...(displayName ? { displayName } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      },
      { merge: true },
    );
  }

  await writeAudit('Zmieniono role operatora', `${targetLabelForAudit(targetDeviceId, target)} -> ${role}`, 'role_change', uid);
  return { ok: true };
});

export const blockDevice = onCall(async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const caller = await getCaller(uid);
  if (!canManageBans(caller)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions.');
  }

  const targetDeviceId = String(request.data?.targetDeviceId || '');
  const reason = String(request.data?.reason || 'Naruszenie regulaminu').trim().slice(0, 300);
  const expiresAt = request.data?.expiresAt ? String(request.data.expiresAt) : '';
  if (!targetDeviceId) {
    throw new HttpsError('invalid-argument', 'targetDeviceId is required.');
  }
  assertValidDeviceId(targetDeviceId);
  if (targetDeviceId === uid) {
    throw new HttpsError('permission-denied', 'Cannot ban own device.');
  }
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    throw new HttpsError('invalid-argument', 'Invalid expiresAt.');
  }

  const targetRef = db.collection('devices').doc(targetDeviceId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'Target device not found.');
  }
  const target = targetSnap.data() as any;
  if (caller.role !== 'owner' && target.role !== 'user') {
    throw new HttpsError('permission-denied', 'Only owner can ban owners and admins.');
  }
  const targetLabel = targetLabelForAudit(targetDeviceId, target);
  const installationId = normalizeInstallationId(target.installationId);
  const gifUrl = typeof request.data?.gifUrl === 'string' ? request.data.gifUrl.trim().slice(0, 500) : '';
  const silent = request.data?.silent === true;

  if (target.status === 'banned') {
    if (installationId) {
      await blockedInstallationRef(installationId).set(
        {
          active: true,
          reason,
          expiresAt,
          gifUrl,
          silent,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: uid,
        },
        { merge: true },
      );
    }
    return { ok: true, alreadyBanned: true };
  }

  await targetRef.set(
    {
      status: 'banned',
      banDetails: {
        reason,
        expiresAt,
        gifUrl,
        silent,
        bannedAt: new Date().toISOString(),
      },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true },
  );

  if (installationId) {
    await blockedInstallationRef(installationId).set(
      {
        active: true,
        reason,
        expiresAt,
        gifUrl,
        silent,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      },
      { merge: true },
    );
  }

  await writeAudit('Nadano bana urzadzeniu', `${targetLabel}. Powod: ${reason}`, 'ban', uid);
  return { ok: true };
});


export const unblockDevice = onCall(async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const caller = await getCaller(uid);
  if (!canManageBans(caller)) {
    throw new HttpsError('permission-denied', 'Insufficient permissions.');
  }

  const targetDeviceId = String(request.data?.targetDeviceId || '');
  if (!targetDeviceId) {
    throw new HttpsError('invalid-argument', 'targetDeviceId is required.');
  }
  assertValidDeviceId(targetDeviceId);
  if (targetDeviceId === uid) {
    throw new HttpsError('permission-denied', 'Cannot unblock own device.');
  }

  const targetRef = db.collection('devices').doc(targetDeviceId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'Target device not found.');
  }
  const target = targetSnap.data() as any;
  if (caller.role !== 'owner' && target.role !== 'user') {
    throw new HttpsError('permission-denied', 'Only owner can unblock owners and admins.');
  }
  const targetLabel = targetLabelForAudit(targetDeviceId, target);
  const installationId = normalizeInstallationId(target.installationId);

  await targetRef.set(
    {
      status: 'active',
      banDetails: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true },
  );

  if (installationId) {
    await blockedInstallationRef(installationId).set(
      {
        active: false,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      },
      { merge: true },
    );
  }

  await writeAudit('Zdjeto blokade urzadzenia', `Odblokowano: ${targetLabel}`, 'edit_role', uid);
  return { ok: true };
});

export const clearAdminLogs = onCall(async (request) => {
  const uid = requireAuth(request.auth?.uid);
  const caller = await getCaller(uid);
  if (caller.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only owner can clear logs.');
  }

  let deleted = 0;
  for (;;) {
    const snap = await db.collection('admin_logs').limit(400).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((logDoc) => batch.delete(logDoc.ref));
    await batch.commit();
    deleted += snap.size;

    if (snap.size < 400) break;
  }

  return { ok: true, deleted };
});
