import { Search, Filter, Lock, Settings, Smartphone, Tablet, Monitor, ChevronLeft, ChevronRight, Menu, ArrowUpDown, Pencil, X, Check, CheckCircle2, Trash2 } from 'lucide-react';
import { Badge } from './Badge';
import { cn } from '@/lib/utils';
import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Device } from '../types';

interface DeviceTableProps {
  devices: Device[];
  devicesError?: string | null;
  currentUserId?: string;
  currentDeviceRole?: 'owner' | 'admin' | 'user';
  canBan?: boolean;
  canChangeRoles?: boolean;
  canDeleteDevices?: boolean;
  onOpenBanModal: (device: any) => void;
  onOpenRolesModal: (device: any) => void;
  onNavigateToBanScreen: () => void;
  onMenuClick: () => void;
  onRenameDevice?: (device: Device, label: string) => Promise<void>;
  onDeleteDevice?: (device: Device) => Promise<void>;
}

type SortKey = 'firstLogin' | 'lastSeen' | 'role' | 'status';


export function DeviceTable({
  devices,
  devicesError = null,
  currentUserId,
  currentDeviceRole = 'user',
  canBan = true,
  canChangeRoles = true,
  canDeleteDevices = false,
  onOpenBanModal,
  onOpenRolesModal,
  onNavigateToBanScreen: _onNavigateToBanScreen,
  onMenuClick,
  onRenameDevice,
  onDeleteDevice,
}: DeviceTableProps) {
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('ALL');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; dir: 'desc' | 'asc' }>({ key: 'lastSeen', dir: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [renameDevice, setRenameDevice] = useState<Device | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [deleteDevice, setDeleteDevice] = useState<Device | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toolbarDropdownsRef = useRef<HTMLDivElement | null>(null);
  const itemsPerPage = 5;

  const roleRank = (device: Device) => {
    if (device.rawRole === 'owner') return 3;
    if (device.rawRole === 'admin') return 2;
    return 1;
  };

  const statusRank = (status: string) => (status.toUpperCase() === 'AKTYWNY' ? 2 : 1);

  const handleSortClick = (key: SortKey) => {
    setSortConfig((prev) => (!prev || prev.key !== key ? { key, dir: 'desc' } : { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }));
    setShowSortDropdown(false);
    setShowFilterDropdown(false);
    setCurrentPage(1);
  };

  const toggleSortDropdown = () => {
    setShowSortDropdown((open) => {
      const nextOpen = !open;
      if (nextOpen) setShowFilterDropdown(false);
      return nextOpen;
    });
  };

  const toggleFilterDropdown = () => {
    setShowFilterDropdown((open) => {
      const nextOpen = !open;
      if (nextOpen) setShowSortDropdown(false);
      return nextOpen;
    });
  };

  useEffect(() => {
    if (!showFilterDropdown && !showSortDropdown) return;

    const closeOnOutsidePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && toolbarDropdownsRef.current?.contains(target)) return;
      setShowFilterDropdown(false);
      setShowSortDropdown(false);
    };

    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('touchstart', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('touchstart', closeOnOutsidePointer);
    };
  }, [showFilterDropdown, showSortDropdown]);

  const sortLabel = sortConfig
    ? sortConfig.key === 'firstLogin'
      ? 'Pierwsze logowanie'
      : sortConfig.key === 'lastSeen'
        ? 'Ostatnio online'
        : sortConfig.key === 'role'
          ? 'Rola'
          : 'Status'
    : 'Sortowanie';

  const filteredDevices = useMemo(() => {
    const q = search.toLowerCase();
    return devices.filter((device) => {
      const dn = String(device.displayName ?? '').trim().toLowerCase();
      const deviceName = String(device.deviceName ?? '').trim().toLowerCase();
      const searchMatch =
        device.name.toLowerCase().includes(q) ||
        deviceName.includes(q) ||
        dn.includes(q) ||
        device.deviceId.toLowerCase().includes(q) ||
        device.role.toLowerCase().includes(q);

      let roleMatch = true;
      if (filterRole === 'BLOCKED') {
        roleMatch = device.status.toUpperCase() === 'ZABLOKOWANY';
      } else if (filterRole !== 'ALL') {
        roleMatch = device.role.toUpperCase() === filterRole;
      }

      return searchMatch && roleMatch;
    });
  }, [devices, search, filterRole]);

  const sortedDevices = useMemo(() => {
    const dir = sortConfig.dir === 'desc' ? -1 : 1;
    return [...filteredDevices].sort((a, b) => {
      let left = 0;
      let right = 0;
      if (sortConfig.key === 'firstLogin') {
        left = Number(a.firstLoginMs || 0);
        right = Number(b.firstLoginMs || 0);
      } else if (sortConfig.key === 'lastSeen') {
        left = Number(a.lastSeenMs || 0);
        right = Number(b.lastSeenMs || 0);
      } else if (sortConfig.key === 'role') {
        left = roleRank(a);
        right = roleRank(b);
      } else {
        left = statusRank(a.status);
        right = statusRank(b.status);
      }
      return left === right ? a.name.localeCompare(b.name, 'pl') : (left - right) * dir;
    });
  }, [filteredDevices, sortConfig]);

  const totalPages = useMemo(() => Math.ceil(sortedDevices.length / itemsPerPage), [sortedDevices.length]);
  const safeCurrentPage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1;

  const currentDevices = useMemo(() => {
    return sortedDevices.slice((safeCurrentPage - 1) * itemsPerPage, safeCurrentPage * itemsPerPage);
  }, [safeCurrentPage, sortedDevices]);

  const getIcon = (type: string) => {
    switch (type) {
      case 'mobile': return <Smartphone className="text-slate-400" size={20} />;
      case 'tablet': return <Tablet className="text-slate-400" size={20} />;
      default: return <Monitor className="text-slate-400" size={20} />;
    }
  };

  const protectedForAdmin = (device: Device) => currentDeviceRole !== 'owner' && (device.rawRole === 'owner' || device.rawRole === 'admin');

  const canBanTarget = (device: Device, isSelf: boolean) => {
    if (isSelf || !canBan || protectedForAdmin(device)) return false;
    if (device.rawRole === 'owner') return false;
    if (device.status.toUpperCase() === 'ZABLOKOWANY') return false;
    return true;
  };

  const canManageTarget = (device: Device, isSelf: boolean) => {
    if (isSelf || !canChangeRoles || protectedForAdmin(device)) return false;
    if (device.status.toUpperCase() === 'ZABLOKOWANY') return false;
    return true;
  };

  const banTitle = (device: Device, isSelf: boolean) => (canBanTarget(device, isSelf) ? 'Zablokuj' : undefined);
  const manageTitle = (device: Device, isSelf: boolean) => (canManageTarget(device, isSelf) ? 'Opcje' : undefined);
  const canRenameModels = Boolean(onRenameDevice && currentDeviceRole === 'owner');
  const deleteRoleRank = (role?: Device['rawRole']) => role === 'owner' ? 3 : role === 'admin' ? 2 : 1;
  const canDeleteTarget = (device: Device, isSelf: boolean) => {
    if (!onDeleteDevice || !canDeleteDevices || isSelf) return false;
    if (currentDeviceRole === 'owner') return true;
    if (currentDeviceRole !== 'admin') return false;
    return deleteRoleRank(device.rawRole) < deleteRoleRank(currentDeviceRole);
  };
  const deleteTitle = (device: Device, isSelf: boolean) => (canDeleteTarget(device, isSelf) ? 'Usuń urządzenie' : 'Brak uprawnień do usunięcia');

  const openDeleteConfirm = (device: Device) => {
    setDeleteError(null);
    setDeleteDevice(device);
  };

  const confirmDelete = async () => {
    if (!deleteDevice || !onDeleteDevice || deleteSaving) return;
    setDeleteSaving(true);
    setDeleteError(null);
    try {
      await onDeleteDevice(deleteDevice);
      setDeleteDevice(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleteSaving(false);
    }
  };

  const openRename = (device: Device) => {
    if (!canRenameModels) return;
    setRenameDevice(device);
    setRenameValue(String(device.deviceName || device.name).replace(/\s+-\s+[A-Za-z0-9_-]{4,}$/, '').trim());
  };

  const saveRename = async () => {
    if (!renameDevice || !onRenameDevice || renameSaving) return;
    setRenameSaving(true);
    try {
      await onRenameDevice(renameDevice, renameValue);
      setRenameDevice(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setRenameSaving(false);
    }
  };

  const RenameButton = ({ device, compact = false }: { device: Device; compact?: boolean }) => {
    if (!canRenameModels) return null;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openRename(device);
        }}
        title="Zmień nazwę urządzenia"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white/80 text-slate-600 shadow-lg transition-all hover:border-emerald-400/30 hover:bg-emerald-500/10 hover:text-emerald-500 active:scale-95',
          compact ? 'h-9 w-9' : 'h-8 w-8',
        )}
      >
        <Pencil size={compact ? 15 : 14} />
      </button>
    );
  };

  const DeviceName = ({ device, compact = false }: { device: Device; compact?: boolean }) => (
    <div className="min-w-0">
      {false && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openRename(device);
          }}
          title="Zmień nazwę urządzenia"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-400 transition-all hover:border-emerald-400/30 hover:bg-emerald-500/10 hover:text-emerald-300 active:scale-95"
        >
          <Pencil size={14} />
        </button>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn('min-w-0 truncate text-white transition-colors group-hover:text-emerald-400 font-bold', compact ? 'text-base leading-none' : 'text-sm')}>
          {device.name}
        </div>
        {canRenameModels && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openRename(device);
            }}
            title="Zmień nazwę urządzenia"
            aria-label="Zmień nazwę urządzenia"
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full text-slate-500 transition-all hover:bg-emerald-500/10 hover:text-emerald-400 active:scale-95',
              compact ? 'h-7 w-7' : 'h-6 w-6',
            )}
          >
            <Pencil size={compact ? 13 : 12} />
          </button>
        )}
        {device.verified && (
          <span title="Zweryfikowane" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/12 text-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.16)]">
            <CheckCircle2 size={13} strokeWidth={2.6} />
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#040609] p-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] sm:p-8 sm:pb-[calc(env(safe-area-inset-bottom)+4rem)]">
      <AnimatePresence>
        {deleteDevice && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="fixed left-0 right-0 top-4 z-[12000] flex justify-center px-4"
          >
            <div className="relative w-full max-w-sm overflow-hidden rounded-[1.25rem] border border-white/5 bg-[#0F131D]/95 p-4 shadow-2xl shadow-[0_10px_40px_rgba(244,63,94,0.15)] backdrop-blur-xl">
              <div className="absolute bottom-0 left-0 top-0 w-1 bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,1)]" />
              <div className="flex gap-4 pl-2">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-400">
                  <Trash2 size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-sm font-bold leading-tight text-white">Usunąć użytkownika?</div>
                  <div className="text-[13px] font-medium leading-snug text-slate-400">
                    Czy na pewno chcesz usunąć użytkownika <span className="font-bold text-slate-200">{deleteDevice.name}</span>? Tej operacji nie da się cofnąć.
                  </div>
                </div>
              </div>
              {deleteError && (
                <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[12px] font-semibold leading-snug text-rose-100">
                  Nie udało się usunąć użytkownika: {deleteError}
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2 pl-2">
                <button
                  type="button"
                  onClick={() => setDeleteDevice(null)}
                  disabled={deleteSaving}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={14} />
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={deleteSaving}
                  className="flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/15 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-rose-200 transition-all hover:bg-rose-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check size={14} />
                  {deleteSaving ? 'Usuwanie' : 'Potwierdź'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
        {renameDevice && (
          <motion.div
            className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/60 p-4 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] backdrop-blur-sm sm:pb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !renameSaving && setRenameDevice(null)}
          >
            <motion.div
              initial={{ y: 28, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 28, opacity: 0, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[calc(100dvh-8rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#111623] p-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:p-6"
            >
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-black tracking-tight text-white">Nazwa urządzenia</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Ta nazwa zapisze się tylko dla tego urządzenia w panelu admina.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={renameSaving}
                  onClick={() => setRenameDevice(null)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  <X size={18} />
                </button>
              </div>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename();
                }}
                maxLength={80}
                autoFocus
                placeholder="np. Telefon Tomka"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-400/40"
              />
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  disabled={renameSaving}
                  onClick={() => setRenameDevice(null)}
                  className="h-12 flex-1 rounded-2xl border border-white/10 bg-white/5 text-sm font-bold text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  Anuluj
                </button>
                <button
                  type="button"
                  disabled={renameSaving || !renameValue.trim()}
                  onClick={saveRename}
                  className="h-12 flex-1 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 text-sm font-black text-emerald-50 transition-all hover:bg-emerald-500/25 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {renameSaving ? 'Zapisywanie...' : 'Zapisz'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-col gap-6 mb-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={onMenuClick} className="lg:hidden w-11 h-11 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer">
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight uppercase">Urządzenia</h1>
              <p className="text-slate-500 text-[10px] sm:text-xs uppercase tracking-wider font-medium">Infrastruktura dostępowa</p>
            </div>
          </div>
        </div>

        <div className="w-full bg-[#111623] border border-white/5 border-t-white/10 rounded-2xl px-5 py-4 flex items-center justify-between shadow-xl">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Łączna liczba urządzeń</div>
          <div className="text-2xl font-mono font-black text-emerald-400 leading-none">{devices.length}</div>
        </div>
      </div>

      <div ref={toolbarDropdownsRef} className="grid grid-cols-1 gap-3 mb-6 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <div className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            type="text"
            placeholder="Szukaj..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-[#111623] border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>

        <div className="relative w-full sm:w-auto">
          <button onClick={toggleSortDropdown} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#111623] border border-white/10 hover:bg-white/5 px-5 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-300 transition-all cursor-pointer shadow-lg active:scale-95 group">
            <ArrowUpDown size={14} className="text-slate-500 group-hover:text-white transition-colors" />
            <span className="truncate">{sortLabel}{sortConfig ? (sortConfig.dir === 'desc' ? ' ↓' : ' ↑') : ''}</span>
          </button>
          <AnimatePresence>
            {showSortDropdown && (
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="absolute right-0 top-full mt-2 w-full sm:w-64 bg-[#111623] border border-white/10 rounded-2xl overflow-hidden z-20 shadow-2xl p-1.5 flex flex-col gap-1">
                {[
                  ['firstLogin', 'Pierwsze logowanie'],
                  ['lastSeen', 'Ostatnio online'],
                  ['role', 'Rola'],
                  ['status', 'Status'],
                ].map(([key, label]) => (
                  <button key={key} onClick={() => handleSortClick(key as SortKey)} className={cn('w-full text-left px-4 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer', sortConfig?.key === key ? 'bg-white/10 text-white shadow-lg' : 'text-slate-500 hover:bg-white/5 hover:text-white')}>
                    {label}{sortConfig?.key === key ? (sortConfig.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="relative w-full sm:w-auto">
          <button onClick={toggleFilterDropdown} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#111623] border border-white/10 hover:bg-white/5 px-5 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-300 transition-all cursor-pointer shadow-lg active:scale-95 group">
            <Filter size={14} className={cn('text-slate-500 group-hover:text-white transition-all duration-300', showFilterDropdown && 'rotate-180')} />
            <span>{filterRole === 'ALL' ? 'Filtry' : filterRole === 'WŁAŚCICIEL' ? 'Właściciele' : filterRole === 'ADMIN' ? 'Administratorzy' : filterRole === 'BLOCKED' ? 'Zablokowani' : 'Użytkownicy'}</span>
          </button>
          <AnimatePresence>
            {showFilterDropdown && (
              <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="absolute right-0 top-full mt-2 w-full sm:w-56 bg-[#111623] border border-white/10 rounded-2xl overflow-hidden z-20 shadow-2xl p-1.5 flex flex-col gap-1">
                <button onClick={() => { setFilterRole('ALL'); setShowFilterDropdown(false); }} className={cn('w-full text-left px-4 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer', filterRole === 'ALL' ? 'bg-white/10 text-white shadow-lg' : 'text-slate-500 hover:bg-white/5 hover:text-white')}>Wszyscy</button>
                <button onClick={() => { setFilterRole('WŁAŚCICIEL'); setShowFilterDropdown(false); }} className={cn('w-full text-left px-4 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer', filterRole === 'WŁAŚCICIEL' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-500 hover:bg-white/5 hover:text-white')}>Właściciele</button>
                <button onClick={() => { setFilterRole('ADMIN'); setShowFilterDropdown(false); }} className={cn('w-full text-left px-4 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer', filterRole === 'ADMIN' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-500 hover:bg-white/5 hover:text-white')}>Administratorzy</button>
                <button onClick={() => { setFilterRole('UŻYTKOWNIK'); setShowFilterDropdown(false); }} className={cn('w-full text-left px-4 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer', filterRole === 'UŻYTKOWNIK' ? 'bg-slate-500/10 text-slate-300' : 'text-slate-500 hover:bg-white/5 hover:text-white')}>Użytkownicy</button>
                <button onClick={() => { setFilterRole('BLOCKED'); setShowFilterDropdown(false); }} className={cn('w-full text-left px-4 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer', filterRole === 'BLOCKED' ? 'bg-rose-500/10 text-rose-400' : 'text-slate-500 hover:bg-white/5 hover:text-white')}>Zablokowani</button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {devicesError && (
        <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          <span className="font-bold">Błąd odczytu urządzeń: </span>
          {devicesError}
        </div>
      )}

      <div className="md:hidden space-y-4 pt-2">
        <AnimatePresence mode="popLayout">
          {currentDevices.length > 0 ? currentDevices.map((device, idx) => {
            const isSelf = Boolean(currentUserId && device.id === currentUserId);
            const banDisabled = !canBanTarget(device, isSelf);
            const rolesDisabled = !canManageTarget(device, isSelf);
            const deleteDisabled = !canDeleteTarget(device, isSelf);
            const primaryLabel = device.name;
            return (
              <motion.div key={device.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: idx * 0.05 }} className="bg-[#111623] border border-white/5 border-t-white/10 rounded-[2rem] p-6 shadow-2xl space-y-5 group relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-3xl rounded-full translate-x-16 -translate-y-16" />
                <div className="flex items-center justify-between relative z-10 gap-3">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0 shadow-lg group-hover:scale-105 transition-transform">{getIcon(device.iconType)}</div>
                    <div className="min-w-0 flex-1">
                      <DeviceName device={device} compact />
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{device.os}</div>
                      <div className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">Ostatnio online</div>
                      <div className={cn('text-[11px] font-medium break-words', device.lastSeenOnline ? 'text-emerald-400' : 'text-slate-400')}>{device.lastSeenLabel ?? '—'}</div>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" disabled={banDisabled} title={banTitle(device, isSelf)} onClick={() => !banDisabled && onOpenBanModal(device)} className="cursor-pointer rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-400 shadow-lg transition-all hover:bg-rose-500 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30">
                      <Lock size={18} />
                    </button>
                    {canChangeRoles && (
                      <button type="button" disabled={rolesDisabled} title={manageTitle(device, isSelf)} onClick={() => !rolesDisabled && onOpenRolesModal(device)} className="cursor-pointer rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3 text-sky-400 shadow-lg transition-all hover:bg-sky-500 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30">
                        <Settings size={18} />
                      </button>
                    )}
                    <button type="button" disabled={deleteDisabled} title={deleteTitle(device, isSelf)} onClick={() => !deleteDisabled && openDeleteConfirm(device)} className="cursor-pointer rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-400 shadow-lg transition-all hover:bg-rose-500 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6 py-4 border-y border-white/5 relative z-10">
                  <div>
                    <div className="text-[10px] text-slate-600 uppercase tracking-widest font-black mb-1">ID urządzenia</div>
                    <div className="font-mono text-[11px] text-slate-400 break-all leading-tight font-bold">{device.deviceId}</div>
                  </div>
                  <div className="flex flex-col items-end text-right border-l border-white/5">
                    <div className="text-[10px] text-slate-600 uppercase tracking-widest font-black mb-1">Logowanie</div>
                    <div className="text-xs text-slate-300 font-bold">{device.firstLogin.split(',')[0]}</div>
                    <div className="text-[10px] text-slate-500 font-medium">{device.firstLogin.split(',')[1]}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 relative z-10">
                  <div className="flex flex-col gap-1 items-start">
                    <div className="text-[9px] text-slate-500 uppercase tracking-[0.2em] font-black">Rola w systemie</div>
                    <Badge role={device.role} className="-ml-[1px]" />
                  </div>
                  <div className="flex flex-col gap-1 items-end text-right">
                    <div className="text-[9px] text-slate-500 uppercase tracking-[0.2em] font-black">Obecny stan</div>
                    <Badge status={device.status} className="-mr-[1px]" />
                  </div>
                </div>
              </motion.div>
            );
          }) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-[#111623] border border-white/5 rounded-3xl p-16 text-center text-slate-500 font-bold uppercase tracking-widest text-xs italic">
              {devicesError ? 'Brak dostępu do listy urządzeń' : 'Nie znaleziono aktywnych urządzeń'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="hidden md:block bg-[#111623] border border-white/5 border-t-white/10 rounded-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm font-sans">
            <thead>
              <tr className="border-b border-white/5 text-slate-500 uppercase tracking-widest text-[10px] font-bold">
                <th className="px-6 py-5">URZĄDZENIE</th>
                <th className="px-6 py-5">ID URZĄDZENIA</th>
                <th className="px-6 py-5">PIERWSZE LOGOWANIE</th>
                <th className="px-6 py-5">OSTATNIO ONLINE</th>
                <th className="px-6 py-5">ROLA</th>
                <th className="px-6 py-5">STATUS</th>
                <th className="px-6 py-5 text-left">AKCJE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
                {currentDevices.length > 0 ? currentDevices.map((device) => {
                  const isSelf = Boolean(currentUserId && device.id === currentUserId);
                  const banDisabled = !canBanTarget(device, isSelf);
                  const rolesDisabled = !canManageTarget(device, isSelf);
                  const deleteDisabled = !canDeleteTarget(device, isSelf);
                  return (
                    <tr key={device.id} className="group hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4 min-w-[200px]">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="flex shrink-0 items-center gap-2">
                            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center">{getIcon(device.iconType)}</div>
                          </div>
                          <div className="min-w-0">
                            <DeviceName device={device} />
                            <div className="mt-0.5 text-xs text-slate-500">{device.os}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-slate-400 text-xs break-all">{device.deviceId}</td>
                      <td className="px-6 py-4 text-slate-400">{device.firstLogin}</td>
                      <td className={cn('px-6 py-4 text-xs', device.lastSeenOnline ? 'font-bold text-emerald-400' : 'text-slate-400')}>{device.lastSeenLabel ?? '—'}</td>
                      <td className="px-6 py-4"><Badge role={device.role} /></td>
                      <td className="px-6 py-4 w-32"><Badge status={device.status} /></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-start gap-2">
                          <button type="button" disabled={banDisabled} onClick={() => !banDisabled && onOpenBanModal(device)} className="cursor-pointer rounded-xl p-2.5 text-slate-500 transition-all hover:scale-110 hover:bg-rose-500/10 hover:text-rose-400 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30" title={banTitle(device, isSelf)}>
                            <Lock size={18} />
                          </button>
                          {canChangeRoles && (
                            <button type="button" disabled={rolesDisabled} onClick={() => !rolesDisabled && onOpenRolesModal(device)} className="cursor-pointer rounded-xl p-2.5 text-slate-500 transition-all hover:scale-110 hover:bg-sky-500/10 hover:text-sky-400 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30" title={manageTitle(device, isSelf)}>
                              <Settings size={18} />
                            </button>
                          )}
                          <button type="button" disabled={deleteDisabled} onClick={() => !deleteDisabled && openDeleteConfirm(device)} className="cursor-pointer rounded-xl p-2.5 text-slate-500 transition-all hover:scale-110 hover:bg-rose-500/10 hover:text-rose-400 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30" title={deleteTitle(device, isSelf)}>
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      {devicesError ? 'Brak dostępu do listy urządzeń.' : 'Nie znaleziono urządzeń.'}
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="mt-8 w-full overflow-hidden px-1">
          <div className="mx-auto flex w-full max-w-full items-center justify-between gap-2 rounded-2xl border border-white/5 bg-[#111623]/50 p-2 shadow-lg sm:w-fit sm:justify-center sm:gap-1.5">
            <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safeCurrentPage === 1} className="shrink-0 p-2 text-slate-500 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-0 flex-1 overflow-x-auto sm:flex-none">
              <div className="hidden min-w-max items-center justify-center gap-1.5 sm:flex">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button key={i} onClick={() => setCurrentPage(i + 1)} className={cn('w-10 h-10 rounded-xl font-bold text-sm flex items-center justify-center transition-all cursor-pointer', safeCurrentPage === i + 1 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'text-slate-400 hover:bg-white/5 hover:text-white border border-transparent')}>
                    {i + 1}
                  </button>
                ))}
              </div>
              <div className="flex h-10 items-center justify-center rounded-xl border border-white/5 bg-black/10 px-4 text-xs font-black uppercase tracking-widest text-slate-300 sm:hidden">
                {safeCurrentPage} / {totalPages}
              </div>
            </div>
            <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safeCurrentPage === totalPages} className="shrink-0 p-2 text-slate-500 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
