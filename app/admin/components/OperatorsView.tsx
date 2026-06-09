import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Filter, Plus, Monitor, Shield, Users, Settings, MoreVertical, Activity, Lock, X, Menu, Hammer, Crown, Globe, SlidersHorizontal, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './Badge';
import { Operator, OperatorRole } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface OperatorsViewProps {
  onMenuClick: () => void;
  operators: Operator[];
  currentUserId?: string;
  canPromoteOwner?: boolean;
  currentDeviceRole: 'owner' | 'admin' | 'user';
  /** Sekcja „Ustawienia globalne” (wg RBAC). */
  globalSettingsSectionVisible?: boolean;
  /** Podgląd bez zapisu (np. tylko globalSettings bez globalSettingsEdit). */
  globalSettingsReadOnly?: boolean;
  onSaveOperator: (operatorId: string, role: OperatorRole, permissions: Operator['permissions']) => Promise<void>;
  onRemoveOperator: (operatorId: string) => Promise<void>;
  globalSettings: {
    loginEnabled: boolean;
    maintenanceMode: boolean;
    autoBan: boolean;
    hiddenProviderIds?: string[];
  };
  onSaveGlobalSettings: (settings: { loginEnabled: boolean; maintenanceMode: boolean; autoBan: boolean; hiddenProviderIds?: string[] }) => Promise<void>;
}

