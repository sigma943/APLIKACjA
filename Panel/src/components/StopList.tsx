import React, { useDeferredValue, useMemo, useState } from 'react';
import { Search, X, Bus, Train, Star, ChevronDown } from 'lucide-react';
import { Stop } from '../types';
import { getLineStyle } from '../utils/lineStyles';
import { formatPublicStopName } from '@/lib/stop-display';

interface StopListProps {
  onStopSelect: (stop: Stop) => void;
  onClose?: () => void;
  toggleFavorite: (stopId: string) => void;
  stops: Stop[];
  isFullScreen?: boolean;
  isLoading?: boolean;
  isDarkTheme?: boolean;
  themeMode?: string;
  searchState?: {
    inputValue: string;
    fullInputValue: string;
    carrierFilter: CarrierFilterId;
    visibleFullCount: number;
  };
  onSearchStateChange?: (state: {
    inputValue?: string;
    fullInputValue?: string;
    carrierFilter?: CarrierFilterId;
    visibleFullCount?: number;
  }) => void;
}

const ENABLE_TRAINS = false;
type CarrierFilterId = 'all' | 'pks' | 'mpk' | 'marcel';

const CARRIER_FILTERS: Array<{ id: CarrierFilterId; label: string; dotClass: string }> = [
  { id: 'all', label: 'Wszystkie', dotClass: 'bg-teal-400' },
  { id: 'pks', label: 'PKS Rzeszów', dotClass: 'bg-teal-400' },
  { id: 'mpk', label: 'MPK Rzeszów', dotClass: 'bg-orange-500' },
  { id: 'marcel', label: 'Marcel', dotClass: 'bg-lime-400' },
];

type SearchableStop = {
  stop: Stop;
  normalizedName: string;
  carrierIds: Set<string>;
};

