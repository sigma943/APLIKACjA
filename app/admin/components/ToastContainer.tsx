import { motion, AnimatePresence } from 'motion/react';
import { Lock, LockOpen, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastMessage = {
  id: string;
  title: string;
  message: string;
  type: 'ban' | 'unban' | 'role_change';
};

interface ToastContainerProps {
  toasts: ToastMessage[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  return (
    <div className="fixed top-4 left-0 right-0 z-[100] flex flex-col items-center gap-2 pointer-events-none px-4">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            className="w-full max-w-sm pointer-events-auto"
          >
            <div className={cn(
              "relative overflow-hidden bg-[#0F131D]/95 backdrop-blur-xl border border-white/5 rounded-[1.25rem] p-4 flex items-center justify-between shadow-2xl",
              toast.type === 'ban' ? "shadow-[0_10px_40px_rgba(244,63,94,0.15)]" : "shadow-[0_10px_40px_rgba(16,185,129,0.15)]"
            )}>
              {/* Left Accent Glow Line */}
              <div className={cn(
                "absolute left-0 top-0 bottom-0 w-1",
                toast.type === 'ban' ? "bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,1)]" : "bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,1)]"
              )} />
              
              <div className="flex items-center gap-4 pl-2">
                <div className={cn(
                  "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border",
                  toast.type === 'ban' 
                    ? "bg-rose-500/10 border-rose-500/20 text-rose-400" 
                    : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                )}>
                  {toast.type === 'ban' ? <Lock size={20} /> : <LockOpen size={20} />}
                </div>
                <div>
                  <div className="text-white font-bold text-sm leading-tight mb-1">{toast.title}</div>
                  <div className="text-slate-400 text-[13px] leading-tight font-medium">{toast.message}</div>
                </div>
              </div>

              <button 
                onClick={() => onClose(toast.id)}
                className="p-2 text-slate-500 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
