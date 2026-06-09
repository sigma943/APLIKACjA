export type Role = 'Właściciel' | 'Administrator' | 'Użytkownik';
export type Status = 'Aktywny' | 'Zablokowany';
export type IconType = 'mobile' | 'desktop' | 'tablet';

export interface Device {
  id: string;
  name: string;
  deviceInfo?: string;
  modelCode?: string;
  /** Short UA / OS line for table subtitle */
  os: string;
  displayName?: string;
  deviceName?: string;
  deviceId: string;
  firstLogin: string;
  firstLoginMs?: number;
  role: Role;
  rawRole?: 'owner' | 'admin' | 'user';
  status: Status;
  verified?: boolean;
  iconType: IconType;
  /** Tekst „ostatnio online” (Europe/Warsaw) lub brak danych */
  lastSeenLabel?: string;
  lastSeenMs?: number;
  lastSeenOnline?: boolean;
  permissions?: AdminPermissions;
}

export type OperatorRole = 'WŁAŚCICIEL' | 'ADMIN' | 'UŻYTKOWNIK';
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
  globalSettings: boolean;
  globalSettingsEdit: boolean;
}

export interface Operator {
  id: string;
  name: string;
  role: OperatorRole;
  innerId: string;
  lastActive: string;
  lastActiveOnline?: boolean;
  permissions: AdminPermissions;
}

export type MaintenanceEndpointRole = 'production' | 'backup' | 'staging' | 'legacy' | 'test';
export type MaintenanceTestStatus = 'success' | 'error' | 'unknown';

export interface MaintenanceEndpoint {
  id: string;
  name: string;
  url: string;
  role: MaintenanceEndpointRole;
  priority: number;
  region: string;
  source: string;
  fallbackEnabled: boolean;
  enabled: boolean;
  active: boolean;
  lastTest?: {
    ok?: boolean;
    status?: MaintenanceTestStatus;
    statusCode?: number;
    latencyMs?: number;
    providerCount?: number;
    testedAt?: string;
    message?: string;
  };
}

export interface MaintenanceChange {
  id: string;
  action: string;
  endpointId: string;
  actorId?: string;
  summary: string;
  createdAtMs: number;
}

export type LogCategory = 'SYSTEM' | 'OPERATOR';

export interface Log {
  id: string;
  /** Epoch ms for filtering (Europe/Warsaw boundaries in UI). */
  createdAtMs?: number;
  date?: string;
  time: string;
  timeAgo: string;
  title: string;
  description: string;
  location?: string;
  category: LogCategory;
  iconType: 'connect' | 'login' | 'gps_lost' | 'ban' | 'role_change' | 'disconnect' | 'gps_spoof' | 'edit_role';
}

export type BanStatus = 'AKTYWNY' | 'ZAKOŃCZONY';

export interface Ban {
  id: string;
  deviceName: string;
  deviceId: string;
  location: string;
  status: BanStatus;
  /** "PERMANENTNY" when no expiry date, otherwise "CZASOWY". */
  kind?: 'PERMANENTNY' | 'CZASOWY';
  expireIn: string;
  reason: string;
  bannedBy: string;
  autoBan?: boolean;
  /** Fixed ban issue datetime (formatted once from stored timestamp). */
  date: string;
}
