'use client';

import { Clock, Info, MapPin, Navigation, RefreshCw, Route, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { Vehicle, StopSchedule } from '@/components/BusMap';

type TrainDetailsPanelProps = {
  vehicle: Vehicle;
  expanded: boolean;
  loading?: boolean;
  highlightedStopId?: string | null;
  onToggleExpanded: () => void;
  onClose: () => void;
  onStopSelect: (stopId: string) => void;
};

const TRAIN_BLUE = '#174ad9';

function parseMs(raw: unknown) {
  const value = String(raw || '').trim();
  if (!value) return NaN;
  return new Date(value.replace(' ', 'T')).getTime();
}

function formatClock(raw: unknown) {
  const ms = parseMs(raw);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function formatDelay(minutes: number) {
  const sign = minutes > 0 ? '+' : minutes < 0 ? '-' : '+';
  return `${sign}${Math.abs(minutes)} min`;
}

function stopDelayMinutes(stop: StopSchedule) {
  if (Number.isFinite(stop.stopDelayMinutes)) return Number(stop.stopDelayMinutes);
  const planned = parseMs(stop.planned);
  const real = parseMs(stop.real);
  if (!Number.isFinite(planned) || !Number.isFinite(real)) return 0;
  return Math.round((real - planned) / 60000);
}

function cleanTrainNumber(vehicle: Vehicle) {
  const category = String(vehicle.routeShortName || vehicle.iconVariant || 'IC').trim().toUpperCase();
  const raw = String(vehicle.vehicleNumber || '').trim();
  if (!raw) return '';
  const digits = raw.toUpperCase().startsWith(`${category} `) ? raw.slice(category.length).trim() : raw;
  return `${category} ${digits}`.trim();
}

function trainCategory(vehicle: Vehicle) {
  const value = String(vehicle.iconVariant || vehicle.routeShortName || 'IC').trim().toUpperCase();
  return value === 'EIP' || value === 'EIC' || value === 'IC' ? value : 'IC';
}

function trainName(vehicle: Vehicle) {
  const raw = String(vehicle.trainName || '').trim();
  if (raw && !/^\d+$/.test(raw)) return raw.toUpperCase();
  return String(vehicle.name || '').replace(/^(IC|EIC|EIP)\s+/i, '').trim().toUpperCase() || 'PKP INTERCITY';
}

function relationParts(vehicle: Vehicle) {
  const relation = String(vehicle.direction || vehicle.routeId || '').trim();
  const dash = relation.split(/\s+-\s+|\s+→\s+|\s+->\s+/).map((part) => part.trim()).filter(Boolean);
  if (dash.length >= 2) return [dash[0], dash[dash.length - 1]];
  const stops = vehicle.routeStops || [];
  if (stops.length >= 2) return [stops[0].name, stops[stops.length - 1].name];
  return [relation || 'Nieustalone', ''];
}

function routeStops(vehicle: Vehicle) {
  const source = vehicle.routeStops && vehicle.routeStops.length > 0 ? vehicle.routeStops : vehicle.schedule || [];
  return source.filter((stop) => stop && stop.name);
}

function currentSegment(vehicle: Vehicle, nowMs: number) {
  const stops = routeStops(vehicle);
  if (stops.length < 2) return null;

  let previous: StopSchedule | null = null;
  let next: StopSchedule | null = null;

  for (const stop of stops) {
    const time = parseMs(stop.real || stop.planned);
    const isPast = stop.isPast || (Number.isFinite(time) && time < nowMs - 30_000);
    if (isPast) {
      previous = stop;
      continue;
    }
    next = stop;
    break;
  }

  if (!previous && next) {
    const index = stops.indexOf(next);
    previous = stops[Math.max(0, index - 1)] || stops[0];
  }
  if (!next && previous) {
    const index = stops.indexOf(previous);
    next = stops[Math.min(stops.length - 1, index + 1)] || null;
  }
  if (!previous || !next || previous.id === next.id) return null;
  return { previous, next };
}

function upcomingStops(vehicle: Vehicle, nowMs: number) {
  const schedule = (vehicle.schedule && vehicle.schedule.length > 0 ? vehicle.schedule : routeStops(vehicle));
  return schedule.filter((stop) => {
    if (stop.isPast) return false;
    const ms = parseMs(stop.real || stop.planned);
    return !Number.isFinite(ms) || ms >= nowMs - 60_000;
  });
}

export default function TrainDetailsPanel({
  vehicle,
  expanded,
  loading = false,
  highlightedStopId,
  onToggleExpanded,
  onClose,
  onStopSelect,
}: TrainDetailsPanelProps) {
  const nowMs = Date.now();
  const category = trainCategory(vehicle);
  const number = cleanTrainNumber(vehicle);
  const [from, to] = relationParts(vehicle);
  const segment = currentSegment(vehicle, nowMs);
  const stops = upcomingStops(vehicle, nowMs);
  const positionKnown = vehicle.positionQuality === 'known' || !String(vehicle.statusText || '').toLowerCase().includes('szacowana');
  const speedLabel = Number.isFinite(vehicle.speed) ? `${Math.round(vehicle.speed || 0)} km/h` : 'Brak danych';
  const lastUpdate = formatClock(vehicle.lastSignalTime);
  const delayMin = Math.trunc((vehicle.delay || 0) / 60);
  const iconSrc = `/train-icons/${category}.svg`;

  return (
    <motion.div
      key="train-panel-map"
      initial={{ y: '100%', opacity: 0.5 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: '100%', opacity: 0.5 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className="absolute bottom-[calc(64px+env(safe-area-inset-bottom))] left-0 right-0 z-50 flex max-h-[calc(72vh-24px)] flex-col overflow-hidden rounded-t-3xl border border-white/12 bg-[#03100d]/96 text-white shadow-2xl md:bottom-4 md:left-4 md:right-auto md:mb-0 md:max-h-[88vh] md:w-[420px] md:rounded-3xl"
    >
      <motion.div
        className="relative shrink-0 overflow-hidden px-5 pb-5 pt-4 text-white md:px-6 md:pb-6"
        style={{ background: `radial-gradient(circle at 12% 0%, #0d66ff 0%, ${TRAIN_BLUE} 42%, #062069 100%)` }}
        onClick={onToggleExpanded}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.1}
      >
        <div className="mx-auto mb-5 h-1.5 w-14 rounded-full bg-white/40" />
        <button
          type="button"
          aria-label="Zamknij panel pociągu"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="absolute right-4 top-5 grid h-11 w-11 place-items-center rounded-full border border-white/18 bg-white/8 text-white transition hover:bg-white/15"
        >
          <X className="h-6 w-6" />
        </button>

        <div className="flex items-start gap-4 pr-12">
          <div className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-lg bg-blue-600 shadow-lg shadow-blue-950/30">
            <img src={iconSrc} alt="" className="h-14 w-14 object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            {number && (
              <div className="mb-2 inline-flex rounded-lg bg-blue-500/80 px-3 py-1 text-xl font-black leading-none tracking-tight text-white">
                {number}
              </div>
            )}
            <h2 className="truncate text-3xl font-black leading-none tracking-normal md:text-4xl">
              {trainName(vehicle)}
            </h2>
            <div className="mt-3 flex min-w-0 items-center gap-2 text-lg font-medium leading-tight text-white/70">
              <span className="truncate">{from}</span>
              {to && <span className="shrink-0 text-white/45">-&gt;</span>}
              {to && <span className="truncate">{to}</span>}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 pl-[88px] text-sm font-semibold text-white/75">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${positionKnown ? 'border-emerald-300/18 bg-emerald-400/14 text-emerald-300' : 'border-lime-300/18 bg-lime-400/14 text-lime-300'}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${positionKnown ? 'bg-emerald-300' : 'bg-lime-300'}`} />
            {positionKnown ? 'Pozycja znana' : 'Pozycja szacowana'}
          </span>
          {lastUpdate && (
            <span className="inline-flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Ostatnia aktualizacja: <span className="font-black text-white">{lastUpdate}</span>
            </span>
          )}
        </div>
      </motion.div>

      {expanded && (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                <Navigation className="h-4 w-4" /> Prędkość
              </div>
              <div className="text-xl font-black tracking-normal">{speedLabel}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                <Clock className="h-4 w-4" /> Punktualność
              </div>
              <div className={`text-lg font-black tracking-normal ${delayMin > 0 ? 'text-rose-300' : delayMin < 0 ? 'text-emerald-300' : 'text-white'}`}>
                {delayMin === 0 ? 'Zgodnie z planem' : delayMin > 0 ? `${delayMin} min opóźnienia` : `${Math.abs(delayMin)} min przed czasem`}
              </div>
            </div>
          </div>

          {segment && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.045] p-4">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-400">
                  <Route className="h-4 w-4" /> Aktualnie między stacjami
                </div>
                <div className="truncate text-xl font-black tracking-normal">
                  {segment.previous.name} <span className="text-white/50">-&gt;</span> {segment.next.name}
                </div>
              </div>
              <div className="hidden shrink-0 items-center gap-1 md:flex">
                <span className="h-4 w-4 rounded-full bg-blue-500 ring-4 ring-blue-500/20" />
                <span className="h-1 w-12 rounded-full bg-blue-500" />
                <span className="h-4 w-4 rounded-full border-4 border-blue-400" />
              </div>
            </div>
          )}

          <div className="mt-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-400">
              <MapPin className="h-5 w-5" /> Nadchodzące stacje
            </h3>

            <div className="relative">
              <div className="absolute bottom-8 left-[13px] top-7 w-0.5 bg-blue-500/45" />
              {loading && stops.length === 0 ? (
                [0, 1, 2].map((idx) => (
                  <div key={`train-stop-loading-${idx}`} className="relative mb-2 flex gap-4">
                    <div className="relative z-10 mt-5 h-7 w-7 rounded-full border-4 border-blue-500 bg-slate-950" />
                    <div className="h-20 flex-1 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
                  </div>
                ))
              ) : stops.map((stop, index) => {
                const delay = stopDelayMinutes(stop);
                const highlighted = String(stop.id) === String(highlightedStopId || '');
                const time = formatClock(stop.real || stop.planned);
                const muted = Boolean(stop.isPast);
                return (
                  <button
                    type="button"
                    key={`${stop.id}-${index}`}
                    onClick={() => onStopSelect(String(stop.id))}
                    className={`relative mb-2 flex w-full gap-4 text-left transition ${muted ? 'opacity-45' : 'opacity-100'}`}
                  >
                    <span className={`relative z-10 mt-5 h-7 w-7 shrink-0 rounded-full border-4 ${highlighted ? 'border-white bg-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.8)]' : index === 0 ? 'border-blue-500 bg-white' : 'border-blue-500 bg-slate-950'}`} />
                    <span className={`flex min-h-[74px] flex-1 items-center justify-between gap-3 rounded-lg border p-3 ${highlighted ? 'border-blue-300/50 bg-blue-500/18' : 'border-white/10 bg-white/[0.04]'}`}>
                      <span className="min-w-0">
                        <span className="block truncate text-xl font-black tracking-normal">{stop.name}</span>
                        <span className="mt-1 flex items-center gap-2 text-lg font-medium text-white">
                          {time || '--:--'}
                          {index === 0 && <span className="rounded-md bg-blue-500/55 px-2 py-0.5 text-sm font-bold">Odjazd</span>}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-base font-medium text-slate-300">
                        {delay !== 0 && (
                          <span className={`mb-1 block font-bold ${delay > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                            {formatDelay(delay)}
                          </span>
                        )}
                        {delay === 0 && <span className="mb-1 block font-bold text-emerald-300">+0 min</span>}
                        {stop.platform && <span className="block">Peron {stop.platform}</span>}
                        {stop.track && <span className="block">Tor {stop.track}</span>}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-center text-base font-medium text-slate-300">
            <Info className="mr-2 inline h-5 w-5 align-[-4px]" />
            Szczegóły
          </div>
        </div>
      )}
    </motion.div>
  );
}
