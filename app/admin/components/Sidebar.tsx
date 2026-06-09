import type { CSSProperties } from 'react';
import { Bus, Monitor, Users, Activity, Lock, X, Pencil, Wrench, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIDEBAR_NAV_DEF: { id: string; label: string; icon: LucideIcon }[] = [
  { icon: Monitor, label: 'Urządzenia', id: 'devices' },
  { icon: Users, label: 'Administratorzy', id: 'operators' },
  { icon: Lock, label: 'Bany / Blokady', id: 'bans' },
  { icon: Activity, label: 'Logi aktywności', id: 'logs' },
  { icon: Wrench, label: 'Konserwacja', id: 'maintenance' },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  user: {
    name: string;
    role: string;
    initials: string;
  };
  activeView: string;
  onViewChange: (view: string) => void;
  embedded?: boolean;
  onExit?: () => void;
  /** Kolor akcentu jak na mapie (ustawienia → kolorystyka) */
  accentColor?: string;
  /** Widoczne zakładki (kolejność jak w menu). Domyślnie wszystkie. */
  allowedNavIds?: readonly string[];
  /** Callback do edycji własnej nazwy/profilu */
  onEditProfile?: () => void;
}

export function Sidebar({
  isOpen,
  onClose,
  user,
  activeView,
  onViewChange,
  embedded: _embedded,
  onExit: _onExit,
  accentColor = '#10b981',
  allowedNavIds,
  onEditProfile,
}: SidebarProps) {
  const allowed = allowedNavIds ?? SIDEBAR_NAV_DEF.map((n) => n.id);
  const navItems = SIDEBAR_NAV_DEF.filter((n) => allowed.includes(n.id));

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <div className={cn(
        "fixed inset-y-0 left-0 z-[7000] w-64 border-r border-white/5 bg-[#080B12] flex flex-col justify-between transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0 lg:flex-shrink-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div>
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-2 font-extrabold tracking-tight" style={{ color: accentColor }}>
              <Bus className="h-6 w-6 shrink-0 md:h-7 md:w-7" strokeWidth={2.25} aria-hidden />
              <span className="text-lg md:text-xl">PKS Live</span>
            </div>
            <button className="lg:hidden text-slate-400 hover:text-white cursor-pointer active:scale-95 transition-all" onClick={onClose}>
              <X size={24} />
            </button>
          </div>

          <div className="px-4">
            <h3 className="text-xs font-semibold text-slate-500 mb-4 px-2 tracking-wider mt-2">PANEL ADMINISTRATORA</h3>
            <nav className="space-y-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onViewChange(item.id);
                      onClose();
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all duration-200 cursor-pointer shadow-sm border',
                      isActive
                        ? 'bg-white/[0.06] font-bold border-white/15 shadow-lg'
                        : 'text-slate-400 hover:text-white hover:bg-white/5 hover:scale-[1.02] active:scale-[0.98] border-transparent',
                    )}
                    style={
                      isActive
                        ? ({
                            color: accentColor,
                            borderColor: `${accentColor}40`,
                            boxShadow: `0 0 20px ${accentColor}18`,
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    <Icon
                      size={18}
                      className={cn('shrink-0 transition-transform duration-300', isActive ? 'scale-110' : 'text-slate-400')}
                      style={isActive ? { color: accentColor } : undefined}
                    />
                    <span className={cn("text-sm", isActive && "tracking-wide")}>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:pb-4">
          <div className="w-full flex items-center justify-between p-4 rounded-3xl bg-[#0F131D] border border-white/5 shadow-xl">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border font-black text-[10px] uppercase"
                style={{
                  color: accentColor,
                  borderColor: `${accentColor}40`,
                  backgroundColor: `${accentColor}14`,
                }}
              >
                {user.initials}
              </div>
              <div className="text-left flex flex-col min-w-0">
                <div className="text-sm font-black text-white line-clamp-1 truncate tracking-tight">{user.name}</div>
                <div className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none mt-1 truncate">{user.role}</div>
              </div>
            </div>
            {onEditProfile && (
              <button
                onClick={onEditProfile}
                title="Zmień wyświetlaną nazwę"
                className="ml-2 shrink-0 rounded-xl p-1.5 text-slate-500 transition-all hover:bg-white/10 hover:text-white cursor-pointer"
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
