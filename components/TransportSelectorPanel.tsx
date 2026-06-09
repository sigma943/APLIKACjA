'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Bus, Check, X } from 'lucide-react';
import type { TransportProviderId } from '@/lib/pks-client';

export type TransportOption = {
  id: TransportProviderId;
  label: string;
  color: string;
  enabled: boolean;
  type: 'bus' | 'train';
  iconVariant: 'mpk_rzeszow' | 'marcel' | 'default_bus' | 'IC' | 'EIC' | 'EIP';
};

type TransportSelectorPanelProps = {
  open: boolean;
  options: TransportOption[];
  selectedIds: TransportProviderId[];
  onClose: () => void;
  onToggle: (providerId: TransportProviderId) => void;
  onApply: () => void;
  isDark: boolean;
  themeMode?: string;
  transparentUI?: boolean;
};

const providerMeta: Record<string, { name: string; image: string }> = {
  pks: { name: 'PKS Rzeszów', image: '/dodaj/pks.png' },
  mpk_rzeszow: { name: 'MPK Rzeszów', image: '/dodaj/mpk-rzeszow.png' },
  marcel: { name: 'Marcel', image: '/dodaj/marcel.png' },
};

function panelTheme(isDark: boolean, themeMode?: string, transparentUI = false) {
  const glass = transparentUI ? 'backdrop-blur-2xl backdrop-saturate-150' : '';

  if (themeMode === 'dark-oled') {
    return {
      shell: `border-white/10 ${transparentUI ? 'bg-black/76' : 'bg-black/96'} text-white ${glass}`,
      header: 'border-white/10',
      sub: 'text-slate-300',
      cardBase: 'bg-white/[0.035]',
      cardIdle: 'border-white/12 hover:bg-white/[0.06]',
      close: 'bg-white/10 text-slate-200 hover:bg-white/15',
      section: 'text-white',
      footer: 'border-white/10',
    };
  }

  if (themeMode === 'dark-aurora') {
    return {
      shell: `border-fuchsia-300/16 ${transparentUI ? 'bg-[#111026]/78' : 'bg-[#111026]/96'} text-white ${glass}`,
      header: 'border-fuchsia-300/14',
      sub: 'text-violet-200/76',
      cardBase: 'bg-white/[0.045]',
      cardIdle: 'border-violet-200/14 hover:bg-white/[0.075]',
      close: 'bg-white/10 text-violet-100 hover:bg-white/15',
      section: 'text-violet-50',
      footer: 'border-fuchsia-300/14',
    };
  }

  if (themeMode === 'light-warm') {
    return {
      shell: `border-[#cfc89f] ${transparentUI ? 'bg-[#f8f2e4]/78' : 'bg-[#f8f2e4]/97'} text-[#2f2a1f] ${glass}`,
      header: 'border-[#d8cfaa]',
      sub: 'text-[#6d674f]',
      cardBase: 'bg-white/45',
      cardIdle: 'border-[#d3c99f] hover:bg-white/70',
      close: 'bg-[#e7ddbd] text-[#5d563f] hover:bg-[#ddd1aa]',
      section: 'text-[#2f2a1f]',
      footer: 'border-[#d8cfaa]',
    };
  }

  if (!isDark) {
    return {
      shell: `border-slate-200 ${transparentUI ? 'bg-white/78' : 'bg-white/97'} text-slate-950 ${glass}`,
      header: 'border-slate-200',
      sub: 'text-slate-600',
      cardBase: 'bg-slate-50',
      cardIdle: 'border-slate-200 hover:bg-white hover:border-slate-300',
      close: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
      section: 'text-slate-950',
      footer: 'border-slate-200',
    };
  }

  return {
    shell: `border-white/10 ${transparentUI ? 'bg-[#071017]/78' : 'bg-[#071017]/96'} text-white ${glass}`,
    header: 'border-white/10',
    sub: 'text-slate-300',
    cardBase: 'bg-white/[0.04]',
    cardIdle: 'border-white/12 hover:bg-white/[0.07]',
    close: 'bg-white/10 text-slate-200 hover:bg-white/15',
    section: 'text-white',
    footer: 'border-white/10',
  };
}

