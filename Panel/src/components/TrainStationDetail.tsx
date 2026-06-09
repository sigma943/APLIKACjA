import React, { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Map,
  Star,
  MapPin,
  Train,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Stop, Departure } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { getDeparturesForStop } from "../utils/scheduleGenerator";

interface TrainStationDetailProps {
  stop: Stop;
  onBack: () => void;
  toggleFavorite: (stopId: string) => void;
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

export default function TrainStationDetail({
  stop,
  onBack,
  toggleFavorite,
}: TrainStationDetailProps) {
  const DAYS = useRef(getDynamicDays()).current;
  const [tab, setTab] = useState<"departures" | "arrivals">("departures");
  const [selectedDay, setSelectedDay] = useState<string>("today");
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [currentTime, setCurrentTime] = useState("");

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const activeEl = scrollContainerRef.current.querySelector(
        '[data-selected="true"]',
      );
      if (activeEl) {
        activeEl.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }
  }, [selectedDay]);

  useEffect(() => {
    let active = true;

    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, "0");
    const currentMin = String(now.getMinutes()).padStart(2, "0");
    const currentTimeStr = `${currentHour}:${currentMin}`;

    const dayIndex = DAYS.findIndex((d) => d.key === selectedDay);
    const dayIndexParam = dayIndex !== -1 ? dayIndex : 0;

    setIsLoading(true);
    setDepartures([]);

    fetch(
      `/api/departures?stopId=${stop.id}&dayIndex=${dayIndexParam}&day=${selectedDay}&currentTime=${currentTimeStr}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (active && data && data.departures) {
          setDepartures(data.departures);
        }
        if (active) {
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.error("Error keeping train schedules in sync:", err);
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [stop.id, selectedDay]);

  const trains = departures.filter((t) =>
    tab === "departures" ? t.type === "departure" : t.type === "arrival"
  );

  const getTrainPrefix = (line: string) => {
    return line.split(" ")[0];
  };

  const getPrefixStyle = (prefix: string) => {
    switch (prefix) {
      case "IC":
        return "bg-blue-500/10 text-blue-300 border-blue-500/20 shadow-[0_0_8px_rgba(59,130,246,0.15)]";
      case "R":
        return "bg-rose-500/10 text-rose-300 border-rose-500/20 shadow-[0_0_8px_rgba(244,63,94,0.15)]";
      case "TLK":
        return "bg-indigo-500/10 text-indigo-300 border-indigo-500/20 shadow-[0_0_8px_rgba(99,102,241,0.15)]";
      case "EIP":
        return "bg-amber-500/10 text-amber-300 border-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.15)]";
      default:
        return "bg-white/5 text-slate-300 border-white/10";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 15 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 15 }}
      transition={{ type: "spring", stiffness: 350, damping: 30 }}
      className="flex flex-col min-h-full bg-[#05080c] text-slate-200 font-sans pb-8"
    >
      <div className="w-full max-w-3xl mx-auto">
        {/* Header */}
        <div className="relative pt-4 lg:pt-8 pb-4 px-4 lg:px-8 bg-slate-900 overflow-hidden">
          {/* Subtle nice background */}
          <div className="absolute inset-0 bg-[#05080c]"></div>
          <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-bl from-blue-900/40 via-[#05080c] to-[#05080c]"></div>
          <div className="absolute top-1/4 right-0 w-[40rem] h-[40rem] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none translate-x-1/3 -translate-y-1/2"></div>

          {/* Top bar */}
          <div className="flex justify-between items-center mb-3 lg:mb-6 relative z-10 w-full">
            <button
              onClick={onBack}
              className="p-1.5 -ml-1 text-white hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
            >
              <ArrowLeft size={22} />
            </button>

            <div className="flex items-center ml-auto gap-2">
              <button className="flex flex-shrink-0 items-center justify-center gap-1.5 h-8.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold transition-all duration-300 cursor-pointer shadow-md active:scale-95 leading-none hover:border-blue-500/30 font-sans">
                <MapPin size={13} className="text-blue-400 animate-pulse" />
                <span>Pokaż na mapie</span>
              </button>
              <button
                onClick={() => toggleFavorite(stop.id)}
                className="w-8.5 h-8.5 flex items-center justify-center text-white hover:bg-white/10 border border-white/5 hover:border-white/10 rounded-xl transition-all duration-200 flex-shrink-0 cursor-pointer active:scale-90"
              >
                <Star
                  size={16}
                  className={
                    stop.isFavorite
                      ? "fill-[#f59e0b] text-[#f59e0b]"
                      : "text-slate-400"
                  }
                />
              </button>
            </div>
          </div>

          {/* Station Info */}
          <div className="relative z-10">
            <h1 className="text-lg sm:text-2xl lg:text-3xl font-black text-white mb-2 tracking-tight">
              {stop.name}
            </h1>

            <div className="flex gap-1">
              {stop.carriers.map((c) => (
                <div
                  key={c.id}
                  className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold tracking-wider uppercase border ${c.bgClass} ${c.colorClass} ${c.borderClass}`}
                >
                  {c.name}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 lg:px-8 mt-4 space-y-4 relative z-10">
          {/* Calendar Picker Swipable 7-Day Row */}
          <div className="relative bg-[#0d1622]/40 rounded-2xl p-3 border border-white/[0.03] shadow-md">
            <div className="flex justify-between items-center mb-2 px-1">
              <h3 className="text-slate-400 text-[10px] font-bold uppercase tracking-widest font-sans">
                Wybierz Dzień
              </h3>
              <span className="text-[9px] font-bold text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full border border-blue-500/15 capitalize">
                {DAYS.find((d) => d.key === selectedDay)?.monthYear}
              </span>
            </div>

            <div
              ref={scrollContainerRef}
              className="flex gap-1.5 overflow-x-auto no-scrollbar py-1 snap-x select-none pointer-events-auto px-0"
            >
              {DAYS.map((day) => {
                const isSelected = selectedDay === day.key;
                return (
                  <button
                    key={day.key}
                    onClick={() => setSelectedDay(day.key)}
                    data-selected={isSelected}
                    className={`flex-shrink-0 snap-start flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-all duration-300 cursor-pointer border ${
                      isSelected
                        ? "bg-[#3b82f6]/15 text-blue-300 border-[#3b82f6]"
                        : "bg-[#121f31]/40 text-slate-400 border-white/[0.03] hover:bg-white/[0.04] hover:text-slate-200"
                    }`}
                  >
                    <span
                      className={`text-[10px] uppercase font-extrabold ${isSelected ? "text-blue-400" : "text-slate-400"}`}
                    >
                      {day.label}
                    </span>
                    <span className="opacity-30 text-[9px]">•</span>
                    <span
                      className={`text-[12px] font-black ${isSelected ? "text-white" : "text-slate-300"}`}
                    >
                      {day.dayNum}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Toggle departed/arrivals */}
          <div className="flex bg-[#0b121e] p-1 rounded-2xl border border-white/[0.04]">
            <button
              onClick={() => setTab("departures")}
              className={`flex-1 py-2.5 rounded-xl text-[12px] sm:text-[13px] font-black transition-all cursor-pointer ${
                tab === "departures"
                  ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Odjazdy
            </button>
            <button
              onClick={() => setTab("arrivals")}
              className={`flex-1 py-2.5 rounded-xl text-[12px] sm:text-[13px] font-black transition-all cursor-pointer ${
                tab === "arrivals"
                  ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Przyjazdy
            </button>
          </div>

          {/* Train List (Animated) */}
          <div>
            <div className="flex justify-between items-center mb-2.5 px-1">
              <div className="text-xs font-extrabold text-slate-400 tracking-wider uppercase">
                {DAYS.find((d) => d.key === selectedDay)?.weekday},{" "}
                {DAYS.find((d) => d.key === selectedDay)?.dayNum} {DAYS.find((d) => d.key === selectedDay)?.monthName}
              </div>
              <div className="text-[10px] font-bold text-blue-400 bg-blue-400/5 px-2.5 py-0.5 rounded-full border border-blue-500/10">
                Rozkład stacyjny
              </div>
            </div>

            <motion.div
              layout
              className="bg-[#0b121e]/80 backdrop-blur-md rounded-2xl border border-white/[0.04] overflow-hidden shadow-xl"
            >
              {isLoading ? (
                <div className="space-y-1.5 animate-pulse p-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between p-3.5 bg-white/[0.01] rounded-xl border border-white/[0.01]">
                      <div className="flex items-center space-x-3 w-2/3">
                        <div className="w-11 h-8 bg-blue-500/5 rounded-xl border border-blue-500/5"></div>
                        <div className="flex-1 space-y-1.5 pl-2.5 border-l border-white/5">
                          <div className="h-3.5 bg-white/5 rounded w-3/4"></div>
                          <div className="h-2.5 bg-white/5 rounded w-1/2"></div>
                        </div>
                      </div>
                      <div className="w-10 h-5 bg-white/5 rounded-lg"></div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <AnimatePresence mode="popLayout">
                {trains.map((train, idx) => {
                  const prefix = getTrainPrefix(train.line);
                  const isDelayed = train.status === "delayed";
                  return (
                    <motion.div
                      layout="position"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      transition={{ duration: 0.18, delay: Math.min(idx * 0.05, 0.3) }}
                      key={train.id}
                      className="flex items-center justify-between p-3.5 sm:p-4 hover:bg-white/[0.02] transition-colors cursor-pointer border-b border-white/[0.03]"
                    >
                    {/* Left Section: Train Identity Badge + Names */}
                    <div className="flex items-center min-w-0 flex-1 mr-3">
                      {/* Prefix Logo Area - Shiny physical train badge style */}
                      <div
                        className={`w-11 h-8.5 flex items-center justify-center font-black italic text-[11px] shrink-0 border rounded-xl mr-3 ${getPrefixStyle(prefix)}`}
                      >
                        {prefix}
                      </div>

                      {/* Main Info */}
                      <div className="flex-1 min-w-0 pl-2.5 border-l border-white/5">
                        {/* Line & Platform integrated */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-slate-400 text-[10px] sm:text-[11px] font-bold">
                            {train.line}
                          </span>
                          <span className="text-zinc-650 text-[9px]">•</span>
                          <span className="bg-blue-500/10 text-blue-300 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider border border-blue-500/20 flex items-center gap-1.5 shadow-[0_0_8px_rgba(59,130,246,0.05)]">
                            <span>Peron <span className="text-white font-black">{train.platform}</span></span>
                            <span className="text-blue-500/40">/</span>
                            <span>Tor <span className="text-white font-black">{train.track}</span></span>
                          </span>
                        </div>

                        <h3 className="text-white font-extrabold text-[14px] sm:text-[15px] truncate mt-1 group-hover:text-blue-200 transition-colors">
                          {train.direction}
                        </h3>
                        {train.carrier && (
                          <div
                            className={`text-[9px] font-black mt-0.5 uppercase tracking-wider ${train.carrier.colorClass}`}
                          >
                            {train.carrier.name}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Section: Time + Delay */}
                    <div className="flex flex-col items-end shrink-0 pl-2 text-right">
                      <div className="text-white font-black tracking-tight text-[15px] sm:text-[16px]">
                        {train.time}
                      </div>
                      {isDelayed && (
                        <div className="mt-1 mr-[-4px]">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/10 text-[9px] font-black tracking-wider uppercase">
                            +{train.delayMins} min
                          </span>
                        </div>
                      )}
                    </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              <button className="w-full py-4 text-xs font-bold text-slate-400 hover:text-white flex items-center justify-center gap-2 border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors uppercase tracking-wider">
                Pokaż pełny rozkład stacyjny
                <ChevronDown size={14} />
              </button>
                </>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
