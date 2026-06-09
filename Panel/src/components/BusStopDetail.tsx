import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, MapPin, Star, Navigation, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Stop, Departure } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { getLineStyle } from '../utils/lineStyles';
import { formatPublicStopName } from '@/lib/stop-display';

const INITIAL_DEPARTURE_LIMIT = 5;
const EXPANDED_DEPARTURE_BATCH = 28;

interface BusStopDetailProps {
  stop: Stop;
  onBack: () => void;
  toggleFavorite: (stopId: string) => void;
  loadDepartures: (stop: Stop, dayIndex?: number) => Promise<Departure[]>;
  onShowOnMap?: (stop: Stop) => void;
  isDarkTheme?: boolean;
}

function getDynamicDays() {
  const weekdaysPl = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
  const labelsPl = ['Nie', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
  
  const days = [];
  const now = new Date();
  
  for (let i = 0; i < 7; i++) {
    const futureDate = new Date(now);
    futureDate.setDate(now.getDate() + i);
    
    const dayName = weekdaysPl[futureDate.getDay()];
    let label = labelsPl[futureDate.getDay()];
    if (i === 0) label = 'Dziś';
    if (i === 1) label = 'Jutro';
    
    const weekdayKeys: Record<number, string> = {
      0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat'
    };
    const key = i === 0 ? 'today' : i === 1 ? 'tomorrow' : weekdayKeys[futureDate.getDay()];
    
    days.push({
      label,
      dayNum: String(futureDate.getDate()),
      weekday: dayName,
      key,
      monthName: futureDate.toLocaleDateString('pl-PL', { month: 'long' }),
      monthYear: futureDate.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' })
    });
  }
  return days;
}

export default function BusStopDetail({ stop, onBack, toggleFavorite, loadDepartures, onShowOnMap, isDarkTheme = true }: BusStopDetailProps) {
  const [days] = useState(getDynamicDays);
  const [selectedLine, setSelectedLine] = useState<string>('all');
  const [showAllDepartures, setShowAllDepartures] = useState(false);
  const [visibleDepartureLimit, setVisibleDepartureLimit] = useState(INITIAL_DEPARTURE_LIMIT);
  const [selectedDay, setSelectedDay] = useState<string>('today');
  const [showPastDepartures, setShowPastDepartures] = useState<boolean>(false);
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [isFetchingLive, setIsFetchingLive] = useState<boolean>(false);
  const [animateDepartures, setAnimateDepartures] = useState<boolean>(true);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadDeparturesRef = useRef(loadDepartures);
  const hasLoadedOnceRef = useRef(false);
  const loadedDayKeysRef = useRef<Set<string>>(new Set());
  const departuresRequestStop = useMemo(() => ({
    id: stop.id,
    name: stop.name,
    type: stop.type,
    carriers: stop.carriers,
    lines: stop.lines,
    isFavorite: false,
    areaId: stop.areaId,
    code: stop.code,
    lat: stop.lat,
    lon: stop.lon,
    sourceProviderIds: stop.sourceProviderIds,
    providerStopIds: stop.providerStopIds,
  }), [stop.areaId, stop.carriers, stop.code, stop.id, stop.lat, stop.lines, stop.lon, stop.name, stop.providerStopIds, stop.sourceProviderIds, stop.type]);

  useEffect(() => {
    loadDeparturesRef.current = loadDepartures;
  }, [loadDepartures]);

  useEffect(() => {
    const updateTime = () => {
      setCurrentTimeMs(Date.now());
    };
    updateTime();
    const interval = setInterval(updateTime, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const activeEl = scrollContainerRef.current.querySelector('[data-selected="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center'
        });
      }
    }
  }, [selectedDay]);

  useEffect(() => {
    setShowAllDepartures(false);
    setVisibleDepartureLimit(INITIAL_DEPARTURE_LIMIT);
    setShowPastDepartures(false);
  }, [selectedDay, selectedLine, stop.id]);

  useEffect(() => {
    let active = true;
    const selectedDayIndex = Math.max(0, days.findIndex(d => d.key === selectedDay));
    const loadKey = `${stop.id}:${selectedDayIndex}`;
    const hasLoadedSelectedDay = loadedDayKeysRef.current.has(loadKey);
    const resetTimer = window.setTimeout(() => {
      if (!active) return;
      setIsLive(false);
      if (!hasLoadedSelectedDay) {
        setIsFetchingLive(false);
        setIsLoading(true);
        setDepartures([]);
      } else {
        setIsFetchingLive(true);
        setIsLoading(false);
      }
    }, 0);
    const runRefresh = (initial = false) => {
      if (!initial || hasLoadedSelectedDay) setIsFetchingLive(true);
      loadDeparturesRef.current(departuresRequestStop, selectedDayIndex)
      .then(loadedDepartures => {
        if (active) {
          loadedDayKeysRef.current.add(loadKey);
          setDepartures(loadedDepartures);
          setIsLive(loadedDepartures.length > 0);
          setIsLoading(false);
          setIsFetchingLive(false);
          if (!hasLoadedOnceRef.current) {
            hasLoadedOnceRef.current = true;
          } else {
            setAnimateDepartures(false);
          }
        }
      })
      .catch(err => {
        console.error("Error keeping departures in sync:", err);
        if (active) {
          setDepartures([]);
          setIsLive(false);
          setIsLoading(false);
          setIsFetchingLive(false);
        }
      });
    };

    runRefresh(true);
    const interval = window.setInterval(() => runRefresh(false), 30_000);

    return () => {
      active = false;
      window.clearTimeout(resetTimer);
      window.clearInterval(interval);
    };
  }, [days, departuresRequestStop, selectedDay, stop.id]);

  const refreshLiveDepartures = () => {
    setIsFetchingLive(true);
    
    const selectedDayIndex = Math.max(0, days.findIndex(d => d.key === selectedDay));
    loadDeparturesRef.current(departuresRequestStop, selectedDayIndex)
      .then(loadedDepartures => {
        setDepartures(loadedDepartures);
        setIsLive(loadedDepartures.length > 0);
        setIsFetchingLive(false);
      })
      .catch(err => {
        console.error("Manual refresh error:", err);
        setIsLive(false);
        setIsFetchingLive(false);
      });
  };

  const stopLines = stop.lines || [];
  const displayStopName = formatPublicStopName(stop);
  const uniqueLinesFromDeps = Array.from(new Set(departures.map(d => d.line))).filter(Boolean);
  const combinedLines = Array.from(new Set([...stopLines, ...uniqueLinesFromDeps])).filter(Boolean);
  const lines = ['Wszystkie', ...combinedLines.filter(l => l !== 'Wszystkie')];
  const lineProviderIds = useMemo(() => {
    const map = new Map<string, string>();
    if (stop.carriers.length === 1) {
      stopLines.forEach((line) => map.set(line, stop.carriers[0].id));
    }
    departures.forEach((departure) => {
      if (departure.carrier?.id) map.set(departure.line, departure.carrier.id);
    });
    return map;
  }, [departures, stop.carriers, stopLines]);

  const isPastDeparture = (timeStr: string) => {
    if (selectedDay !== 'today') return false;
    const byTimestamp = processedTimeForDeparture(timeStr);
    if (!currentTimeMs) return false;
    if (Number.isFinite(byTimestamp)) return byTimestamp < currentTimeMs;
    const now = new Date(currentTimeMs);
    const currentH = now.getHours();
    const currentM = now.getMinutes();
    const [h, m] = timeStr.split(':').map(Number);
    return (h * 60 + m) < (currentH * 60 + currentM);
  };

  const selectedDayIndex = Math.max(0, days.findIndex(d => d.key === selectedDay));
  const selectedDateKey = (() => {
    const day = new Date();
    day.setDate(day.getDate() + selectedDayIndex);
    return day.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' });
  })();

  const processedTimeForDeparture = (timeStr: string, plannedAtMs?: number) => {
    if (Number.isFinite(plannedAtMs)) return plannedAtMs as number;
    const [h, m] = timeStr.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
    const day = new Date();
    day.setDate(day.getDate() + selectedDayIndex);
    day.setHours(h, m, 0, 0);
    return day.getTime();
  };

  const processedDepartures = departures.map(d => ({
    ...d,
    isPast: (d as any).isPast !== undefined ? (d as any).isPast : isPastDeparture(d.time)
  })).filter(d => {
    if (!Number.isFinite(d.plannedAtMs)) return selectedDayIndex === 0;
    return new Date(d.plannedAtMs as number).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }) === selectedDateKey;
  });

  const filteredDeparturesByLine = processedDepartures.filter(d => {
    if (!selectedLine || selectedLine === 'all') return true;
    return d.line === selectedLine;
  });

  const activeDepartures = filteredDeparturesByLine.filter(d => showPastDepartures ? true : !d.isPast);
  const visibleLimit = showAllDepartures ? visibleDepartureLimit : INITIAL_DEPARTURE_LIMIT;
  const displayedDepartures = activeDepartures.slice(0, visibleLimit);
  const hasMoreDepartures = activeDepartures.length > displayedDepartures.length;
  const panelShellClass = isDarkTheme ? 'bg-[#05080c]/94 text-slate-200' : 'bg-white/96 text-slate-900';
  const headerShellClass = isDarkTheme ? 'bg-slate-900/96 border-white/10' : 'bg-white/98 border-slate-200';
  const surfaceClass = isDarkTheme ? 'bg-[#0d1622]/92 border-white/[0.08]' : 'bg-white/98 border-slate-200';
  const departuresCardClass = isDarkTheme ? 'bg-[#0b121e]/96 border-white/[0.10]' : 'bg-white border-slate-200';
  const headingTextClass = isDarkTheme ? 'text-white' : 'text-slate-900';
  const mutedTextClass = isDarkTheme ? 'text-slate-400' : 'text-slate-600';
  const subtleTextClass = isDarkTheme ? 'text-slate-500' : 'text-slate-500';
  const headerOverlayClass = isDarkTheme ? 'bg-[#05080c]/72' : 'bg-white/78';
  const headerGradientClass = isDarkTheme
    ? 'bg-gradient-to-bl from-teal-900/24 via-[#05080c]/22 to-[#05080c]/30'
    : 'bg-gradient-to-bl from-teal-100/40 via-white/40 to-cyan-50/45';
  const headerIconButtonClass = isDarkTheme
    ? 'text-white hover:bg-white/10 border-white/5 hover:border-white/10'
    : 'text-slate-700 hover:bg-slate-200/60 border-slate-300 hover:border-slate-400';
  const mapButtonClass = isDarkTheme
    ? 'bg-white/10 hover:bg-white/15 border-white/15 text-slate-100'
    : 'bg-white/70 hover:bg-white border-slate-300 text-slate-700';
  const dayInactiveClass = isDarkTheme
    ? 'bg-[#121f31]/40 text-slate-400 border-white/[0.03] hover:bg-white/[0.04] hover:text-slate-200'
    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-white hover:text-slate-800';
  const dayActiveClass = isDarkTheme
    ? 'bg-[#14b8a6]/15 text-teal-300 border-[#14b8a6]'
    : 'bg-teal-100 text-teal-700 border-teal-400/70';
  const rowClass = isDarkTheme
    ? 'hover:bg-white/[0.02]'
    : 'hover:bg-slate-100/65';
  const rowBorderClass = isDarkTheme ? 'border-white/[0.03]' : 'border-slate-200/95';
  const skeletonRowClass = isDarkTheme
    ? 'bg-white/[0.01] border-white/[0.01]'
    : 'bg-slate-100/85 border-slate-200';
  const skeletonBlockClass = isDarkTheme ? 'bg-white/5' : 'bg-slate-200';
  const formatDepartureTime = (departure: Departure) => {
    if (selectedDay !== 'today') return departure.time;
    if (!currentTimeMs) return departure.time;
    const departureMs = Number(departure.realAtMs || departure.plannedAtMs);
    if (!Number.isFinite(departureMs)) return departure.time;
    const diffMs = departureMs - currentTimeMs;
    if (diffMs < 0 || diffMs >= 30 * 60_000) return departure.time;
    if (diffMs < 60_000) return '<1 min';
    return `${Math.floor(diffMs / 60_000)} min`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 15 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 15 }}
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className={`h-full min-h-0 overflow-y-auto overscroll-contain font-sans pb-[calc(env(safe-area-inset-bottom)+9.5rem)] md:pb-8 backdrop-blur-2xl backdrop-saturate-150 ${panelShellClass}`}
    >
      <div className="w-full max-w-3xl min-w-0 mx-auto">
        {/* Header */}
        <div className={`relative pt-3 sm:pt-4 lg:pt-8 pb-4 px-3.5 sm:px-4 lg:px-8 border-b overflow-hidden backdrop-blur-2xl shadow-[0_20px_70px_rgba(0,0,0,0.20)] ${headerShellClass}`}>
          {/* Subtle background gradient */}
          <div className={`absolute inset-0 ${headerOverlayClass}`}></div>
          <div className={`absolute top-0 right-0 w-full h-full ${headerGradientClass}`}></div>
          
          {/* Top bar */}
          <div className="flex justify-between items-center mb-3 lg:mb-6 relative z-10 w-full">
            <button onClick={onBack} className={`p-1.5 -ml-1 rounded-full transition-colors flex-shrink-0 ${isDarkTheme ? 'text-white hover:bg-white/10' : 'text-slate-700 hover:bg-slate-200/60'}`}>
              <ArrowLeft size={22} />
            </button>
            
            <div className="flex items-center ml-auto gap-2">
              <button
                onClick={() => onShowOnMap?.(stop)}
                disabled={!onShowOnMap}
                className={`flex flex-shrink-0 items-center justify-center gap-1.5 h-8.5 px-2.5 sm:px-3 rounded-xl border text-[11px] font-bold transition-all duration-300 cursor-pointer shadow-md active:scale-95 leading-none hover:border-teal-500/40 font-sans backdrop-blur-xl disabled:cursor-not-allowed disabled:opacity-40 ${mapButtonClass}`}
              >
                <MapPin size={13} className="text-teal-400 animate-pulse" />
                <span>Pokaż na mapie</span>
              </button>
              <button 
                onClick={() => toggleFavorite(stop.id)} 
                className={`w-8.5 h-8.5 flex items-center justify-center rounded-xl transition-all duration-200 flex-shrink-0 cursor-pointer active:scale-90 border ${headerIconButtonClass}`}
              >
                <Star size={16} className={stop.isFavorite ? 'fill-[#f59e0b] text-[#f59e0b]' : 'text-slate-400'} />
              </button>
            </div>
          </div>

          {/* Stop Info */}
          <div className="relative z-10">
            <h1 className={`text-lg sm:text-2xl lg:text-3xl font-black mb-2 tracking-tight leading-tight break-words ${headingTextClass}`}>{displayStopName}</h1>
            
            <div className="flex flex-wrap gap-1">
              {[...stop.carriers].sort((a, b) => {
                const order = ['pks', 'mpk', 'marcel'];
                const idxA = order.indexOf(a.id);
                const idxB = order.indexOf(b.id);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
              }).map((c) => (
                <div key={c.id} className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold tracking-wider uppercase border ${c.bgClass} ${c.colorClass} ${c.borderClass}`}>
                  {c.name}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-3.5 sm:px-4 lg:px-8 mt-3 sm:mt-4 space-y-4 relative z-10">
          
          {/* Calendar Picker Swipable 7-Day Row */}
          <div className={`relative rounded-2xl p-2.5 sm:p-3 border shadow-md backdrop-blur-2xl ${surfaceClass}`}>
            <div className="flex justify-between items-center mb-2 px-1">
              <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-widest font-sans">Wybierz Dzień</h3>
              <span className="text-[9px] font-bold text-teal-400 bg-teal-400/10 px-2 py-0.5 rounded-full border border-teal-500/15 capitalize">
                {days.find(d => d.key === selectedDay)?.monthYear}
              </span>
            </div>
            
            <div
              ref={scrollContainerRef}
              className="flex gap-1.5 overflow-x-auto no-scrollbar py-1 snap-x select-none pointer-events-auto px-0 lg:justify-center"
            >
              {days.map((day) => {
                const isSelected = selectedDay === day.key;
                return (
                  <button
                    key={day.key}
                    onClick={() => setSelectedDay(day.key)}
                    data-selected={isSelected}
                    className={`flex-shrink-0 snap-start flex items-center gap-1.5 px-3 sm:px-3.5 py-2 rounded-full text-xs font-bold transition-all duration-300 cursor-pointer border ${
                      isSelected ? dayActiveClass : dayInactiveClass
                    }`}
                  >
                    <span className={`text-[10px] uppercase font-extrabold ${isSelected ? 'text-teal-500' : mutedTextClass}`}>
                      {day.label}
                    </span>
                    <span className="opacity-30 text-[9px]">•</span>
                    <span className={`text-[12px] font-black ${isSelected ? (isDarkTheme ? 'text-white' : 'text-slate-900') : (isDarkTheme ? 'text-slate-300' : 'text-slate-700')}`}>
                      {day.dayNum}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Line Filter */}
          <div className="relative">
            <h3 className={`text-xs font-bold uppercase tracking-widest mb-3 ml-1 ${mutedTextClass}`}>Linie</h3>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 px-1 snap-x">
               {lines.map(line => {
                 const value = (line === 'Wszystkie' ? 'all' : line) as string;
                 const isActive = selectedLine === value;
                 
                 // Default to a generic teal active state if it's "Wszystkie" or unknown
                 let activeClass = 'bg-gradient-to-r from-teal-400 to-cyan-500 text-teal-950 border-transparent shadow-[0_0_12px_rgba(20,184,166,0.25)]';
                 let inactiveClass = isDarkTheme
                   ? 'bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10'
                   : 'bg-slate-100 text-slate-700 border border-slate-300 hover:bg-white';
                 
                 if (value !== 'all') {
                   if (value.startsWith('M') || value.toLowerCase().includes('marcel')) {
                     activeClass = 'bg-lime-400 text-lime-950 border-transparent shadow-[0_0_12px_rgba(163,230,53,0.3)]';
                     inactiveClass = `${getLineStyle(value, lineProviderIds.get(value))} hover:opacity-80`;
                   } else {
                     const numericVal = parseInt(value, 10);
                     if (!isNaN(numericVal) && numericVal >= 100) {
                        activeClass = 'bg-teal-400 text-teal-950 border-transparent shadow-[0_0_12px_rgba(45,212,191,0.3)]';
                        inactiveClass = `${getLineStyle(value, lineProviderIds.get(value))} hover:opacity-80`;
                     } else {
                        // MPK
                        if (value !== 'Wszystkie') {
                          activeClass = 'bg-orange-400 text-orange-950 border-transparent shadow-[0_0_12px_rgba(251,146,60,0.3)]';
                          inactiveClass = `${getLineStyle(value, lineProviderIds.get(value))} hover:opacity-80`;
                        }
                     }
                   }
                 }

                 return (
                   <button
                     key={line}
                     onClick={() => setSelectedLine(value)}
                     className={`flex-shrink-0 snap-start px-3.5 sm:px-4.5 py-2.5 rounded-xl text-[12px] font-extrabold transition-all duration-300 border cursor-pointer ${
                       isActive ? activeClass : inactiveClass
                     }`}
                   >
                     {line}
                   </button>
                 )
               })}
            </div>
          </div>

          {/* Departures List */}
          <div>
             {/* Clean simple day header */}
             <div className="flex justify-between items-center mb-3 px-1">
               <div className={`text-xs font-extrabold tracking-wider uppercase ${mutedTextClass}`}>
                 {days.find(d => d.key === selectedDay)?.weekday}, {days.find(d => d.key === selectedDay)?.dayNum} {days.find(d => d.key === selectedDay)?.monthName}
               </div>
             </div>

             <div className="hidden flex-col gap-2.5 mb-3 px-1">
               <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                 <div className="text-xs font-extrabold text-slate-400 tracking-wider uppercase">
                   {days.find(d => d.key === selectedDay)?.weekday}, {days.find(d => d.key === selectedDay)?.dayNum} {days.find(d => d.key === selectedDay)?.monthName}
                 </div>
                 
                 <div className="flex items-center gap-2">
                   {/* Live/Offline Status Badge */}
                   <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-300 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.15)]">
                     <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                     <span>Dane Rzeczywiste ITS</span>
                   </div>

                   {/* Refresh Button */}
                   <button 
                     onClick={refreshLiveDepartures}
                     disabled={isFetchingLive}
                     title="Odśwież rozkład czasu rzeczywistego"
                     className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/5 hover:border-white/10 active:scale-95 transition-all shadow-md cursor-pointer shrink-0 disabled:opacity-50"
                   >
                     <RefreshCw size={12} className={isFetchingLive ? "animate-spin text-teal-450" : ""} />
                   </button>
                 </div>
               </div>

               {/* Past Departures Toggle Switch Row */}
               <div className="flex justify-between items-center py-2 px-3 rounded-xl bg-white/[0.01] border border-white/[0.03] text-xs">
                 <div className="flex flex-col">
                   <span className="font-extrabold text-slate-300">Pokaż minione odjazdy</span>
                   <span className="text-[10px] text-slate-500">Wyświetla kursy z całego dnia, które już się odbyły</span>
                 </div>
                 <button
                   onClick={() => {
                     setShowPastDepartures(!showPastDepartures);
                     if (!showPastDepartures) {
                       setShowAllDepartures(true);
                       setVisibleDepartureLimit(EXPANDED_DEPARTURE_BATCH);
                     }
                   }}
                   className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                     showPastDepartures ? 'bg-teal-500' : 'bg-slate-700'
                   }`}
                 >
                   <span
                     className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                       showPastDepartures ? 'translate-x-4' : 'translate-x-0'
                     }`}
                   />
                 </button>
               </div>
             </div>
              
             <motion.div layout className={`backdrop-blur-2xl rounded-2xl border overflow-hidden shadow-xl ${departuresCardClass}`}>
                {isLoading ? (
                  <div className="space-y-1.5 animate-pulse p-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className={`flex items-center justify-between p-3 rounded-xl border ${skeletonRowClass}`}>
                        <div className="flex items-center space-x-3 w-2/3">
                          <div className={`w-11 h-8 rounded-xl ${skeletonBlockClass}`}></div>
                          <div className="flex-1 space-y-1.5">
                            <div className={`h-3.5 rounded w-3/4 ${skeletonBlockClass}`}></div>
                            <div className={`h-2.5 rounded w-1/2 ${skeletonBlockClass}`}></div>
                          </div>
                        </div>
                        <div className={`w-10 h-5 rounded-lg ${skeletonBlockClass}`}></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <AnimatePresence mode="popLayout">
                  {displayedDepartures.map((dep, idx) => {
                    const isPast = (dep as any).isPast;
                    const departureTimeLabel = formatDepartureTime(dep);
                    return (
                      <motion.div 
                        layout="position"
                        initial={animateDepartures ? { opacity: 0, y: 8 } : false}
                        animate={animateDepartures ? { opacity: isPast ? 0.45 : 1, y: 0 } : { opacity: isPast ? 0.45 : 1, y: 0 }}
                        exit={animateDepartures ? { opacity: 0, scale: 0.98 } : undefined}
                        transition={animateDepartures ? { duration: 0.18, delay: Math.min(idx * 0.05, 0.3) } : { duration: 0 }}
                        key={dep.id} 
                        className={`flex items-center justify-between p-3 sm:p-4 ${idx !== displayedDepartures.length - 1 ? `border-b ${rowBorderClass}` : ''} ${rowClass} transition-colors cursor-pointer ${isPast ? (isDarkTheme ? 'bg-black/15' : 'bg-slate-100/70') : ''}`}
                      >
                        {/* Left Side: Line Badge & Directions */}
                        <div className="flex items-center min-w-0 flex-1 mr-2 sm:mr-3">
                          {/* Line Badge */}
                          <div className={`w-10 sm:w-11 py-1.5 rounded-xl font-extrabold text-center shrink-0 border text-xs shadow-sm ${
                            isPast 
                              ? 'bg-slate-500/5 text-slate-500 border-slate-500/10' 
                              : getLineStyle(dep.line, dep.carrier?.id)
                          }`}>
                            {dep.line}
                          </div>
                           
                          {/* Direction Info */}
                          <div className="ml-2.5 sm:ml-3 flex-1 min-w-0">
                             <div className="flex flex-wrap items-center gap-1.5">
                               <h4 className={`font-extrabold truncate text-[13px] sm:text-[15px] ${isPast ? 'text-slate-500 line-through font-normal' : headingTextClass}`}>{dep.direction}</h4>
                               {isPast && (
                                 <span className="px-1.5 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-slate-500/20 text-[8px] font-black tracking-wider uppercase leading-none scale-90">
                                   Odjechał
                                 </span>
                                )}
                             </div>
                             {dep.vehicleDesc && (
                               <div className={`flex items-center text-[10px] sm:text-[11px] mt-0.5 truncate ${mutedTextClass}`}>
                                 <Navigation size={9} className={`mr-1 rotate-[135deg] shrink-0 ${isPast ? 'text-slate-500' : dep.carrier?.colorClass || 'text-teal-400'}`} />
                                 {dep.vehicleDesc}
                               </div>
                             )}
                          </div>
                        </div>
                        
                        {/* Right Side: Departure Time & Delayed/On-time Badge */}
                        <div className="min-w-[4.4rem] text-right shrink-0 flex flex-col items-end pl-1.5 sm:pl-2">
                           <div className={`font-black tracking-tight text-[15px] sm:text-[16px] ${isPast ? 'text-slate-500 line-through' : headingTextClass}`}>{departureTimeLabel}</div>
                           {!isPast && dep.status === 'delayed' && Number.isFinite(dep.delayMins) && Math.abs(Number(dep.delayMins)) > 0 && (
                             <span className={`mt-1 rounded-full px-2 py-0.5 text-[10px] font-black leading-none ${
                               Number(dep.delayMins) > 0
                                 ? 'bg-rose-500/20 text-rose-300 border border-rose-400/35'
                                 : 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/35'
                             }`}>
                               {Number(dep.delayMins) > 0 ? `-${Math.abs(Number(dep.delayMins))} min` : `+${Math.abs(Number(dep.delayMins))} min`}
                             </span>
                           )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {activeDepartures.length === 0 && (
                  <div className={`p-8 text-center text-sm leading-relaxed ${subtleTextClass}`}>
                    Brak najbliższych odjazdów dla tej linii.
                  </div>
                )}
                
                {hasMoreDepartures && (
                  <button 
                    onClick={() => {
                      setShowAllDepartures(true);
                      setVisibleDepartureLimit((current) => {
                        const base = showAllDepartures ? current : 0;
                        return Math.min(activeDepartures.length, base + EXPANDED_DEPARTURE_BATCH);
                      });
                    }}
                    className={`w-full py-4 text-xs font-bold flex items-center justify-center gap-2 border-t transition-colors uppercase tracking-wider cursor-pointer ${
                      isDarkTheme
                        ? 'text-slate-400 hover:text-white border-white/[0.04] hover:bg-white/[0.02]'
                        : 'text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-100/70'
                    }`}
                  >
                    {showAllDepartures
                      ? `Pokaż kolejne (${activeDepartures.length - displayedDepartures.length})`
                      : `Pokaż więcej odjazdów (${activeDepartures.length})`}
                    <ChevronDown size={14} />
                  </button>
                )}
                  </>
                )}
             </motion.div>
          </div>

          {/* Lines serving stop */}
          <div className="pb-[calc(env(safe-area-inset-bottom)+9.5rem)] md:pb-6">
             <h3 className={`text-xs font-bold uppercase tracking-widest mb-3 ml-1 ${mutedTextClass}`}>Linie obsługujące przystanek</h3>
             <div className="flex flex-wrap gap-2">
               {combinedLines.map(line => (
                  <div key={line} className={`px-4 py-2 rounded-xl border font-bold text-[13px] transition-all duration-300 hover:opacity-80 ${getLineStyle(line, lineProviderIds.get(line))}`}>
                    {line}
                  </div>
               ))}
             </div>
          </div>

        </div>
      </div>
    </motion.div>
  );
}