export default function TransportSelectorPanel({
  open,
  options,
  selectedIds,
  onClose,
  onToggle,
  onApply,
  isDark,
  themeMode,
  transparentUI = false,
}: TransportSelectorPanelProps) {
  const selectedSet = new Set(selectedIds);
  const selectedCount = selectedIds.length;
  const theme = panelTheme(isDark, themeMode, transparentUI);
  const busOptions = options.filter((option) => option.type === 'bus');
  const trainOptions = options.filter((option) => option.type === 'train');

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 z-[120] flex items-end justify-center bg-black/45 p-2 pb-[calc(86px+env(safe-area-inset-bottom))] backdrop-blur-sm md:items-center md:p-8"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 22, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            onClick={(event) => event.stopPropagation()}
            className={`flex max-h-[calc(100dvh-96px-env(safe-area-inset-bottom))] w-full flex-col overflow-hidden rounded-[28px] border shadow-[0_28px_90px_rgba(0,0,0,0.45)] md:max-h-[min(720px,calc(100dvh-64px))] md:max-w-[846px] ${theme.shell}`}
          >
            <div className={`flex items-start justify-between gap-4 border-b px-5 py-4 md:px-6 md:py-6 ${theme.header}`}>
              <div className="min-w-0">
                <h2 className="text-2xl font-black tracking-tight md:text-[26px]">Przewoźnicy</h2>
                <p className={`mt-2 max-w-[520px] text-sm leading-relaxed md:text-base ${theme.sub}`}>
                  Wybierz przewoźnika którego autobusy mają być na mapie
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] transition-colors ${theme.close}`}
                aria-label="Zamknij panel przewoźników"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 md:px-6 md:py-6">
              <h3 className={`mb-3 flex items-center gap-2 text-base font-black tracking-tight md:mb-4 md:text-xl ${theme.section}`}>
                <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-[#0fb1bf]/18 text-[#0fb1bf] md:h-9 md:w-9">
                  <Bus className="h-[18px] w-[18px] md:h-5 md:w-5" />
                </span>
                Autobusy
              </h3>
              <div className="flex flex-wrap gap-2 sm:grid sm:grid-cols-3 sm:gap-5 md:gap-8">
                {busOptions.map((option) => {
                  const isSelected = selectedSet.has(option.id);
                  const meta = providerMeta[option.id] || { name: option.label, image: '/dodaj/pks.png' };

                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={!option.enabled}
                      onClick={() => option.enabled && onToggle(option.id)}
                      className={`group w-[calc(25%-0.375rem)] min-w-0 text-center transition-transform active:scale-[0.985] sm:w-auto ${
                        option.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      <div
                        className={`relative aspect-square overflow-hidden rounded-[14px] border transition-all sm:aspect-[1.24] sm:rounded-[22px] ${theme.cardBase} ${
                          isSelected
                            ? 'shadow-[0_20px_48px_rgba(0,0,0,0.22)]'
                            : theme.cardIdle
                        }`}
                        style={{
                          borderColor: isSelected ? option.color : undefined,
                          boxShadow: isSelected
                            ? `0 18px 46px ${option.color}22, inset 0 0 0 1px ${option.color}28`
                            : undefined,
                        }}
                      >
                        <img
                          src={meta.image}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
                          draggable={false}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/26 via-transparent to-white/4" />
                        {isSelected && (
                          <div
                            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white shadow-lg sm:right-3 sm:top-3 sm:h-9 sm:w-9"
                            style={{ backgroundColor: option.color }}
                          >
                            <Check className="h-3 w-3 stroke-[3] sm:h-5 sm:w-5" />
                          </div>
                        )}
                      </div>
                      <div className={`mt-1.5 truncate text-[11px] font-black tracking-tight sm:mt-4 sm:text-lg md:text-xl ${theme.section}`}>
                        {meta.name}
                      </div>
                    </button>
                  );
                })}
              </div>

              {trainOptions.length > 0 && (
                <>
                  <h3 className={`mb-3 mt-7 flex items-center gap-2 text-base font-black tracking-tight md:mb-4 md:mt-9 md:text-xl ${theme.section}`}>
                    <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-[#1d4ed8]/16 text-[#1d4ed8] md:h-9 md:w-9">
                      <Bus className="h-[18px] w-[18px] md:h-5 md:w-5" />
                    </span>
                    Kolej
                  </h3>
                  <div className="flex flex-wrap gap-2 sm:grid sm:grid-cols-3 sm:gap-5 md:gap-8">
                    {trainOptions.map((option) => {
                      const isSelected = selectedSet.has(option.id);
                      const meta = providerMeta[option.id] || { name: option.label, image: '/train-icons/IC.svg' };

                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={!option.enabled}
                          onClick={() => option.enabled && onToggle(option.id)}
                          className={`group w-[calc(25%-0.375rem)] min-w-0 text-center transition-transform active:scale-[0.985] sm:w-auto ${
                            option.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                          }`}
                        >
                          <div
                            className={`relative aspect-square overflow-hidden rounded-[14px] border transition-all sm:aspect-[1.24] sm:rounded-[22px] ${theme.cardBase} ${
                              isSelected
                                ? 'shadow-[0_20px_48px_rgba(0,0,0,0.22)]'
                                : theme.cardIdle
                            }`}
                            style={{
                              borderColor: isSelected ? option.color : undefined,
                              boxShadow: isSelected
                                ? `0 18px 46px ${option.color}22, inset 0 0 0 1px ${option.color}28`
                                : undefined,
                            }}
                          >
                            <img
                              src={meta.image}
                              alt=""
                              className="h-full w-full bg-white object-contain p-4 transition-transform duration-300 group-hover:scale-[1.025]"
                              draggable={false}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-white/4" />
                            {isSelected && (
                              <div
                                className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white shadow-lg sm:right-3 sm:top-3 sm:h-9 sm:w-9"
                                style={{ backgroundColor: option.color }}
                              >
                                <Check className="h-3 w-3 stroke-[3] sm:h-5 sm:w-5" />
                              </div>
                            )}
                          </div>
                          <div className={`mt-1.5 truncate text-[11px] font-black tracking-tight sm:mt-4 sm:text-lg md:text-xl ${theme.section}`}>
                            {meta.name}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className={`flex justify-end border-t px-5 py-4 md:px-6 md:py-5 ${theme.footer}`}>
              <button
                type="button"
                onClick={onApply}
                className="inline-flex h-[52px] w-full items-center justify-center rounded-[18px] bg-[#0fb1bf] px-7 text-sm font-black text-white shadow-[0_16px_36px_rgba(15,177,191,0.34)] transition-transform hover:scale-[1.01] active:scale-[0.99] md:w-auto md:min-w-44"
              >
                Zastosuj ({selectedCount})
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
