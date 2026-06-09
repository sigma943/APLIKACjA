import { X, Lock, Upload, Image as ImageIcon, EyeOff } from 'lucide-react';
import { Device } from '../types';
import React, { useState, useRef, ChangeEvent } from 'react';
import { motion } from 'motion/react';

interface BanModalProps {
  device: Device;
  onClose: () => void;
  onConfirm: (device: Device, reason: string, expiryDate: string, gifUrl: string, silent: boolean) => void;
}

export function BanModal({ device, onClose, onConfirm }: BanModalProps) {
  const [gifUrl, setGifUrl] = useState('');
  const [includeImage, setIncludeImage] = useState(false);
  const [silentBan, setSilentBan] = useState(false);
  const [imageError, setImageError] = useState('');
  const [reason, setReason] = useState('Zbyt dużo lagów na czacie');
  const [expiryDate, setExpiryDate] = useState('');
  const [isPermanent, setIsPermanent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageError('');
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setGifUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const togglePermanent = () => {
    setIsPermanent((prev) => {
      const next = !prev;
      if (next) setExpiryDate('');
      return next;
    });
  };

  const handleBan = () => {
    if (!silentBan && includeImage && !gifUrl) {
      setImageError('Dodaj obrazek albo wyłącz tę opcję.');
      return;
    }
    onConfirm(device, reason, isPermanent ? '' : expiryDate, !silentBan && includeImage ? gifUrl : '', silentBan);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020408]/80 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative flex max-h-[calc(100dvh-2rem-env(safe-area-inset-bottom))] w-full max-w-sm flex-col overflow-hidden rounded-3xl border border-white/10 border-t-white/20 bg-[#0F131D] shadow-2xl"
      >
        <div className="px-6 py-5 flex items-center justify-between border-b border-white/5">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Zablokuj urządzenie</h2>
            <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">Konfiguracja blokady dla tego urządzenia</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-all p-2 rounded-xl hover:bg-white/5 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest px-1">Data wygaśnięcia blokady</label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              disabled={isPermanent}
              className="w-full bg-[#151B28] border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-rose-500/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              id="ban-date"
            />
          </div>

          <button
            type="button"
            onClick={togglePermanent}
            className={[
              'w-full rounded-2xl border px-4 py-4 text-left transition-all cursor-pointer',
              isPermanent
                ? 'border-rose-500/40 bg-rose-500/12 shadow-[0_0_24px_rgba(244,63,94,0.12)]'
                : 'border-white/10 bg-[#151B28] hover:bg-[#1a2232]'
            ].join(' ')}
          >
            <div className="flex items-start gap-3">
              <div className={[
                'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border',
                isPermanent ? 'border-rose-400/40 bg-rose-500/15 text-rose-300' : 'border-white/10 bg-white/5 text-slate-400'
              ].join(' ')}>
                <Lock size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 pr-2">
                    <p className="text-sm font-semibold text-white">Ban permanentny</p>
                    <p className="mt-1 text-xs text-slate-400">Blokada bez daty wygaśnięcia. Na ekranie bana pokażemy: Nigdy.</p>
                  </div>
                  <div className={[
                    'mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full border px-1 transition-all',
                    isPermanent ? 'border-rose-400/50 bg-rose-500/25' : 'border-white/10 bg-white/5'
                  ].join(' ')}>
                    <div className={[
                      'h-[18px] w-[18px] rounded-full bg-white transition-all',
                      isPermanent ? 'translate-x-[18px]' : 'translate-x-0'
                    ].join(' ')} />
                  </div>
                </div>
              </div>
            </div>
          </button>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest px-1">Powód blokady <span className="text-slate-600 font-normal">(opcjonalnie)</span></label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-[#151B28] border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-rose-500/50 transition-colors"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setSilentBan((prev) => {
                const next = !prev;
                if (next) {
                  setIncludeImage(false);
                  setGifUrl('');
                  setImageError('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }
                return next;
              });
            }}
            className={[
              'w-full rounded-2xl border px-4 py-4 text-left transition-all cursor-pointer',
              silentBan
                ? 'border-amber-500/40 bg-amber-500/12 shadow-[0_0_24px_rgba(245,158,11,0.12)]'
                : 'border-white/10 bg-[#151B28] hover:bg-[#1a2232]'
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className={[
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border',
                  silentBan ? 'border-amber-400/40 bg-amber-500/15 text-amber-300' : 'border-white/10 bg-white/5 text-slate-400'
                ].join(' ')}>
                  <EyeOff size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Cichy ban</p>
                  <p className="mt-1 text-xs text-slate-400">Zamiast komunikatu o banie pokaże neutralny błąd aplikacji.</p>
                </div>
              </div>
              <div className={[
                'flex h-6 w-11 shrink-0 items-center rounded-full border px-1 transition-all',
                silentBan ? 'border-amber-400/50 bg-amber-500/25' : 'border-white/10 bg-white/5'
              ].join(' ')}>
                <div className={[
                  'h-[18px] w-[18px] rounded-full bg-white transition-all',
                  silentBan ? 'translate-x-[18px]' : 'translate-x-0'
                ].join(' ')} />
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={silentBan}
            onClick={() => {
              setIncludeImage((prev) => {
                const next = !prev;
                if (!next) {
                  setGifUrl('');
                  setImageError('');
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }
                return next;
              });
            }}
            className={[
              'w-full rounded-2xl border px-4 py-4 text-left transition-all',
              silentBan
                ? 'border-white/5 bg-[#151B28] opacity-45 cursor-not-allowed grayscale-[0.4]'
                : includeImage
                ? 'border-sky-500/40 bg-sky-500/12 shadow-[0_0_24px_rgba(14,165,233,0.12)]'
                : 'border-white/10 bg-[#151B28] hover:bg-[#1a2232] cursor-pointer'
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className={[
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border',
                  includeImage && !silentBan ? 'border-sky-400/40 bg-sky-500/15 text-sky-300' : 'border-white/10 bg-white/5 text-slate-400'
                ].join(' ')}>
                  <ImageIcon size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">Dodaj obrazek</p>
                  <p className="mt-1 text-xs text-slate-400">Po włączeniu obrazek jest wymagany.</p>
                </div>
              </div>
              <div className={[
                'flex h-6 w-11 shrink-0 items-center rounded-full border px-1 transition-all',
                includeImage && !silentBan ? 'border-sky-400/50 bg-sky-500/25' : 'border-white/10 bg-white/5'
              ].join(' ')}>
                <div className={[
                  'h-[18px] w-[18px] rounded-full bg-white transition-all',
                  includeImage && !silentBan ? 'translate-x-[18px]' : 'translate-x-0'
                ].join(' ')} />
              </div>
            </div>
          </button>

          {includeImage && !silentBan && (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest px-1">Media dla blokady (GIF/JPG)</label>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 bg-[#151B28] hover:bg-[#1c2435] border border-white/10 rounded-xl py-3 px-4 text-sm text-slate-300 transition-all group cursor-pointer"
                >
                  <Upload size={16} className="group-hover:text-white" />
                  <span>{gifUrl ? 'Zmień obrazek' : 'Wybierz plik z komputera'}</span>
                </button>
                {imageError && <p className="mt-2 px-1 text-xs font-semibold text-rose-300">{imageError}</p>}
              </div>

              {gifUrl && (
                <div className="relative group">
                  <div className="w-full h-40 rounded-2xl border border-white/5 overflow-hidden bg-black/40 flex items-center justify-center">
                    <img src={gifUrl} alt="Ban GIF preview" className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 rounded-b-2xl bg-gradient-to-t from-black/80 to-transparent px-3 py-2 text-[10px] font-medium text-white/70">
                    Podgląd obrazka blokady
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleBan}
            className="w-full flex items-center justify-center gap-3 bg-rose-500 hover:bg-rose-600 text-white py-4 rounded-2xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_30px_rgba(244,63,94,0.3)] cursor-pointer"
          >
            <Lock size={18} />
            ZABLOKUJ URZĄDZENIE
          </button>
        </div>
      </motion.div>
    </div>
  );
}