function normalizeSearchText(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function filterStops(stops: SearchableStop[], query: string, carrierFilter: CarrierFilterId) {
  const normalizedQuery = normalizeSearchText(query);
  return stops
    .filter((entry) => {
      if (!ENABLE_TRAINS && entry.stop.type !== 'bus') return false;
      if (carrierFilter !== 'all' && !entry.carrierIds.has(carrierFilter)) return false;
      if (!normalizedQuery) return true;
      return entry.normalizedName.includes(normalizedQuery);
    })
    .map((entry) => entry.stop);
}

export default function StopList({
  onStopSelect,
  onClose,
  toggleFavorite,
  stops,
  isFullScreen = false,
  isLoading = false,
  isDarkTheme = true,
  themeMode,
  searchState,
  onSearchStateChange,
}: StopListProps) {
  const [localInputValue, setLocalInputValue] = useState('');
  const [isFullListOpen, setIsFullListOpen] = useState(false);
  const [localFullInputValue, setLocalFullInputValue] = useState('');
  const [localCarrierFilter, setLocalCarrierFilter] = useState<CarrierFilterId>('all');
  const [localVisibleFullCount, setLocalVisibleFullCount] = useState(40);
  const inputValue = searchState?.inputValue ?? localInputValue;
  const fullInputValue = searchState?.fullInputValue ?? localFullInputValue;
  const carrierFilter = searchState?.carrierFilter ?? localCarrierFilter;
  const visibleFullCount = searchState?.visibleFullCount ?? localVisibleFullCount;
  const setInputValue = (value: string) => {
    setLocalInputValue(value);
    onSearchStateChange?.({ inputValue: value });
  };
  const setFullInputValue = (value: string) => {
    setLocalFullInputValue(value);
    onSearchStateChange?.({ fullInputValue: value });
  };
  const setCarrierFilterValue = (value: CarrierFilterId) => {
    setLocalCarrierFilter(value);
    onSearchStateChange?.({ carrierFilter: value });
  };
  const setVisibleFullCountValue = (value: number | ((current: number) => number)) => {
    const next = typeof value === 'function' ? value(visibleFullCount) : value;
    setLocalVisibleFullCount(next);
    onSearchStateChange?.({ visibleFullCount: next });
  };
  const deferredInputValue = useDeferredValue(inputValue);
  const deferredFullInputValue = useDeferredValue(fullInputValue);
  const sortedStops = useMemo(() => {
    const favorites: Stop[] = [];
    const others: Stop[] = [];
    stops.forEach((stop) => {
      if (!ENABLE_TRAINS && stop.type !== 'bus') return;
      if (stop.isFavorite) favorites.push(stop);
      else others.push(stop);
    });
    return [...favorites, ...others];
  }, [stops]);
  const searchableStops = useMemo<SearchableStop[]>(
    () =>
      sortedStops.map((stop) => ({
        stop,
        normalizedName: normalizeSearchText(stop.name),
        carrierIds: new Set([
          ...stop.carriers.map((carrier) => carrier.id),
          ...((stop.sourceProviderIds || []).map((provider) => (provider === 'mpk_rzeszow' ? 'mpk' : provider))),
        ]),
      })),
    [sortedStops],
  );

  const filteredStops = useMemo(
    () => filterStops(searchableStops, deferredInputValue, carrierFilter),
    [searchableStops, deferredInputValue, carrierFilter],
  );
  const fullFilteredStops = useMemo(
    () => (isFullListOpen ? filterStops(searchableStops, deferredFullInputValue, carrierFilter) : []),
    [isFullListOpen, searchableStops, deferredFullInputValue, carrierFilter],
  );
  const displayStops = useMemo(() => filteredStops.slice(0, 30), [filteredStops]);
  const slicedFullStops = useMemo(() => fullFilteredStops.slice(0, visibleFullCount), [fullFilteredStops, visibleFullCount]);
  const isOledTheme = themeMode === 'dark-oled';
  const isWarmTheme = themeMode === 'light-warm';
  const shellClass = isWarmTheme ? 'text-[#3d3a2e]' : isDarkTheme ? 'text-slate-200' : 'text-slate-800';
  const headerClass = isOledTheme
    ? 'border-white/[0.06] bg-black/42 shadow-[0_18px_60px_rgba(0,0,0,0.34)]'
    : isWarmTheme
      ? 'border-[#cfc89f]/70 bg-[#faf7ef]/88 shadow-[0_18px_40px_rgba(89,75,48,0.12)]'
      : isDarkTheme
        ? 'border-white/[0.08] bg-[#07111d]/30 shadow-[0_18px_60px_rgba(0,0,0,0.16)]'
        : 'border-slate-200/80 bg-white/96 shadow-[0_18px_40px_rgba(15,23,42,0.10)]';
  const searchInputClass = isOledTheme
    ? 'border-white/10 bg-white/[0.045] text-white shadow-black/30 placeholder:text-slate-500 focus:border-teal-500/40 focus:ring-teal-500/20'
    : isWarmTheme
      ? 'border-[#cfc89f]/90 bg-[#faf7ef]/92 text-[#3d3a2e] placeholder:text-[#736e56] focus:border-teal-500/45 focus:ring-teal-500/20'
      : isDarkTheme
        ? 'border-white/12 bg-[#0e1622]/34 text-white shadow-black/18 placeholder:text-slate-400/75 focus:border-teal-500/40 focus:ring-teal-500/20'
        : 'border-slate-300/90 bg-white/90 text-slate-900 placeholder:text-slate-500 focus:border-teal-500/45 focus:ring-teal-500/20';
  const searchIconClass = isWarmTheme ? 'text-[#918b74] group-focus-within:text-teal-600' : isDarkTheme ? 'text-slate-500 group-focus-within:text-teal-400' : 'text-slate-400 group-focus-within:text-teal-600';
  const inactiveCarrierClass = isOledTheme
    ? 'border-white/8 bg-white/[0.035] text-slate-400 hover:border-white/16 hover:bg-white/[0.06] hover:text-white'
    : isWarmTheme
      ? 'border-[#cfc89f]/80 bg-[#faf7ef]/68 text-[#736e56] hover:border-[#b7ad83] hover:bg-[#faf7ef] hover:text-[#3d3a2e]'
      : isDarkTheme
        ? 'border-white/8 bg-white/[0.03] text-slate-400 hover:border-white/16 hover:bg-white/[0.06] hover:text-white'
        : 'border-slate-300/80 bg-white/88 text-slate-600 hover:border-slate-400/80 hover:bg-white hover:text-slate-900';
  const cardClass = isOledTheme
    ? 'border-white/[0.07] bg-white/[0.035] hover:border-teal-400/35 hover:bg-white/[0.065]'
    : isWarmTheme
      ? 'border-[#dcd6ba]/95 bg-[#faf7ef]/86 hover:border-teal-500/45 hover:bg-[#f2ede1]'
      : isDarkTheme
        ? 'border-white/[0.08] bg-[#0d1622]/34 hover:border-teal-400/35 hover:bg-[#142238]/48'
        : 'border-slate-200/90 bg-white/90 hover:border-teal-500/45 hover:bg-teal-50/35';
  const cardTitleClass = isWarmTheme ? 'text-[#2f2a1f] group-hover:text-teal-700' : isDarkTheme ? 'text-white group-hover:text-teal-200' : 'text-slate-900 group-hover:text-teal-700';
  const secondaryTextClass = isWarmTheme ? 'text-[#736e56]' : isDarkTheme ? 'text-slate-400' : 'text-slate-600';
  const closeButtonClass = isWarmTheme
    ? 'text-[#736e56] hover:bg-[#e6e0cc]/60 hover:text-[#3d3a2e]'
    : isDarkTheme
      ? 'text-slate-400 hover:bg-white/5 hover:text-white'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800';
  const clearButtonClass = isWarmTheme
    ? 'text-[#736e56] hover:bg-[#e6e0cc]/70 hover:text-[#3d3a2e]'
    : isDarkTheme
      ? 'text-slate-400 hover:bg-white/10 hover:text-white'
      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800';
  const iconEmptyClass = isWarmTheme
    ? 'border-[#dcd6ba] bg-[#e6e0cc]/55 text-[#918b74]'
    : isOledTheme
      ? 'border-white/[0.05] bg-white/[0.035] text-slate-600'
      : 'border-white/5 bg-slate-900 text-slate-600';
  const skeletonRowClass = isOledTheme
    ? 'border-white/[0.04] bg-white/[0.025]'
    : isWarmTheme
      ? 'border-[#dcd6ba] bg-[#faf7ef]/70'
      : isDarkTheme
        ? 'border-white/[0.03] bg-[#0d1622]/30'
        : 'border-slate-200 bg-white/85';
  const skeletonPrimaryClass = isWarmTheme ? 'bg-[#dad4b6]' : isDarkTheme ? 'bg-white/10' : 'bg-slate-200';
  const skeletonSecondaryClass = isWarmTheme ? 'bg-[#e6e0cc]' : isDarkTheme ? 'bg-white/5' : 'bg-slate-100';
  const fullListShellClass = isOledTheme
    ? 'bg-black/96'
    : isWarmTheme
      ? 'bg-[#f8f2e4]/96'
      : isDarkTheme
        ? 'bg-[#050b12]/96'
        : 'bg-white/96';
  const fullListHeaderClass = isOledTheme
    ? 'border-white/[0.06] bg-black/96'
    : isWarmTheme
      ? 'border-[#cfc89f]/70 bg-[#faf7ef]/98'
      : isDarkTheme
        ? 'border-white/[0.06] bg-[#0d1622]/96'
        : 'border-slate-200/85 bg-white/98';
  const fullListSearchShellClass = isOledTheme
    ? 'border-white/[0.04] bg-black/94'
    : isWarmTheme
      ? 'border-[#dcd6ba]/85 bg-[#f2ede1]/96'
      : isDarkTheme
        ? 'border-white/[0.03] bg-[#08111c]/96'
        : 'border-slate-200/85 bg-white/96';

  const handleCloseFullList = () => {
    setFullInputValue('');
    setVisibleFullCountValue(40);
    setIsFullListOpen(false);
  };

  const renderCarrierFilters = (compact = false) => (
    <div className={`flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 custom-scrollbar ${compact ? 'mt-3' : 'mt-4'}`}>
      {CARRIER_FILTERS.map((filter) => {
        const isActive = carrierFilter === filter.id;
        return (
          <button
            type="button"
            key={filter.id}
            onClick={() => {
              setCarrierFilterValue(filter.id);
              setVisibleFullCountValue(40);
            }}
            className={`flex shrink-0 items-center gap-2 rounded-2xl border px-3.5 py-2 text-[11px] font-black transition-all ${
              isActive
                ? (isDarkTheme
                    ? 'border-teal-400/45 bg-teal-400/16 text-teal-200 shadow-[0_0_18px_rgba(20,184,166,0.14)]'
                    : 'border-teal-500/35 bg-teal-500/12 text-teal-700 shadow-[0_0_12px_rgba(20,184,166,0.10)]')
                : inactiveCarrierClass
            }`}
          >
            {filter.id !== 'all' && <span className={`h-2 w-2 rounded-full ${filter.dotClass}`} />}
            {filter.label}
          </button>
        );
      })}
    </div>
  );

  const renderLineBadges = (lines: string[], expanded = false, providerId?: string, pksLineSet?: Set<string>) => {
    const visibleCount = expanded ? lines.length : Math.min(lines.length, 5);
    const visible = lines.slice(0, visibleCount);
    const remaining = lines.length - visible.length;

    return (
      <div className="mt-1 flex min-w-0 max-w-full flex-wrap items-center gap-1 overflow-hidden">
        {visible.map((line) => (
          <span key={line} className={`max-w-[5.5rem] truncate rounded border px-2 py-0.5 text-[10px] font-bold ${getLineStyle(line, pksLineSet?.has(line) ? 'pks' : providerId)}`}>
            {line}
          </span>
        ))}
        {remaining > 0 && (
          <span className="rounded border border-slate-500/20 bg-slate-500/10 px-2 py-0.5 text-[10px] font-black text-slate-300">
            +{remaining}
          </span>
        )}
      </div>
    );
  };

  const renderStopCard = (stop: Stop, index: number, full = false) => {
    const isBus = stop.type === 'bus';
    const singleProviderId = stop.carriers.length === 1 ? stop.carriers[0].id : undefined;
    const pksLineSet = new Set(String(stop.providerStopIds?.pksLines || '').split(',').map((line) => line.trim()).filter(Boolean));
    const displayName = formatPublicStopName(stop);
    return (
      <div
        key={`${full ? 'full' : 'list'}-${stop.id}`}
        className={`group flex w-full max-w-full min-w-0 cursor-pointer items-center border transition-colors duration-150 ${cardClass} ${
          full ? 'rounded-[22px] p-4' : 'rounded-[24px] p-4 lg:p-5'
        }`}
        onClick={() => {
          if (full) handleCloseFullList();
          onStopSelect(stop);
        }}
      >
        <div
          className={`mr-4 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors duration-150 ${
            isBus
              ? 'border-teal-500/10 bg-teal-500/10 text-teal-400 group-hover:bg-teal-500/20 group-hover:text-teal-300'
              : 'border-blue-500/10 bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 group-hover:text-blue-300'
          }`}
        >
          {isBus ? <Bus size={20} strokeWidth={2.2} /> : <Train size={20} strokeWidth={2.2} />}
        </div>

        <div className="min-w-0 flex-1 pr-2">
          <h3 className={`truncate text-[16px] font-bold drop-shadow-sm transition-colors lg:text-[17px] ${cardTitleClass}`}>
            {displayName}
          </h3>
          <div className="mt-1 flex flex-col gap-1">
            <div className={`flex min-w-0 flex-wrap items-center text-[12px] font-semibold ${secondaryTextClass}`}>
              <span className={`min-w-0 truncate ${isBus ? 'text-teal-400/90' : 'text-blue-400/90'}`}>
                {isBus ? 'Przystanek autobusowy' : 'Stacja kolejowa'}
              </span>
            </div>
            {isBus && stop.lines.length > 0 && renderLineBadges(stop.lines, full, singleProviderId, pksLineSet)}
          </div>
        </div>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggleFavorite(stop.id);
          }}
          className={`shrink-0 cursor-pointer rounded-xl p-2.5 transition-all duration-200 ${
            isDarkTheme ? 'text-slate-500 hover:bg-white/5 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800'
          }`}
          aria-label={stop.isFavorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
        >
          <span className="block">
            <Star
              size={full ? 18 : 20}
              className={
                stop.isFavorite
                  ? 'fill-[#f59e0b] text-[#f59e0b] drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                  : 'text-slate-500 group-hover:text-slate-400'
              }
            />
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className={`flex h-full min-w-0 max-w-full flex-col overflow-x-hidden bg-transparent ${shellClass}`}>
      <div className={`sticky top-0 z-10 w-full min-w-0 max-w-full overflow-x-hidden border-b px-4 pb-4 pt-6 backdrop-blur-2xl backdrop-saturate-150 lg:px-10 lg:pt-8 ${headerClass}`}>
        <div className="mb-5 flex min-w-0 items-center justify-between pl-1">
          <div className="min-w-0">
            <h1 className={`bg-gradient-to-r from-teal-400 via-cyan-300 to-blue-500 bg-clip-text font-black tracking-tight text-transparent ${isFullScreen ? 'text-2xl lg:text-3.5xl' : 'text-xl'}`}>
              Rozkład Jazdy
            </h1>
            <p className={`mt-1 text-xs font-medium ${secondaryTextClass}`}>Znajdź najbliższe przystanki autobusowe</p>
          </div>
          <button type="button" onClick={onClose} className={`hidden rounded-full p-2 transition-all lg:flex ${closeButtonClass}`}>
            <X size={20} />
          </button>
        </div>

        <div className="group relative">
          <Search className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searchIconClass}`} size={18} />
          <input
            type="text"
            placeholder="Wpisz nazwę, np. Babica, Rejtana..."
            className={`w-full rounded-2xl border py-3 pl-11 pr-4 text-[14px] font-medium shadow-lg outline-none backdrop-blur-2xl transition-all focus:ring-2 lg:py-3.5 lg:text-[15px] ${searchInputClass}`}
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
          />
          {inputValue && (
            <button
              type="button"
              onClick={() => setInputValue('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 transition-colors ${
                clearButtonClass
              }`}
              aria-label="Wyczysc wyszukiwanie"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {renderCarrierFilters()}
      </div>

      <div
        className={`min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+9.5rem)] pt-4 custom-scrollbar lg:px-6 ${
          isFullScreen
            ? 'grid w-full max-w-[1540px] content-start gap-4 px-4 pt-5 md:grid-cols-2 lg:mx-auto lg:gap-6 lg:px-4 lg:pt-10 xl:grid-cols-3'
            : 'flex w-full flex-col gap-3'
        }`}
      >
        {isLoading ? (
          Array.from({ length: isFullScreen ? 6 : 4 }).map((_, index) => (
            <div key={`stop-skeleton-${index}`} className={`flex h-[89px] items-center rounded-[22px] border p-4 ${skeletonRowClass}`}>
              <div className={`mr-4 h-11 w-11 shrink-0 rounded-xl ${skeletonSecondaryClass}`} />
              <div className="min-w-0 flex-1 space-y-2 py-1 pr-2">
                <div className={`h-4 w-3/4 rounded-md ${skeletonPrimaryClass}`} />
                <div className={`h-3 w-1/2 rounded-md ${skeletonSecondaryClass}`} />
              </div>
              <div className={`h-9 w-9 shrink-0 rounded-xl ${skeletonSecondaryClass}`} />
            </div>
          ))
        ) : (
          <>
            {displayStops.map((stop, index) => renderStopCard(stop, index))}

            {filteredStops.length > 30 && (
              <div className="col-span-full mb-8 mt-6 flex w-full justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setFullInputValue(inputValue);
                    setVisibleFullCountValue(40);
                    setIsFullListOpen(true);
                  }}
                  className="cursor-pointer rounded-2xl border border-teal-500/20 bg-teal-500/10 px-6 py-3.5 text-xs font-extrabold uppercase tracking-wider text-teal-300 transition-colors hover:bg-teal-500/20 hover:text-white"
                >
                  Pokaż wszystkie ({filteredStops.length})
                </button>
              </div>
            )}

            {filteredStops.length === 0 && (
              <div className={`mt-16 px-4 text-center text-[15px] text-slate-500 ${isFullScreen ? 'col-span-full' : ''}`}>
                <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border ${iconEmptyClass}`}>
                  <Search size={20} />
                </div>
                Brak wyników dla podanej nazwy.
              </div>
            )}
          </>
        )}
      </div>

      {isFullListOpen && (
        <div
          className={`absolute inset-0 z-50 flex min-w-0 max-w-full flex-col overflow-x-hidden backdrop-blur-2xl backdrop-saturate-150 ${fullListShellClass}`}
        >
          <div className={`flex min-w-0 shrink-0 items-center justify-between border-b px-4 pb-4 pt-6 backdrop-blur-xl lg:px-6 ${fullListHeaderClass}`}>
            <div className="min-w-0 pr-3">
              <h2 className={`text-lg font-black lg:text-xl ${cardTitleClass}` }>Pełna Lista Przystanków</h2>
              <p className={`mt-0.5 text-xs ${secondaryTextClass}` }>Wszystkie pasujące punkty komunikacyjne ({fullFilteredStops.length})</p>
            </div>
            <button
              type="button"
              onClick={handleCloseFullList}
              className={`cursor-pointer rounded-full p-2.5 transition-all ${
                closeButtonClass
              }`}
            >
              <X size={20} />
            </button>
          </div>

          <div className={`shrink-0 border-b px-4 py-4 backdrop-blur-xl lg:px-6 ${fullListSearchShellClass}`}>
            <div className="group relative">
              <Search className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searchIconClass}`} size={18} />
              <input
                type="text"
                placeholder="Wpisz nazwę, np. Babica, Rejtana..."
                className={`w-full rounded-2xl border py-3 pl-11 pr-4 text-[14px] font-medium shadow-lg outline-none transition-all focus:ring-2 ${
                  searchInputClass
                }`}
                value={fullInputValue}
                onChange={(event) => {
                  setFullInputValue(event.target.value);
                  setVisibleFullCountValue(40);
                }}
              />
              {fullInputValue && (
                <button
                  type="button"
                  onClick={() => {
                    setFullInputValue('');
                    setVisibleFullCountValue(40);
                  }}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 transition-colors ${
                    clearButtonClass
                  }`}
                  aria-label="Wyczysc wyszukiwanie"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {renderCarrierFilters(true)}
          </div>

          <div className="flex min-w-0 max-w-full flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+9.5rem)] py-4 custom-scrollbar lg:px-6">
            {slicedFullStops.map((stop, index) => renderStopCard(stop, index, true))}

            {fullFilteredStops.length > visibleFullCount && (
              <div className="mb-6 mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleFullCountValue((count) => count + 40)}
                  className="group flex w-full min-w-0 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-teal-500/20 bg-teal-500/10 px-6 py-3.5 text-center text-xs font-black uppercase tracking-wider text-teal-300 transition-colors hover:border-teal-500/40 hover:bg-teal-500/15 hover:shadow-[0_0_15px_rgba(20,184,166,0.15)]"
                >
                  <span>Pokaż więcej (+{fullFilteredStops.length - visibleFullCount} pozostałych)</span>
                  <ChevronDown size={14} className="text-teal-400 transition-transform group-hover:translate-y-0.5" />
                </button>
              </div>
            )}

            {fullFilteredStops.length === 0 && (
              <div className="mt-16 px-4 text-center text-[15px] text-slate-500">
                <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border ${iconEmptyClass}`}>
                  <Search size={20} />
                </div>
                Brak pasujących przystanków dla tej nazwy.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
