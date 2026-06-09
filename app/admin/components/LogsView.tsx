import { useState, useMemo, useEffect, useRef } from 'react';
import { Search, ChevronDown, Calendar, RefreshCcw, LogIn, MonitorOff, ShieldAlert, UserCog, PowerOff, MapPin, Menu, Trash2, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Log } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { warsawDateKey } from '@/lib/format-device-label';

function logCreatedMs(log: Log): number {
  if (typeof log.createdAtMs === 'number' && !Number.isNaN(log.createdAtMs)) return log.createdAtMs;
  return Date.now();
}

function warsawYesterdayKey(nowMs: number): string {
  const today = warsawDateKey(nowMs);
  let t = nowMs;
  for (let i = 0; i < 48; i++) {
    t -= 3600000;
    if (warsawDateKey(t) !== today) return warsawDateKey(t);
  }
  return warsawDateKey(nowMs - 86400000);
}

function warsawYearMonth(ms: number): string {
  return warsawDateKey(ms).slice(0, 7);
}

function warsawPreviousYearMonth(nowMs: number): string {
  const cur = warsawYearMonth(nowMs);
  let t = nowMs;
  for (let i = 0; i < 800; i++) {
    t -= 3600000;
    if (warsawYearMonth(t) !== cur) return warsawYearMonth(t);
  }
  return cur;
}

function matchesDateFilter(
  filterDate: string,
  createdAtMs: number,
  customRange: { start: string; end: string },
): boolean {
  const now = Date.now();
  const logKey = warsawDateKey(createdAtMs);

  if (filterDate === 'TODAY') return logKey === warsawDateKey(now);
  if (filterDate === 'YESTERDAY') return logKey === warsawYesterdayKey(now);
  if (filterDate === 'THIS_WEEK') return createdAtMs >= now - 7 * 86400000;
  if (filterDate === 'LAST_WEEK') return createdAtMs < now - 7 * 86400000 && createdAtMs >= now - 14 * 86400000;
  if (filterDate === 'THIS_MONTH') return logKey.slice(0, 7) === warsawYearMonth(now);
  if (filterDate === 'LAST_MONTH') return logKey.slice(0, 7) === warsawPreviousYearMonth(now);
  if (filterDate === 'CUSTOM' && customRange.start && customRange.end) {
    return logKey >= customRange.start && logKey <= customRange.end;
  }
  return true;
}

