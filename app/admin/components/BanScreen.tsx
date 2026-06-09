import { Clock } from 'lucide-react';

export function BanScreen() {
  return (
    <div className="min-h-screen bg-[#040609] flex items-center justify-center p-6">
      <div className="w-full max-w-4xl bg-[#0F131D] border border-white/5 border-t-white/10 rounded-3xl overflow-hidden shadow-2xl relative">
        <div className="absolute inset-0 bg-rose-500/5 mix-blend-overlay pointer-events-none" />
        
        <div className="flex flex-col md:flex-row h-full">
          {/* Content Left */}
          <div className="flex-1 p-10 md:p-14 flex flex-col justify-center">
            <h1 className="text-4xl md:text-6xl font-black text-rose-500 tracking-tight leading-tight mb-6 drop-shadow-[0_0_15px_rgba(244,63,94,0.3)]">
              ZOSTAŁEŚ<br />ZBANOWANY! 🔨
            </h1>
            <p className="text-slate-400 text-lg mb-10">Twoje urządzenie zostało zablokowane.</p>

            <div className="space-y-4 max-w-sm">
              
              <div className="flex items-center gap-4 bg-[#151B28] border border-white/5 border-t-white/10 rounded-2xl p-5">
                 <div className="text-rose-500">
                    <Clock size={24} />
                 </div>
                 <div>
                    <div className="text-xs text-slate-500 font-medium tracking-wide uppercase">Blokada wygasa</div>
                    <div className="text-sm text-white mt-1">25 maja 2024, 23:59</div>
                 </div>
              </div>

              <div className="flex items-center gap-4 bg-[#151B28] border border-white/5 border-t-white/10 rounded-2xl p-5">
                 <div className="text-rose-500">
                    <Clock size={24} />
                 </div>
                 <div>
                    <div className="text-xs text-slate-500 font-medium tracking-wide uppercase">Powód blokady</div>
                    <div className="text-sm text-white mt-1">Zbyt dużo lagów na czacie 😂</div>
                 </div>
              </div>

            </div>

            <p className="text-slate-500 text-sm mt-8">
              Jeśli uważasz, że to błąd – skontaktuj się z administratorem.
            </p>
          </div>

          {/* Media Right */}
          <div className="w-full md:w-2/5 min-h-[300px] md:min-h-full bg-black relative">
            <div className="absolute inset-0 bg-gradient-to-r from-[#0F131D] to-transparent z-10" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0F131D] to-transparent z-10 md:hidden" />
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <img 
              src="https://media.tenor.com/W2d0DIf_7C0AAAAC/risitas.gif" 
              alt="Ban" 
              className="absolute inset-0 w-full h-full object-cover opacity-80"
              style={{ objectPosition: 'center' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
