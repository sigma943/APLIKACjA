import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps {
  children?: ReactNode;
  variant?: 'purple' | 'blue' | 'emerald' | 'rose' | 'default';
  role?: string;
  status?: string;
  isStatus?: boolean;
  className?: string;
}

export function Badge({ children, variant = 'default', role, status, isStatus, className }: BadgeProps) {
  let v = variant;
  let text: ReactNode = children;

  if (role) {
    const roleUpper = role.toUpperCase();
    if (roleUpper === 'WŁAŚCICIEL') v = 'purple';
    else if (roleUpper === 'ADMIN' || roleUpper === 'ADMINISTRATOR') v = 'blue';
    else if (roleUpper === 'UŻYTKOWNIK') v = 'emerald';
    text = roleUpper === 'WŁAŚCICIEL' ? 'Właściciel' : (roleUpper === 'ADMIN' || roleUpper === 'ADMINISTRATOR') ? 'Admin' : 'Użytkownik';
  }

  if (status) {
    const statusUpper = status.toUpperCase();
    if (statusUpper === 'AKTYWNY') v = 'emerald';
    else if (statusUpper === 'ZABLOKOWANY' || statusUpper === 'WYGASŁY') v = 'rose';
    isStatus = true;
    text = statusUpper === 'AKTYWNY' ? 'Aktywny' : statusUpper === 'ZABLOKOWANY' ? 'Blokada' : 'Wygasł';
  }

  const baseClasses = "inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[8px] font-black tracking-[0.1em] uppercase transition-all duration-300 border shadow-sm relative group whitespace-nowrap";
  const variants = {
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/15",
    blue: "bg-sky-500/10 text-sky-400 border-sky-500/15",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/15",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/15",
    default: "bg-slate-800/40 text-slate-400 border-white/5 shadow-sm",
  };

  const ringVariants = {
    purple: "bg-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.6)]",
    blue: "bg-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.6)]",
    emerald: "bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]",
    rose: "bg-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.6)]",
    default: "bg-slate-400",
  };

  if (isStatus) {
    return (
      <div className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-all duration-500 whitespace-nowrap w-fit",
        v === 'emerald' ? "bg-emerald-500/5 border-emerald-500/15" : "bg-rose-500/5 border-rose-500/15",
        className
      )}>
        <div className={cn("w-1 h-1 rounded-full animate-pulse", ringVariants[v as keyof typeof ringVariants])} />
        <span className={cn("text-[8px] font-black uppercase tracking-[0.1em]", v === 'rose' ? 'text-rose-400' : v === 'emerald' ? 'text-emerald-400' : 'text-slate-400')}>{text}</span>
      </div>
    );
  }

  return (
    <span className={cn(baseClasses, variants[v as keyof typeof variants], "w-fit", className)}>
      <div className="absolute inset-x-0 bottom-0 h-[1px] bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className={cn("w-1 h-1 rounded-full flex-shrink-0", ringVariants[v as keyof typeof ringVariants])} />
      {text}
    </span>
  );
}
