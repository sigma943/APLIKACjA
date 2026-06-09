export type DeviceRole = 'owner' | 'admin' | 'user';

export interface AdminPermissions {
  monitor: boolean;
  shield: boolean;
  users: boolean;
  group: boolean;
  logs: boolean;
  ban: boolean;
  canChangeRoles: boolean;
  disableMap: boolean;
  disableStops: boolean;
  /** Widoczność sekcji ustawień globalnych (operatorzy). */
  globalSettings: boolean;
  /** Zapis ustawień globalnych (Firestore admin_settings). */
  globalSettingsEdit: boolean;
}

export interface LegacyPermissions {
  canBan?: boolean;
  canViewList?: boolean;
  canChangeRoles?: boolean;
}

export type StoredPermissions = Partial<AdminPermissions & LegacyPermissions> | null | undefined;

export const OWNER_PERMISSIONS: AdminPermissions = {
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
};

export const USER_PERMISSIONS: AdminPermissions = {
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
};

export const ADMIN_DEFAULT_PERMISSIONS: AdminPermissions = {
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
};

export const roleToAdminPermissions = (role: DeviceRole): AdminPermissions => {
  if (role === 'owner') return OWNER_PERMISSIONS;
  if (role === 'admin') return ADMIN_DEFAULT_PERMISSIONS;
  return USER_PERMISSIONS;
};

export const toLegacyPermissions = (permissions: StoredPermissions): Required<LegacyPermissions> => ({
  /** Jawne `false` na legacy polu nie powinno gasić nowego `monitor` / `ban` / `shield`. */
  canBan: Boolean(permissions?.ban || permissions?.canBan),
  canViewList: Boolean(permissions?.monitor || permissions?.canViewList),
  canChangeRoles: Boolean(permissions?.canChangeRoles),
});

export const normalizeAdminPermissions = (
  permissions: StoredPermissions,
  role: DeviceRole,
): AdminPermissions => {
  const base = roleToAdminPermissions(role);
  if (!permissions) return base;

  return {
    monitor: role === 'owner' || role === 'admin'
      ? true
      : Boolean(permissions.monitor ?? permissions.canViewList ?? base.monitor),
    shield: role === 'owner' ? true : Boolean(permissions.shield ?? base.shield),
    users: role === 'owner' ? true : Boolean(permissions.users ?? base.users),
    group: role === 'owner' ? true : Boolean(permissions.group ?? base.group),
    logs: role === 'owner' ? true : Boolean(permissions.logs ?? base.logs),
    ban: role === 'owner' ? true : Boolean(permissions.ban ?? permissions.canBan ?? base.ban),
    canChangeRoles: role === 'owner' ? true : Boolean(permissions.canChangeRoles ?? base.canChangeRoles),
    disableMap: Boolean(permissions.disableMap ?? base.disableMap),
    disableStops: !permissions.disableMap ? Boolean(permissions.disableStops ?? base.disableStops) : false,
    globalSettings: role === 'owner' ? true : Boolean(permissions.globalSettings ?? base.globalSettings),
    globalSettingsEdit: role === 'owner' ? true : Boolean(permissions.globalSettingsEdit ?? base.globalSettingsEdit),
  };
};

/** For UI lists: owners always show full capability set regardless of stored flags. */
export const effectiveAdminPermissionsForDisplay = (
  role: DeviceRole,
  permissions: StoredPermissions,
): AdminPermissions => {
  return normalizeAdminPermissions(permissions, role);
};

export const buildDevicePermissions = (role: DeviceRole, permissions?: StoredPermissions) => {
  const admin = normalizeAdminPermissions(permissions, role);
  const legacy = toLegacyPermissions({ ...permissions, ...admin });
  return { ...admin, ...legacy };
};

/** Dostęp do panelu admina: właściciel albo administrator z prawem podglądu listy urządzeń (monitor / canViewList). */
export const canAccessAdminDashboard = (role: DeviceRole, permissions: StoredPermissions): boolean => {
  if (role === 'owner') return true;
  if (role === 'admin') return effectiveAdminPermissionsForDisplay(role, permissions).monitor;
  return false;
};