export function OperatorsView({
  onMenuClick,
  operators,
  currentUserId,
  canPromoteOwner = false,
  currentDeviceRole,
  globalSettingsSectionVisible = true,
  globalSettingsReadOnly = false,
  onSaveOperator,
  onRemoveOperator,
  globalSettings,
  onSaveGlobalSettings,
}: OperatorsViewProps) {
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('ALL');
  const [editingOperator, setEditingOperator] = useState<Operator | null>(null);
  const [showGlobalPermissions, setShowGlobalPermissions] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showFilterDropdown) return;

    const closeOnOutsidePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && filterDropdownRef.current?.contains(target)) return;
      setShowFilterDropdown(false);
    };

    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('touchstart', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('touchstart', closeOnOutsidePointer);
    };
  }, [showFilterDropdown]);

  const filteredOperators = useMemo(() => {
    return operators.filter(op => {
      const q = search.toLowerCase();
      const searchMatch =
        op.name.toLowerCase().includes(q) ||
        op.innerId.toLowerCase().includes(q) ||
        op.id.toLowerCase().includes(q);
      const roleMatch = filterRole === 'ALL' ? true : op.role === filterRole;
      return searchMatch && roleMatch;
    });
  }, [operators, search, filterRole]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#040609] p-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] sm:p-8 sm:pb-[calc(env(safe-area-inset-bottom)+4rem)]">
      <div className="mx-auto max-w-4xl space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-4">
            <button 
              onClick={onMenuClick} 
              className="lg:hidden w-11 h-11 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-lg font-bold text-white uppercase tracking-wider">Administratorzy</h1>
                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">Zarządzanie kadrą</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-400 bg-[#111623] border border-white/5 px-4 py-2 rounded-xl">
             <Users size={16} className="text-sky-400" />
             <span>Łącznie administratorów: <strong className="text-white ml-1">{filteredOperators.length}</strong></span>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Szukaj po nazwie lub ID..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#111623] border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>
          <div ref={filterDropdownRef} className="relative">
            <button 
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="flex items-center gap-2 bg-[#111623] border border-white/10 hover:bg-white/5 px-4 py-3 rounded-xl text-sm font-medium text-slate-300 transition-all cursor-pointer group"
            >
              {filterRole === 'ALL' ? 'Filtry' : filterRole === 'WŁAŚCICIEL' ? 'Właściciele' : filterRole === 'ADMIN' ? 'Administratorzy' : 'Użytkownicy'}
              <Filter size={16} className={cn("transition-transform duration-300", showFilterDropdown && "rotate-180")} />
            </button>
            <AnimatePresence>
              {showFilterDropdown && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  className="absolute right-0 top-full mt-2 w-48 bg-[#111623] border border-white/10 rounded-2xl overflow-hidden z-20 shadow-2xl p-1.5 flex flex-col gap-1"
                >
                  <button onClick={() => { setFilterRole('ALL'); setShowFilterDropdown(false); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer">Wszyscy</button>
                  <button onClick={() => { setFilterRole('WŁAŚCICIEL'); setShowFilterDropdown(false); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer">Właściciele</button>
                  <button onClick={() => { setFilterRole('ADMIN'); setShowFilterDropdown(false); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer">Administratorzy</button>
                  <button onClick={() => { setFilterRole('UŻYTKOWNIK'); setShowFilterDropdown(false); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer">Użytkownicy</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* List */}
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredOperators.length === 0 ? (
               <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-10 text-slate-500 text-sm bg-[#111623] rounded-2xl border border-white/5"
               >
                  Nie znaleziono osób w kadrze spełniających kryteria.
               </motion.div>
            ) : (
              filteredOperators.map((op, idx) => (
                <motion.div
                  key={op.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.04 }}
                >
                  <OperatorCard 
                    operator={op}
                    isSelf={Boolean(currentUserId && op.id === currentUserId)}
                    canManage={currentDeviceRole === 'owner'}
                    onEdit={() => setEditingOperator(op)}
                    onDelete={() => onRemoveOperator(op.id)}
                  />
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

        {globalSettingsSectionVisible && (
        <button 
          onClick={() => setShowGlobalPermissions(true)}
          className="w-full flex items-center justify-between p-5 bg-[#111623] border border-white/5 border-t-white/10 rounded-2xl hover:bg-white/5 transition-all group mt-8 cursor-pointer active:scale-[0.98]"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Settings className="text-slate-400 group-hover:text-white transition-colors" size={20} />
            </div>
            <span className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors uppercase tracking-widest">Ustawienia globalne</span>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 group-hover:text-white transition-colors"><path d="m9 18 6-6-6-6"/></svg>
        </button>
        )}

      </div>
      
      {editingOperator && (
        <EditRoleModal 
          operator={editingOperator}
          canAssignOwner={canPromoteOwner}
          isSelf={Boolean(currentUserId && editingOperator.id === currentUserId)}
          onClose={() => setEditingOperator(null)} 
          onSave={async (op) => {
            try {
              await onSaveOperator(op.id, op.role, op.permissions);
            } finally {
              setEditingOperator(null);
            }
          }}
        />
      )}

      {showGlobalPermissions && globalSettingsSectionVisible && (
        <GlobalPermissionsModal
          isOpen={showGlobalPermissions}
          onClose={() => setShowGlobalPermissions(false)}
          initialSettings={globalSettings}
          onSave={onSaveGlobalSettings}
          readOnly={globalSettingsReadOnly}
        />
      )}
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, color }: any) {
  const colorMap = {
    sky: 'text-sky-400',
    emerald: 'text-emerald-400',
    purple: 'text-purple-400',
    rose: 'text-rose-400'
  };

  return (
    <div className="bg-[#111623] border border-white/5 rounded-2xl p-4 flex flex-col justify-between">
      <div className="flex items-center gap-2 text-slate-400 mb-2">
        {icon} <span className="text-xl font-bold text-white">{value}</span>
      </div>
      <div>
        <div className={cn("text-xs font-medium mb-0.5", colorMap[color as keyof typeof colorMap])}>{title}</div>
        <div className="text-[10px] text-slate-500">{subtitle}</div>
      </div>
    </div>
  );
}

function OperatorCard({
  operator,
  isSelf,
  canManage,
  onEdit,
  onDelete,
}: {
  operator: Operator;
  isSelf: boolean;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const showActions = !isSelf && canManage;
  
  return (
    <div className="bg-[#111623] border border-white/5 rounded-2xl p-4 flex items-center justify-between group hover:border-white/10 transition-all hover:bg-white/[0.02] shadow-lg">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-gradient-to-br from-white/10 to-transparent text-lg font-bold text-white">
          {operator.role === 'WŁAŚCICIEL' ? (
            <Crown className="h-5 w-5 text-amber-400" strokeWidth={2.2} aria-hidden />
          ) : operator.role === 'ADMIN' ? (
            <Shield className="text-sky-400" size={20} />
          ) : (
            <Users className="text-emerald-400" size={20} />
          )}
        </div>
        
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-200 transition-colors group-hover:text-white sm:text-base">
              {operator.name}
            </span>
            <Badge role={operator.role} />
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-slate-500 font-mono">ID: {operator.innerId}</span>
          </div>

          <div className="flex gap-2 mt-3.5 flex-wrap">
             <PermissionIcon active={operator.permissions.monitor} icon={<Monitor size={14} />} title="Urządzenia" />
             <PermissionIcon active={operator.permissions.shield} icon={<Shield size={14} />} title="Role i operatorzy" />
             <PermissionIcon active={operator.permissions.users} icon={<Users size={14} />} title="Zarządzanie użytkownikami" />
             <PermissionIcon active={operator.permissions.group} icon={<Lock size={14} />} title="Bany / Blokady" />
             <PermissionIcon active={operator.permissions.ban} icon={<Hammer size={14} />} title="Możliwość banowania" />
             <PermissionIcon active={operator.permissions.logs} icon={<Activity size={14} />} title="Dostęp do logów" />
             <PermissionIcon active={operator.permissions.globalSettings} icon={<Globe size={14} />} title="Ustawienia globalne (podgląd)" />
             <PermissionIcon active={operator.permissions.globalSettingsEdit} icon={<SlidersHorizontal size={14} />} title="Edycja ustawień globalnych" />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2 pr-2">
        <div className="relative">
          {isSelf ? (
            <span className="whitespace-nowrap rounded-lg border border-white/10 px-1.5 py-1 text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:px-2 sm:text-[10px] sm:tracking-widest">
              Twoje konto
            </span>
          ) : showActions ? (
          <button 
            onClick={() => setShowMenu(!showMenu)} 
            onBlur={() => setTimeout(() => setShowMenu(false), 200)}
            className="text-slate-500 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
          >
            <MoreVertical size={16} />
          </button>
          ) : null}
          
          <AnimatePresence>
            {showMenu && showActions && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, x: 10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-full mt-2 w-48 bg-[#151B28] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-20 p-1.5 flex flex-col gap-1"
              >
                <button 
                  onClick={onEdit} 
                  className="w-full text-left px-4 py-3 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
                >
                  Edytuj uprawnienia
                </button>
                <button 
                  onClick={onDelete}
                  className="w-full text-left px-4 py-3 text-sm font-bold text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors border-t border-white/5 cursor-pointer mt-1"
                >
                  Usuń operatora
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="mt-1 text-right">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Ostatnio online</div>
          <div className={cn('text-xs font-bold', operator.lastActiveOnline ? 'text-emerald-400' : 'text-slate-300')}>{operator.lastActive}</div>
        </div>
      </div>
    </div>
  );
}

function PermissionIcon({ active, icon, title }: { active: boolean, icon: any, title?: string }) {
  return (
    <div title={title} className={cn(
      "p-1.5 rounded-lg border flex items-center justify-center transition-all",
      active ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-white/5 border-transparent text-slate-700"
    )}>
      {icon}
    </div>
  );
}

function EditRoleModal({
  operator,
  canAssignOwner,
  isSelf,
  onClose,
  onSave,
}: {
  operator: Operator;
  canAssignOwner: boolean;
  isSelf: boolean;
  onClose: () => void;
  onSave: (op: Operator) => void;
}) {
  const [role, setRole] = useState<OperatorRole>(operator.role);
  const [permissions, setPermissions] = useState(operator.permissions);

  useEffect(() => {
    setRole(operator.role);
    setPermissions(
      operator.role === 'ADMIN' || operator.role === 'WŁAŚCICIEL'
        ? { ...operator.permissions, monitor: true }
        : operator.permissions,
    );
  }, [operator.id, operator.role, operator.permissions]);

  const handleRoleChange = (newRole: OperatorRole) => {
    setRole(newRole);
    if (newRole === 'WŁAŚCICIEL') {
      setPermissions({
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
      });
    } else if (newRole === 'UŻYTKOWNIK') {
      setPermissions({
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
      });
    } else {
      // Default for Admin when manually switched
      setPermissions({
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
      });
    }
  };

  const isDisabled = role === 'UŻYTKOWNIK' || role === 'WŁAŚCICIEL';

  const togglePermission = (key: keyof Operator['permissions']) => {
    if (isDisabled || isSelf) return;
    if (key === 'monitor' && (role === 'ADMIN' || role === 'WŁAŚCICIEL')) return;
    setPermissions((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === 'globalSettings' && !next.globalSettings) next.globalSettingsEdit = false;
      if (key === 'globalSettingsEdit' && next.globalSettingsEdit) next.globalSettings = true;
      return next;
    });
  };

  const ownerPickDisabled = !canAssignOwner && operator.role !== 'WŁAŚCICIEL';

  const permsList = [
    { key: 'monitor', label: 'Urządzenia', desc: 'Sekcja do zarządzania urządzeniami', icon: <Monitor size={16} /> },
    { key: 'shield', label: 'Role i operatorzy', desc: 'Tworzenie i podgląd operatorów', icon: <Shield size={16} /> },
    { key: 'canChangeRoles', label: 'Nadawanie rang', desc: 'Pozwala zmieniac role uzytkownikow', icon: <UserCog size={16} /> },
    { key: 'users', label: 'Zarządzanie użytkownikami', desc: 'Sekcja z uprawnieniami użytkowników', icon: <Users size={16} /> },
    { key: 'group', label: 'Bany / Blokady', desc: 'Historia ograniczonych urządzeń', icon: <Lock size={16} /> },
    { key: 'ban', label: 'Możliwość banowania', desc: 'Zezwala nakładać i zdejmować bany', icon: <Hammer size={16} /> },
    { key: 'logs', label: 'Dostęp do logów', desc: 'Przeglądanie logów systemowych', icon: <Activity size={16} /> },
    { key: 'globalSettings', label: 'Ustawienia globalne', desc: 'Widoczność sekcji i odczyt wartości', icon: <Globe size={16} /> },
    { key: 'globalSettingsEdit', label: 'Edycja ustawień globalnych', desc: 'Zapis zmian w ustawieniach systemowych', icon: <SlidersHorizontal size={16} /> },
  ] as const;

  return (
    <div className="fixed inset-0 bg-[#020408]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[#0F131D] border border-white/10 border-t-white/20 rounded-3xl w-full max-w-lg shadow-2xl relative flex flex-col overflow-hidden"
      >
        
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/10 flex items-center justify-center border border-sky-500/20">
              <Shield className="text-sky-400" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Edycja uprawnień</h2>
              <p className="text-sm text-slate-400">Konfiguracja dostępu: <strong className="text-white">{operator.name}</strong></p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 text-slate-400 hover:text-white rounded-2xl hover:bg-white/5 transition-all cursor-pointer">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-8 overflow-y-auto max-h-[70vh]">
          {isSelf && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              To Twoje urządzenie — edycja z poziomu aplikacji jest zablokowana.
            </div>
          )}

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 block px-1">Rola systemowa</label>
            <div className="flex flex-wrap gap-3">
              <RoleButton
                role="WŁAŚCICIEL"
                currentRole={role}
                disabled={ownerPickDisabled || isSelf}
                onClick={() => !(ownerPickDisabled || isSelf) && handleRoleChange('WŁAŚCICIEL')}
              />
              <RoleButton role="ADMIN" currentRole={role} disabled={isSelf} onClick={() => !isSelf && handleRoleChange('ADMIN')} />
              <RoleButton role="UŻYTKOWNIK" currentRole={role} disabled={isSelf} onClick={() => !isSelf && handleRoleChange('UŻYTKOWNIK')} />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4 block px-1">Szczegółowe uprawnienia</label>
            <div className="space-y-3">
              {permsList.map(p => (
                <button 
                  key={p.key}
                  disabled={isDisabled || isSelf || (p.key === 'monitor' && (role === 'ADMIN' || role === 'WŁAŚCICIEL'))}
                  onClick={() => togglePermission(p.key)}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left group",
                    permissions[p.key] 
                      ? "bg-emerald-500/10 border-emerald-500/30" 
                      : "bg-[#111623] border-white/5",
                    isDisabled || isSelf || (p.key === 'monitor' && (role === 'ADMIN' || role === 'WŁAŚCICIEL'))
                      ? "opacity-60 cursor-not-allowed grayscale-[0.4] brightness-[0.85]"
                      : "cursor-pointer active:scale-[0.98]"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "p-2 rounded-xl transition-all group-hover:scale-110",
                      permissions[p.key] ? "bg-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]" : "bg-white/5 text-slate-500"
                    )}>
                      {p.icon}
                    </div>
                    <div>
                      <div className={cn(
                        "text-base font-bold",
                        permissions[p.key] ? "text-emerald-400" : "text-slate-300"
                      )}>
                        {p.label}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{p.desc}</div>
                    </div>
                  </div>
                  
                  <div className={cn(
                    "w-12 h-7 rounded-full border flex items-center px-1 transition-all",
                    permissions[p.key] ? "bg-emerald-500/30 border-emerald-500/50 justify-end" : "bg-white/5 border-white/10 justify-start"
                  )}>
                    <div className={cn(
                      "w-5 h-5 rounded-full shadow-lg transition-all",
                      permissions[p.key] ? "bg-emerald-400" : "bg-slate-600"
                    )} />
                  </div>
                </button>
              ))}
            </div>
          </div>

        </div>

        <div className="p-6 border-t border-white/5 bg-[#0a0f18]/80 backdrop-blur-xl mt-auto">
          <button 
            type="button"
            onClick={async () => {
              if (isSelf) {
                onClose();
                return;
              }
              await onSave({
                ...operator,
                role,
                permissions: role.includes('CICIEL')
                  ? { ...permissions, monitor: true, canChangeRoles: true }
                  : role === 'ADMIN'
                    ? { ...permissions, monitor: true }
                    : { ...permissions, canChangeRoles: false },
              });
            }}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-sm font-black transition-all shadow-[0_4px_20px_rgba(16,185,129,0.3)] active:scale-[0.98] cursor-pointer uppercase tracking-widest"
          >
            {isSelf ? 'Zamknij' : 'Zapisz zmiany'}
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
        "h-12 flex-1 min-w-0 flex items-center justify-center px-1 rounded-2xl text-[9px] sm:text-[11px] font-black uppercase tracking-widest border transition-all",
        disabled
          ? "opacity-40 cursor-not-allowed border-white/5 text-slate-600 bg-[#111623]"
          : "cursor-pointer active:scale-95",
        !disabled && isActive
          ? "bg-sky-500/10 border-sky-500/40 text-sky-400 shadow-[0_0_20px_rgba(14,165,233,0.15)]"
          : !disabled && "bg-[#111623] border-white/10 text-slate-500 hover:border-white/20 hover:text-white"
      )}
    >
      <span className="truncate">{role}</span>
    </button>
  );
}

function sameGlobalSettings(
  a: { loginEnabled: boolean; maintenanceMode: boolean; autoBan: boolean; hiddenProviderIds?: string[] },
  b: { loginEnabled: boolean; maintenanceMode: boolean; autoBan: boolean; hiddenProviderIds?: string[] },
) {
  const aHidden = [...(a.hiddenProviderIds || [])].sort().join('|');
  const bHidden = [...(b.hiddenProviderIds || [])].sort().join('|');
  return a.loginEnabled === b.loginEnabled && a.maintenanceMode === b.maintenanceMode && a.autoBan === b.autoBan && aHidden === bHidden;
}

function GlobalPermissionsModal({
  isOpen,
  onClose,
  initialSettings,
  onSave,
  readOnly = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialSettings: { loginEnabled: boolean; maintenanceMode: boolean; autoBan: boolean; hiddenProviderIds?: string[] };
  onSave: (settings: { loginEnabled: boolean; maintenanceMode: boolean; autoBan: boolean; hiddenProviderIds?: string[] }) => Promise<void>;
  readOnly?: boolean;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [baseline, setBaseline] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const latestInitialRef = useRef(initialSettings);

  latestInitialRef.current = initialSettings;

  useEffect(() => {
    if (!isOpen) return;
    const snap = { ...latestInitialRef.current };
    setSettings(snap);
    setBaseline(snap);
  }, [isOpen]);

  const dirty = useMemo(() => !sameGlobalSettings(settings, baseline), [settings, baseline]);

  return (
    <div className="fixed inset-0 bg-[#020408]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[#0F131D] border border-white/10 border-t-white/20 rounded-3xl w-full max-w-md shadow-2xl relative overflow-hidden"
      >
        
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
              <Settings className="text-slate-400" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Uprawnienia globalne</h2>
              <p className="text-sm text-slate-500">Ustawienia systemowe</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 text-slate-400 hover:text-white rounded-2xl hover:bg-white/5 transition-all cursor-pointer">
            <X size={24} />
          </button>
        </div>

        {readOnly && (
          <div className="mx-6 mt-2 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
            Tryb podglądu — masz uprawnienie do odczytu ustawień globalnych bez możliwości zapisu.
          </div>
        )}

        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center bg-[#111623] border border-white/5 p-5 rounded-2xl group hover:border-white/10 transition-colors">
            <div>
              <div className="text-base font-bold text-white mb-0.5">Logowanie do panelu</div>
              <div className="text-xs text-slate-500">Zezwalaj na logowanie nowych sesji</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.loginEnabled}
              disabled={readOnly}
              onClick={() => !readOnly && setSettings((s) => ({ ...s, loginEnabled: !s.loginEnabled }))}
              className={cn(
                'flex h-7 w-12 shrink-0 items-center rounded-full border px-1 transition-all',
                readOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                settings.loginEnabled ? 'justify-end border-emerald-500/50 bg-emerald-500/20' : 'justify-start border-white/10 bg-white/5',
              )}
            >
              <span
                className={cn(
                  'h-5 w-5 rounded-full shadow-md transition-all',
                  settings.loginEnabled ? 'bg-emerald-400' : 'bg-slate-600',
                )}
              />
            </button>
          </div>

          <div className="flex justify-between items-center bg-[#111623] border border-white/5 p-5 rounded-2xl group hover:border-white/10 transition-colors">
            <div>
              <div className="text-base font-bold text-white mb-0.5">Tryb konserwacji</div>
              <div className="text-xs text-slate-500 font-medium text-rose-500/70 uppercase tracking-widest text-[9px]">Ostrzeżenie: Wyłącza panel</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.maintenanceMode}
              disabled={readOnly}
              onClick={() => !readOnly && setSettings((s) => ({ ...s, maintenanceMode: !s.maintenanceMode }))}
              className={cn(
                'flex h-7 w-12 shrink-0 items-center rounded-full border px-1 transition-all',
                readOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                settings.maintenanceMode ? 'justify-end border-rose-500/50 bg-rose-500/20' : 'justify-start border-white/10 bg-white/5',
              )}
            >
              <span
                className={cn(
                  'h-5 w-5 rounded-full shadow-md transition-all',
                  settings.maintenanceMode ? 'bg-rose-400' : 'bg-slate-600',
                )}
              />
            </button>
          </div>

          <div className="flex justify-between items-center bg-[#111623] border border-white/5 p-5 rounded-2xl group hover:border-white/10 transition-colors">
            <div>
              <div className="text-base font-bold text-white mb-0.5">Auto-ban niezweryfikowanych</div>
              <div className="text-xs text-slate-500">Cichy ban na zawsze dla urządzeń bez weryfikacji</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoBan}
              disabled={readOnly}
              onClick={() => !readOnly && setSettings((s) => ({ ...s, autoBan: !s.autoBan }))}
              className={cn(
                'flex h-7 w-12 shrink-0 items-center rounded-full border px-1 transition-all',
                readOnly ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                settings.autoBan ? 'justify-end border-amber-500/50 bg-amber-500/20' : 'justify-start border-white/10 bg-white/5',
              )}
            >
              <span
                className={cn(
                  'h-5 w-5 rounded-full shadow-md transition-all',
                  settings.autoBan ? 'bg-amber-400' : 'bg-slate-600',
                )}
              />
            </button>
          </div>

        </div>

        <div className="p-6 border-t border-white/5 bg-[#111623]/50 flex justify-end">
          {readOnly ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl px-8 py-2.5 text-sm font-bold text-white transition-all cursor-pointer bg-white/10 hover:bg-white/15"
            >
              Zamknij
            </button>
          ) : (
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={async () => {
              if (saving || !dirty) return;
              if (sameGlobalSettings(settings, baseline)) {
                onClose();
                return;
              }
              setSaving(true);
              try {
                await onSave(settings);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            className={cn(
              'rounded-2xl px-8 py-2.5 text-sm font-bold text-white transition-all shadow-[0_4px_15px_rgba(16,185,129,0.25)]',
              saving || !dirty
                ? 'cursor-not-allowed bg-emerald-800/40 opacity-60'
                : 'cursor-pointer bg-emerald-500 hover:scale-[1.02] hover:bg-emerald-600 active:scale-95',
            )}
          >
            {saving ? 'Zapisywanie…' : dirty ? 'Zapisz zmiany' : 'Brak zmian'}
          </button>
          )}
        </div>

      </motion.div>
    </div>
  );
}
