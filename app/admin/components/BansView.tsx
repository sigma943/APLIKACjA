import { useState, useMemo } from 'react';
import { Search, Filter, Lock, LockOpen, Smartphone, ChevronDown, Menu, Calendar, Info, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Ban } from '../types';
import { motion, AnimatePresence } from 'motion/react';

export interface BanDashboardStats {
  activeBans: number;
  expireToday: number;
  everWithBanDetails: number;
}

export function BansView({
  bans,
  stats,
  canBan = true,
  onUnblock,
  onMenuClick,
}: {
  bans: Ban[];
  stats: BanDashboardStats;
  /** Odblokowanie wymaga uprawnienia ban (jak przy banowaniu). */
  canBan?: boolean;
  onUnblock: (id: string) => void;
  onMenuClick: () => void;
}) {
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCount, setVisibleCount] = useState(3);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const filtersRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showFilters) return;

    const closeOnOutsidePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && filtersRef.current?.contains(target)) return;
      setShowFilters(false);
    };

    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('touchstart', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('touchstart', closeOnOutsidePointer);
    };
  }, [showFilters]);

  const filteredBans = useMemo(() => {
    return bans.filter((ban) => {
      const searchMatch =
        ban.deviceName.toLowerCase().includes(search.toLowerCase()) ||
        ban.deviceId.toLowerCase().includes(search.toLowerCase());

      let statusMatch = true;
      if (filterStatus !== 'ALL') {
        statusMatch = (ban.kind || '').toUpperCase() === filterStatus.toUpperCase();
      }

      return searchMatch && statusMatch;
    });
  }, [bans, search, filterStatus]);

  const visibleBans = useMemo(() => filteredBans.slice(0, visibleCount), [filteredBans, visibleCount]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#040609] p-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] sm:p-8 sm:pb-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={onMenuClick}
            className="lg:hidden w-11 h-11 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-white uppercase tracking-wider">Bany / Blokady</h1>
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">Ograniczenia dostępu</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard title="Aktywne bany" value={String(stats.activeBans)} subtitle="Obecnie zablokowane" icon={<Lock size={16} />} color="rose" />
          <StatCard title="Wygasną dziś" value={String(stats.expireToday)} subtitle="Wygasają przed północą" icon={<Calendar size={16} />} color="amber" />
          <StatCard title="Z historią banu" value={String(stats.everWithBanDetails)} subtitle="Mają zapisane banDetails" icon={<Info size={16} />} color="slate" />
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="text"
              placeholder="Szukaj urządzenia lub ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#111623] border border-white/10 rounded-2xl py-3.5 pl-12 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-white/20 transition-all shadow-inner"
            />
          </div>
          <div ref={filtersRef} className="relative shrink-0">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 bg-[#111623] border border-white/10 hover:bg-white/5 px-4 sm:px-5 py-3.5 rounded-2xl text-sm font-bold text-slate-300 transition-all h-full cursor-pointer active:scale-95 shadow-lg"
            >
              Filtry
              <Filter size={16} className={cn('transition-transform duration-300', showFilters && 'rotate-180')} />
            </button>
            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  className="absolute right-0 top-full mt-2 w-56 bg-[#111623] border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-20 p-1.5 flex flex-col gap-1"
                >
                  <button onClick={() => { setFilterStatus('PERMANENTNY'); setShowFilters(false); }} className="w-full text-left px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer">Permanentne</button>
                  <button onClick={() => { setFilterStatus('CZASOWY'); setShowFilters(false); }} className="w-full text-left px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer">Czasowe</button>
                  <button onClick={() => { setFilterStatus('ALL'); setShowFilters(false); }} className="w-full text-left px-4 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer">Wszystkie</button>
                  <div className="border-t border-white/5 my-1" />
                  <button onClick={() => { setFilterStatus('ALL'); setSearch(''); setShowFilters(false); }} className="w-full px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer text-center">Wyczyść filtry</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <AnimatePresence mode="popLayout">
            {visibleBans.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16 text-slate-500 text-sm font-medium bg-[#111623] rounded-3xl border border-white/5"
              >
                Brak zablokowanych urządzeń dla podanych filtrów.
              </motion.div>
            ) : (
              visibleBans.map((ban, idx) => (
                <motion.div
                  key={ban.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <BanCard ban={ban} canBan={canBan} onUnblock={() => onUnblock(ban.id)} />
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

        {visibleCount < filteredBans.length && (
          <button
            onClick={() => setVisibleCount((c) => c + 3)}
            className="w-full text-center py-5 bg-[#111623] border border-white/5 hover:border-white/10 rounded-2xl text-sm font-black uppercase tracking-widest text-slate-400 hover:text-white transition-all flex items-center justify-center gap-3 mt-4 active:scale-[0.98] cursor-pointer shadow-xl"
          >
            Pokaż więcej banów ({filteredBans.length - visibleCount}) <ChevronDown size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, color }: any) {
  const colorMap = {
    rose: 'border-rose-500/20 text-rose-400 shadow-rose-500/5',
    amber: 'border-amber-500/20 text-amber-400 shadow-amber-500/5',
    slate: 'border-slate-500/20 text-slate-400 shadow-slate-500/5',
  };

  return (
    <div className={cn('relative bg-[#111623] border rounded-2xl p-4 flex flex-col items-start shadow-lg transition-all hover:bg-white/[0.03] cursor-default group overflow-hidden', colorMap[color as keyof typeof colorMap])}>
      <div className="absolute top-3 right-3 opacity-20">{icon}</div>
      <div className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-500 mb-1">{title}</div>
      <div className="text-2xl font-black tracking-tight text-white mb-1 font-mono">{value}</div>
      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{subtitle}</div>
    </div>
  );
}

function BanCard({ ban, canBan, onUnblock }: { ban: Ban; canBan: boolean; onUnblock: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-[#111623] border border-white/5 border-t-white/10 rounded-3xl overflow-hidden hover:border-emerald-500/20 transition-all shadow-2xl group relative">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center shrink-0 shadow-lg group-hover:scale-105 transition-all duration-500">
              <Smartphone className="text-slate-400 group-hover:text-emerald-400 transition-colors" size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm sm:text-base font-bold text-white mb-0.5 truncate tracking-tight">{ban.deviceName}</div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono font-bold text-slate-500">
                <span className="min-w-0 break-all">ID: {ban.deviceId}</span>
                <span className="w-1 h-1 rounded-full bg-slate-700" />
                <span className="flex min-w-0 items-center gap-1 break-words"><MapPin size={10} className="shrink-0" /> {ban.location}</span>
                {ban.autoBan && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-slate-700" />
                    <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[9px] uppercase tracking-widest text-amber-300">Auto-ban</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-xl border whitespace-nowrap', ban.status === 'AKTYWNY' ? 'bg-rose-500/10 border-rose-500/20' : 'bg-slate-500/10 border-slate-500/20')}>
              <div className={cn('w-1 h-1 rounded-full', ban.status === 'AKTYWNY' ? 'bg-rose-500' : 'bg-slate-500')} />
              <span className={cn('text-[10px] font-black tracking-widest uppercase', ban.status === 'AKTYWNY' ? 'text-rose-400' : 'text-slate-400')}>{ban.status}</span>
            </div>
            <div className="text-right">
              <div className="text-[9px] font-black uppercase tracking-widest text-slate-600">Czas blokady</div>
              <div className={cn('max-w-[11rem] break-words text-xs font-black tracking-tight', ban.status === 'AKTYWNY' ? 'text-rose-500' : 'text-slate-500')}>{ban.expireIn}</div>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: 'auto', marginTop: 16 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 gap-4 rounded-2xl border border-white/5 bg-black/20 p-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-600">Powód</div>
                  <div className="break-words text-xs font-medium leading-relaxed text-slate-400 italic">&quot;{ban.reason}&quot;</div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-600">Przez</div>
                  <div className="break-words text-xs font-bold text-slate-300">{ban.bannedBy}</div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-600">Data</div>
                  <div className="break-words text-xs font-bold text-slate-300">{ban.date}</div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 pt-4 border-t border-white/5 flex gap-3">
          <button
            type="button"
            disabled={!canBan}
            title={canBan ? 'Odblokuj urządzenie' : undefined}
            onClick={() => canBan && onUnblock()}
            className={cn('group/unlock flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/20 py-2.5 text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/5 transition-all', canBan ? 'cursor-pointer bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white active:scale-95' : 'cursor-not-allowed bg-white/5 text-slate-600 opacity-50')}
          >
            <LockOpen size={14} className={cn('transition-transform', canBan && 'group-hover:rotate-12')} />
            Odblokuj
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-400 hover:text-white transition-all cursor-pointer group/btn"
            title={expanded ? 'Zwiń' : 'Szczegóły'}
          >
            <ChevronDown size={18} className={cn('transition-transform duration-300', expanded && 'rotate-180')} />
          </button>
        </div>
      </div>
    </div>
  );
}
