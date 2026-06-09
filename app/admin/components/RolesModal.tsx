import { X, Shield, Monitor, Users, Lock, Activity, Hammer, Globe, SlidersHorizontal, UserCog } from 'lucide-react';
import { Device } from '../types';
import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface RolesModalProps {
  device: Device;
  onClose: () => void;
  onUpdateUser: (name: string, role: string) => void;
  onSave?: (role: string, permissions: Record<string, boolean>, displayName?: string, verified?: boolean) => void;
  canAssignOwner?: boolean;
  canManageTabAccess?: boolean;
  canManageVerification?: boolean;
  isSelfTarget?: boolean;
}

export function RolesModal({
  device,
  onClose,
  onUpdateUser,
  onSave,
  canAssignOwner = false,
  canManageTabAccess = false,
  canManageVerification = false,
  isSelfTarget = false,
}: RolesModalProps) {
  const roleLabelFromDevice = () => {
    if (device.rawRole === 'owner') return 'WŁAŚCICIEL';
    if (device.rawRole === 'admin') return 'ADMIN';
    return 'UŻYTKOWNIK';
  };
  const initialRole = roleLabelFromDevice();
  const verifiedFromRole = (r: string) => r.includes('CICIEL') || r === 'ADMIN';
                      
  const [role, setRole] = useState(initialRole);
  const [name, setName] = useState('');
  const [verified, setVerified] = useState(verifiedFromRole(initialRole) || device.verified === true);
  
  // Set default permissions based on role
  const getInitialPermissions = (r: string) => {
    if (r.includes('CICIEL')) {
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
      };
    }
    if (r !== 'ADMIN') {
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
      };
    }
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
    };
  };

  const mergeStoredPermissions = (r: string) => {
    const base = getInitialPermissions(r);
    if (r !== initialRole || !device.permissions) return base;
    return {
      ...base,
      ...device.permissions,
      disableStops: device.permissions.disableMap ? false : Boolean(device.permissions.disableStops),
    };
  };

  const [permissions, setPermissions] = useState(mergeStoredPermissions(initialRole));

  // Update permissions when role changes
  const handleRoleChange = (newRole: string) => {
    setRole(newRole);
    setPermissions(getInitialPermissions(newRole));
    if (verifiedFromRole(newRole)) setVerified(true);
  };

  const isOwnerRole = role.includes('CICIEL');
  const isAdminRole = role === 'ADMIN';
  const isUserRole = !isOwnerRole && !isAdminRole;
  const isDisabled = isOwnerRole || isUserRole;

  useEffect(() => {
    setName('');
    const r = roleLabelFromDevice();
    setRole(r);
    setPermissions(mergeStoredPermissions(r));
    setVerified(verifiedFromRole(r) || device.verified === true);
  }, [device.id, device.displayName, device.role]);

  // Handle immediate update when typing
  useEffect(() => {
    if ((isAdminRole || isOwnerRole) && name) {
      onUpdateUser(name, isOwnerRole ? 'WŁAŚCICIEL' : 'ADMIN');
    }
  }, [name, role, onUpdateUser]);

  const permsList = [
    { key: 'monitor', label: 'Sesje / Urządzenia', desc: 'Sekcja do zarządzania urządzeniami', icon: <Monitor size={16} /> },
    { key: 'shield', label: 'Role i operatorzy', desc: 'Tworzenie i podgląd operatorów', icon: <Shield size={16} /> },
    { key: 'canChangeRoles', label: 'Nadawanie rang', desc: 'Pozwala zmieniac role uzytkownikow', icon: <UserCog size={16} /> },
    { key: 'users', label: 'Zarządzanie użytkownikami', desc: 'Sekcja z uprawnieniami użytkowników', icon: <Users size={16} /> },
    { key: 'group', label: 'Bany / Blokady', desc: 'Historia ograniczonych urządzeń', icon: <Lock size={16} /> },
    { key: 'ban', label: 'Możliwość banowania', desc: 'Zezwala nakładać i zdejmować bany', icon: <Hammer size={16} /> },
    { key: 'logs', label: 'Dostęp do logów', desc: 'Przeglądanie logów systemowych', icon: <Activity size={16} /> },
    { key: 'globalSettings', label: 'Ustawienia globalne', desc: 'Widoczność sekcji i odczyt wartości', icon: <Globe size={16} /> },
    { key: 'globalSettingsEdit', label: 'Edycja ustawień globalnych', desc: 'Zapis zmian w ustawieniach systemowych', icon: <SlidersHorizontal size={16} /> },
  ] as const;

  const togglePermission = (key: keyof typeof permissions) => {
    if (isDisabled || isSelfTarget) return;
    if (key === 'monitor' && (role === 'ADMIN' || role === 'WŁAŚCICIEL')) return;
    setPermissions((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === 'disableMap' && next.disableMap) next.disableStops = false;
      if (key === 'disableStops' && next.disableStops) next.disableMap = false;
      if (key === 'globalSettings' && !next.globalSettings) next.globalSettingsEdit = false;
      if (key === 'globalSettingsEdit' && next.globalSettingsEdit) next.globalSettings = true;
      return next;
    });
  };

  const ownerRoleDisabled = !canAssignOwner && !initialRole.includes('CICIEL');

  const toggleUserTabRestriction = (key: 'disableMap' | 'disableStops') => {
    if (!canManageTabAccess || isSelfTarget) return;
    setPermissions((prev) => ({
      ...prev,
      disableMap: key === 'disableMap' ? !prev.disableMap : false,
      disableStops: key === 'disableStops' ? !prev.disableStops : false,
    }));
  };

  return (
    <div className="fixed inset-0 bg-[#020408]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[#0F131D] border border-white/10 border-t-white/20 rounded-3xl w-full max-w-lg shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden"
      >
        
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/10 flex items-center justify-center border border-sky-500/20 shadow-[0_0_15px_rgba(14,165,233,0.1)]">
              <Shield className="text-sky-400" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Edycja uprawnień</h2>
              <p className="text-sm text-slate-400">
                Imię i nazwisko oraz rola w panelu:{' '}
                <strong className="text-white">{device.name}</strong>
                <span className="text-slate-500"> · </span>
                <strong className="text-white">{device.role}</strong>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 text-slate-400 hover:text-white rounded-2xl hover:bg-white/5 transition-all cursor-pointer">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-8 overflow-y-auto">
          {isSelfTarget && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              To Twoje urządzenie — edycja własnej roli z aplikacji jest zablokowana (w tym zapis pseudonimu).
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 block px-1">Rola systemowa</label>
            <div className="flex flex-wrap gap-3">
              <RoleButton
                role="WŁAŚCICIEL"
                currentRole={role}
                disabled={ownerRoleDisabled || isSelfTarget}
                onClick={() => !ownerRoleDisabled && !isSelfTarget && handleRoleChange('WŁAŚCICIEL')}
              />
              <RoleButton role="ADMIN" currentRole={role} disabled={isSelfTarget} onClick={() => !isSelfTarget && handleRoleChange('ADMIN')} />
              <RoleButton role="UŻYTKOWNIK" currentRole={role} disabled={isSelfTarget} onClick={() => !isSelfTarget && handleRoleChange('UŻYTKOWNIK')} />
            </div>
          </div>

          <AnimatePresence>
            {(role === 'ADMIN' || role === 'WŁAŚCICIEL') && (
              <motion.div 
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 32 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                className="overflow-hidden"
              >
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 block px-1">Pseudonim operatora</label>
                <input 
                  type="text"
                  placeholder="Np. Jan Kowalski"
                  value={name}
                  disabled={isSelfTarget}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#111623] border border-white/5 rounded-2xl py-4 px-5 text-sm text-white focus:outline-none focus:border-sky-500/50 transition-all shadow-inner disabled:opacity-40"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 block px-1">Szczegółowe uprawnienia</label>
            <div className="space-y-3">
              {permsList.map(p => (
                <button 
                  key={p.key}
                  disabled={isDisabled || (p.key === 'monitor' && (role === 'ADMIN' || role === 'WŁAŚCICIEL'))}
                  onClick={() => togglePermission(p.key as any)}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left group",
                    permissions[p.key as keyof typeof permissions] 
                      ? "bg-emerald-500/10 border-emerald-500/30" 
                      : "bg-[#111623] border-white/5",
                    isDisabled || (p.key === 'monitor' && (role === 'ADMIN' || role === 'WŁAŚCICIEL'))
                      ? "opacity-60 cursor-not-allowed grayscale-[0.4] brightness-[0.85]"
                      : "cursor-pointer active:scale-[0.98]"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "p-2 rounded-xl transition-all group-hover:scale-110",
                      permissions[p.key as keyof typeof permissions] ? "bg-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]" : "bg-white/5 text-slate-500"
                    )}>
                      {p.icon}
                    </div>
                    <div>
                      <div className={cn(
                        "text-base font-bold",
                        permissions[p.key as keyof typeof permissions] ? "text-emerald-400" : "text-slate-300"
                      )}>
                        {p.label}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{p.desc}</div>
                    </div>
                  </div>
                  
                  <div className={cn(
                    "w-12 h-7 rounded-full border flex items-center px-1 transition-all",
                    permissions[p.key as keyof typeof permissions] ? "bg-emerald-500/30 border-emerald-500/50 justify-end" : "bg-white/5 border-white/10 justify-start"
                  )}>
                    <div className={cn(
                      "w-5 h-5 rounded-full shadow-lg transition-all",
                      permissions[p.key as keyof typeof permissions] ? "bg-emerald-400" : "bg-slate-600"
                    )} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {canManageTabAccess && !isSelfTarget && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 block px-1">Dostęp użytkownika</label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { key: 'disableMap' as const, title: 'Wyłącz mapę', desc: 'Użytkownik nie zobaczy zakładki mapy', active: permissions.disableMap, blocked: permissions.disableStops },
                  { key: 'disableStops' as const, title: 'Wyłącz przystanki', desc: 'Użytkownik nie zobaczy zakładki przystanków', active: permissions.disableStops, blocked: permissions.disableMap },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    disabled={isSelfTarget || item.blocked}
                    onClick={() => toggleUserTabRestriction(item.key)}
                    className={cn(
                      'flex items-center justify-between gap-4 rounded-2xl border p-4 text-left transition-all',
                      item.active ? 'border-rose-500/40 bg-rose-500/10' : 'border-white/5 bg-[#111623]',
                      item.blocked || isSelfTarget ? 'cursor-not-allowed opacity-45 grayscale-[0.4]' : 'cursor-pointer active:scale-[0.98]',
                    )}
                  >
                    <div className="min-w-0">
                      <div className={cn('text-sm font-black', item.active ? 'text-rose-300' : 'text-slate-200')}>{item.title}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{item.desc}</div>
                    </div>
                    <span
                      role="switch"
                      aria-checked={item.active}
                      className={cn(
                        'flex h-7 w-12 shrink-0 items-center rounded-full border px-1 transition-all',
                        item.active ? 'justify-end border-rose-500/50 bg-rose-500/25' : 'justify-start border-white/10 bg-white/5',
                      )}
                    >
                      <span className={cn('h-5 w-5 rounded-full shadow-lg transition-all', item.active ? 'bg-rose-400' : 'bg-slate-600')} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {canManageVerification && !isSelfTarget && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 block px-1">Weryfikacja</label>
              <button
                type="button"
                disabled={isOwnerRole || isAdminRole}
                onClick={() => !(isOwnerRole || isAdminRole) && setVerified((prev) => !prev)}
                className={cn(
                  'flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition-all',
                  verified ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/5 bg-[#111623]',
                  isOwnerRole || isAdminRole ? 'cursor-not-allowed opacity-60 grayscale-[0.25]' : 'cursor-pointer active:scale-[0.98]',
                )}
              >
                <div className="min-w-0">
                  <div className={cn('text-sm font-black', verified ? 'text-emerald-300' : 'text-slate-200')}>Zweryfikowane</div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Owner i admin są zawsze zweryfikowani. Użytkownika można odznaczyć ręcznie.
                  </div>
                </div>
                <span
                  role="switch"
                  aria-checked={verified}
                  className={cn(
                    'flex h-7 w-12 shrink-0 items-center rounded-full border px-1 transition-all',
                    verified ? 'justify-end border-emerald-500/50 bg-emerald-500/25' : 'justify-start border-white/10 bg-white/5',
                  )}
                >
                  <span className={cn('h-5 w-5 rounded-full shadow-lg transition-all', verified ? 'bg-emerald-400' : 'bg-slate-600')} />
                </span>
              </button>
            </div>
          )}

        </div>

        <div className="p-6 border-t border-white/5 bg-[#111623]/50 backdrop-blur-xl shrink-0">
          <button 
            type="button"
            onClick={async () => {
              if (isSelfTarget) {
                onClose();
                return;
              }
              if (onSave) {
                const nextPermissions =
                  role.includes('CICIEL')
                    ? { ...permissions, monitor: true, canChangeRoles: true }
                    : role === 'ADMIN'
                      ? { ...permissions, monitor: true }
                      : { ...permissions, canChangeRoles: false };
                await onSave(role, nextPermissions, name.trim(), verifiedFromRole(role) || verified);
              }
            }}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-sm font-black transition-all shadow-[0_4px_20px_rgba(16,185,129,0.3)] active:scale-[0.98] cursor-pointer uppercase tracking-widest"
          >
            {isSelfTarget ? 'Zamknij' : 'Zapisz zmiany'}
          </button>
        </div>

      </motion.div>
    </div>
  );
}

function RoleButton({
  role,
  currentRole,
  onClick,
  disabled,
}: {
  role: string;
  currentRole: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const isActive = role === currentRole;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-12 flex-1 min-w-0 flex items-center justify-center px-1 rounded-2xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest border transition-all leading-none",
        disabled ? "opacity-40 cursor-not-allowed bg-[#111623] border-white/5 text-slate-600" : "cursor-pointer active:scale-95",
        !disabled && isActive 
          ? "bg-sky-500/10 border-sky-500/40 text-sky-400 shadow-[0_0_20px_rgba(14,165,233,0.15)]" 
          : !disabled && "bg-[#111623] border-white/10 text-slate-500 hover:border-white/20 hover:text-white"
      )}
    >
      <span className="truncate w-full text-center">{role}</span>
    </button>
  );
}