export function LogsView({
  onMenuClick,
  logs,
  subscriptionError,
  canClearLogs = false,
  onClearLogs,
}: {
  onMenuClick: () => void;
  logs: Log[];
  subscriptionError?: string | null;
  canClearLogs?: boolean;
  onClearLogs?: () => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [filterOp, setFilterOp] = useState('Wszyscy');
  const [filterDate, setFilterDate] = useState('ALL');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isClearingLogs, setIsClearingLogs] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearLogsError, setClearLogsError] = useState<string | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  
  const [visibleCount, setVisibleCount] = useState(5);

  const toggleTypeFilter = () => {
    setShowFilterDropdown((open) => {
      const nextOpen = !open;
      if (nextOpen) setShowDatePicker(false);
      return nextOpen;
    });
  };

  const toggleDateFilter = () => {
    setShowDatePicker((open) => {
      const nextOpen = !open;
      if (nextOpen) setShowFilterDropdown(false);
      return nextOpen;
    });
  };

  useEffect(() => {
    if (!showFilterDropdown && !showDatePicker) return;

    const closeOnOutsidePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && filtersRef.current?.contains(target)) return;
      setShowFilterDropdown(false);
      setShowDatePicker(false);
    };

    document.addEventListener('mousedown', closeOnOutsidePointer);
    document.addEventListener('touchstart', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      document.removeEventListener('touchstart', closeOnOutsidePointer);
    };
  }, [showFilterDropdown, showDatePicker]);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const term = search.toLowerCase();
      const searchMatch = log.title.toLowerCase().includes(term) || log.description.toLowerCase().includes(term);
      
      let typeMatch = true;
      if (filterType !== 'ALL') typeMatch = log.category === filterType;

      const dateMatch =
        filterDate === 'ALL' ? true : matchesDateFilter(filterDate, logCreatedMs(log), customRange);

      return searchMatch && typeMatch && dateMatch;
    });
  }, [logs, search, filterType, filterDate, customRange]);

  const visibleLogs = useMemo(() => filteredLogs.slice(0, visibleCount), [filteredLogs, visibleCount]);

  const handleClearLogs = async () => {
    if (!onClearLogs || isClearingLogs) return;
    setClearLogsError(null);
    setShowClearConfirm(true);
  };

  const confirmClearLogs = async () => {
    if (!onClearLogs || isClearingLogs) return;
    setIsClearingLogs(true);
    setClearLogsError(null);
    try {
      await onClearLogs();
      setShowClearConfirm(false);
      setVisibleCount(5);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setClearLogsError(message || 'Nie udało się wyczyścić logów.');
    } finally {
      setIsClearingLogs(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#040609] p-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] sm:p-8 sm:pb-[calc(env(safe-area-inset-bottom)+4rem)]">
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="fixed left-0 right-0 top-4 z-[100] flex justify-center px-4"
          >
            <div className="relative w-full max-w-sm overflow-hidden rounded-[1.25rem] border border-white/5 bg-[#0F131D]/95 p-4 shadow-2xl shadow-[0_10px_40px_rgba(244,63,94,0.15)] backdrop-blur-xl">
              <div className="absolute bottom-0 left-0 top-0 w-1 bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,1)]" />
              <div className="flex gap-4 pl-2">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/10 text-rose-400">
                  <Trash2 size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-sm font-bold leading-tight text-white">Wyczyścić logi?</div>
                  <div className="text-[13px] font-medium leading-snug text-slate-400">Tej operacji nie da się cofnąć.</div>
                </div>
              </div>
              {clearLogsError && (
                <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[12px] font-semibold leading-snug text-rose-100">
                  Nie udało się usunąć logów: {clearLogsError}
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2 pl-2">
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  disabled={isClearingLogs}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300 transition-all hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={14} />
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={confirmClearLogs}
                  disabled={isClearingLogs}
                  className="flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/15 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-rose-200 transition-all hover:bg-rose-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check size={14} />
                  {isClearingLogs ? 'Czyszczenie' : 'Potwierdź'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="max-w-4xl mx-auto space-y-6">
        {subscriptionError && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <span className="font-bold">Błąd odczytu logów: </span>
            {subscriptionError}
          </div>
        )}

        {/* Header */}
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onMenuClick}
              className="lg:hidden w-11 h-11 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all active:scale-95 cursor-pointer"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-lg font-bold text-white uppercase tracking-wider">Logi aktywności</h1>
                <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">Rejestr zdarzeń systemowych</p>
              </div>
            </div>
          </div>

          {canClearLogs && (
            <button
              type="button"
              disabled={isClearingLogs || logs.length === 0}
              onClick={handleClearLogs}
              className={cn(
                'hidden items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-[10px] font-black uppercase tracking-widest shadow-lg transition-all sm:flex sm:w-auto',
                isClearingLogs || logs.length === 0
                  ? 'cursor-not-allowed border-white/5 bg-white/5 text-slate-600'
                  : 'cursor-pointer border-rose-500/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500 hover:text-white active:scale-95',
              )}
              title={logs.length === 0 ? 'Brak logów do usunięcia' : 'Wyczyść wszystkie logi'}
            >
              <Trash2 size={15} />
              {isClearingLogs ? 'Czyszczenie...' : 'Wyczyść logi'}
            </button>
          )}
        </div>

        {/* Filters Top */}
        <div ref={filtersRef} className="grid grid-cols-2 gap-4">
          <div className="relative">
            <button 
              onClick={toggleTypeFilter}
              className="w-full flex items-center justify-between gap-2 bg-[#111623] border border-white/10 rounded-2xl px-4 py-3.5 transition-all hover:bg-white/5 hover:border-white/20 cursor-pointer overflow-hidden group shadow-lg"
            >
              <span className="text-[11px] sm:text-xs font-black uppercase tracking-widest text-slate-300 truncate">
                {filterType === 'ALL' ? 'Wszystkie typy' : filterType === 'SYSTEM' ? 'Systemowe' : 'Operatorskie'}
              </span>
              <ChevronDown size={14} className={cn("text-slate-500 shrink-0 group-hover:text-white transition-all duration-300", showFilterDropdown && "rotate-180")} />
            </button>
            <AnimatePresence>
              {showFilterDropdown && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  className="absolute top-full left-0 right-0 mt-2 bg-[#111623] border border-white/10 rounded-2xl overflow-hidden z-20 shadow-2xl p-1.5 flex flex-col gap-1"
                >
                  <button onClick={() => { setFilterType('ALL'); setShowFilterDropdown(false); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer">Wszystkie typy</button>
                  <button onClick={() => { setFilterType('SYSTEM'); setShowFilterDropdown(false); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer">Tylko Systemowe</button>
                  <button onClick={() => { setFilterType('OPERATOR'); setShowFilterDropdown(false); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer">Tylko Operatorskie</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="relative">
            <button 
              onClick={toggleDateFilter}
              className="w-full flex items-center justify-between gap-2 bg-[#111623] border border-white/10 rounded-2xl px-4 py-3.5 transition-all hover:bg-white/5 hover:border-white/20 cursor-pointer overflow-hidden group shadow-lg"
            >
              <span className="text-[11px] sm:text-xs font-black uppercase tracking-widest text-slate-300 truncate">
                {filterDate === 'ALL' ? 'Wszystkie daty' : 
                 filterDate === 'TODAY' ? 'Dzisiaj' : 
                 filterDate === 'YESTERDAY' ? 'Wczoraj' : 
                 filterDate === 'THIS_WEEK' ? 'W tym tygodniu' : 
                 filterDate === 'LAST_WEEK' ? 'Poprzedni tydzień' : 
                 filterDate === 'THIS_MONTH' ? 'W tym miesiącu' : 
                 filterDate === 'LAST_MONTH' ? 'Poprzedni miesiąc' : 
                 'Niestandardowy'}
              </span>
              <Calendar size={14} className="text-slate-500 shrink-0 group-hover:text-white transition-colors" />
            </button>
            <AnimatePresence>
              {showDatePicker && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: -5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -5 }}
                  className="absolute top-full right-0 mt-2 w-72 sm:w-80 bg-[#111623] border border-white/10 rounded-2xl z-30 shadow-2xl p-2 flex flex-col max-h-[80vh] overflow-y-auto"
                >
                  <div className="p-1 space-y-1">
                    <button onClick={() => { setFilterDate('ALL'); setShowDatePicker(false); }} className={cn("w-full text-left px-4 py-2.5 text-sm font-medium rounded-xl hover:bg-white/5 transition-all cursor-pointer", filterDate === 'ALL' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400')}>Wszystkie daty</button>
                    <button onClick={() => { setFilterDate('TODAY'); setShowDatePicker(false); }} className={cn("w-full text-left px-4 py-2.5 text-sm font-medium rounded-xl hover:bg-white/5 transition-all cursor-pointer", filterDate === 'TODAY' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400')}>Dzisiaj</button>
                    <button onClick={() => { setFilterDate('YESTERDAY'); setShowDatePicker(false); }} className={cn("w-full text-left px-4 py-2.5 text-sm font-medium rounded-xl hover:bg-white/5 transition-all cursor-pointer", filterDate === 'YESTERDAY' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400')}>Wczoraj</button>
                    <button onClick={() => { setFilterDate('THIS_WEEK'); setShowDatePicker(false); }} className={cn("w-full text-left px-4 py-2.5 text-sm font-medium rounded-xl hover:bg-white/5 transition-all cursor-pointer", filterDate === 'THIS_WEEK' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400')}>W tym tygodniu</button>
                    <button onClick={() => { setFilterDate('LAST_WEEK'); setShowDatePicker(false); }} className={cn("w-full text-left px-4 py-2.5 text-sm font-medium rounded-xl hover:bg-white/5 transition-all cursor-pointer", filterDate === 'LAST_WEEK' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400')}>W tamtym tygodniu</button>
                    <button onClick={() => { setFilterDate('THIS_MONTH'); setShowDatePicker(false); }} className={cn("w-full text-left px-4 py-2.5 text-sm font-medium rounded-xl hover:bg-white/5 transition-all cursor-pointer", filterDate === 'THIS_MONTH' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400')}>W tym miesiącu</button>
                    <button onClick={() => { setFilterDate('LAST_MONTH'); setShowDatePicker(false); }} className={cn("w-full text-left px-4 py-2.5 text-sm font-medium rounded-xl hover:bg-white/5 transition-all cursor-pointer", filterDate === 'LAST_MONTH' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400')}>W tamtym miesiącu</button>
                    <button onClick={() => { setFilterDate('CUSTOM'); }} className={cn("w-full text-left px-4 py-2.5 text-sm font-medium rounded-xl hover:bg-white/5 transition-all cursor-pointer", filterDate === 'CUSTOM' ? 'bg-sky-500/10 text-sky-400' : 'text-slate-400')}>Zakres niestandardowy</button>
                  </div>

                  <AnimatePresence>
                    {filterDate === 'CUSTOM' && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="px-2 pb-2 mt-1 bg-black/20 rounded-2xl overflow-hidden"
                      >
                         <div className="p-2 space-y-4">
                            <div className="grid grid-cols-1 gap-3">
                               <div>
                                  <label className="text-[10px] text-slate-500 uppercase tracking-widest font-black mb-1.5 block px-1">Początek zakresu</label>
                                  <input type="date" className="w-full bg-[#111623] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-sky-500/50 outline-none transition-all flex justify-between items-center" value={customRange.start} onChange={e => setCustomRange({...customRange, start: e.target.value})} />
                               </div>
                               <div>
                                  <label className="text-[10px] text-slate-500 uppercase tracking-widest font-black mb-1.5 block px-1">Koniec zakresu</label>
                                  <input type="date" className="w-full bg-[#111623] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-sky-500/50 outline-none transition-all flex justify-between items-center" value={customRange.end} onChange={e => setCustomRange({...customRange, end: e.target.value})} />
                               </div>
                            </div>
                            <div className="px-1 pt-1">
                               <button 
                                 onClick={() => setShowDatePicker(false)} 
                                 className="w-full bg-sky-500 hover:bg-sky-400 text-white rounded-xl py-2.5 text-[10px] font-black uppercase tracking-widest transition-all shadow-lg active:scale-[0.98] cursor-pointer"
                               >
                                 Zastosuj okres
                               </button>
                            </div>
                         </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Szukaj w logach aktywności..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-[#111623] border border-white/10 rounded-2xl py-3.5 pl-10 pr-4 text-sm font-medium text-white placeholder-slate-500 focus:outline-none focus:border-white/20 transition-all shadow-inner"
            />
          </div>
          {canClearLogs && (
            <button
              type="button"
              disabled={isClearingLogs || logs.length === 0}
              onClick={handleClearLogs}
              className={cn(
                'ml-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-lg transition-all sm:hidden',
                isClearingLogs || logs.length === 0
                  ? 'cursor-not-allowed border-white/5 bg-white/5 text-slate-600'
                  : 'cursor-pointer border-rose-500/25 bg-rose-500/10 text-rose-300 hover:bg-rose-500 hover:text-white active:scale-95',
              )}
              aria-label={logs.length === 0 ? 'Brak logów do usunięcia' : 'Wyczyść wszystkie logi'}
              title={logs.length === 0 ? 'Brak logów do usunięcia' : 'Wyczyść wszystkie logi'}
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>

        {/* List */}
        <div className="space-y-4 pt-2">
          <AnimatePresence mode="popLayout">
            {visibleLogs.length === 0 ? (
               <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12 text-slate-500 text-sm bg-[#111623] rounded-3xl border border-white/5"
               >
                  Nie znaleziono logów spełniających kryteria wyszukiwania.
               </motion.div>
            ) : (
              visibleLogs.map((log, idx) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.03 }}
                >
                  <LogCard log={log} />
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

        {visibleCount < filteredLogs.length && (
          <button 
            onClick={() => setVisibleCount(c => c + 5)}
            className="w-full text-center py-5 bg-[#111623] hover:bg-white/[0.03] border border-white/5 hover:border-t-white/10 rounded-2xl text-xs sm:text-sm font-black uppercase tracking-widest text-slate-400 hover:text-white transition-all flex items-center justify-center gap-3 mt-6 shadow-xl active:scale-[0.98] cursor-pointer"
          >
            Pokaż więcej wpisów ({filteredLogs.length - visibleCount}) <ChevronDown size={18} className="translate-y-0.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function LogCard({ log }: { log: Log }) {
  const getIcon = (type: string) => {
    switch(type) {
      case 'connect': return { icon: <RefreshCcw size={18} className="text-emerald-400" />, bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
      case 'login': return { icon: <LogIn size={18} className="text-purple-400" />, bg: 'bg-purple-500/10', border: 'border-purple-500/20' };
      case 'gps_lost': return { icon: <ShieldAlert size={18} className="text-amber-400" />, bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
      case 'ban': return { icon: <MonitorOff size={18} className="text-rose-400" />, bg: 'bg-rose-500/10', border: 'border-rose-500/20' };
      case 'role_change': return { icon: <UserCog size={18} className="text-sky-400" />, bg: 'bg-sky-500/10', border: 'border-sky-500/20' };
      case 'disconnect': return { icon: <PowerOff size={18} className="text-emerald-400" />, bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
      case 'gps_spoof': return { icon: <MapPin size={18} className="text-amber-400" />, bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
      case 'edit_role': return { icon: <UserCog size={18} className="text-sky-400" />, bg: 'bg-sky-500/10', border: 'border-sky-500/20' };
      default: return { icon: <RefreshCcw size={18} className="text-slate-400" />, bg: 'bg-slate-500/10', border: 'border-slate-500/20' };
    }
  };

  const style = getIcon(log.iconType);

  return (
    <div className="bg-[#111623] hover:bg-white/[0.02] border border-white/5 hover:border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 transition-all group shadow-inner">
      <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-all group-hover:scale-110 group-hover:rotate-6 duration-300 shadow-lg", style.bg, style.border, "border")}>
        {style.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-sm sm:text-base font-bold text-slate-200 group-hover:text-white transition-colors truncate tracking-tight">{log.title}</h3>
          <div className={cn("text-[9px] uppercase tracking-widest font-black px-2.5 py-1 rounded-lg border shrink-0",
            log.category === 'SYSTEM' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]" : "bg-purple-500/10 text-purple-400 border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.1)]"
          )}>
            {log.category}
          </div>
        </div>
        <p className="text-sm text-slate-400 whitespace-pre-line leading-relaxed group-hover:text-slate-300 transition-colors font-medium">{log.description}</p>
        
        {log.location && (
          <div className="mt-3.5 flex items-center gap-2 text-[11px] font-mono font-bold text-slate-500 bg-black/20 inline-flex px-3 py-1.5 rounded-xl border border-white/5">
             <MapPin size={12} className="text-slate-400" />
             {log.location}
          </div>
        )}
      </div>

      <div className="sm:text-right shrink-0 flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 sm:border-l border-white/5 pt-4 sm:pt-0 sm:pl-6 mt-2 sm:mt-0 transition-colors group-hover:border-white/10">
        <div>
           <div className="text-sm font-black text-slate-200 group-hover:text-white transition-colors">{log.time}</div>
           <div className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-wider">{log.date || 'Archiwalne'}</div>
        </div>
        {log.timeAgo ? (
          <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 transition-colors sm:mt-3 rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5">
            {log.timeAgo}
          </div>
        ) : null}
      </div>
    </div>
  );
}
