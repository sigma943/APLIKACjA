import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import {
  Activity,
  CheckCircle2,
  Clock3,
  Database,
  Filter,
  Globe2,
  History,
  Menu,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  TestTube2,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, functions } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import type { MaintenanceChange, MaintenanceEndpoint, MaintenanceEndpointRole } from '../types';

const DEFAULT_ENDPOINT: MaintenanceEndpoint = {
  id: 'default-transport-api',
  name: 'Główny (PROD)',
  url: 'https://us-central1-aplikacja-b20fa.cloudfunctions.net/transportApi',
  role: 'production',
  priority: 1,
  region: 'PL',
  source: 'Firestore',
  fallbackEnabled: true,
  enabled: true,
  active: true,
};

const roleLabels: Record<MaintenanceEndpointRole, string> = {
  production: 'Production',
  backup: 'Backup',
  staging: 'Staging',
  legacy: 'Legacy',
  test: 'Test',
};

const roleOptions: MaintenanceEndpointRole[] = ['production', 'backup', 'staging', 'legacy', 'test'];

const endpointStatus = (endpoint: MaintenanceEndpoint) => {
  if (!endpoint.enabled) return 'Nieaktywny';
  if (endpoint.active) return 'Aktywny';
  if (endpoint.lastTest?.ok === false) return 'Błąd';
  return 'Standby';
};

const statusClass = (label: string) => {
  if (label === 'Aktywny') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300';
  if (label === 'Standby') return 'border-sky-400/30 bg-sky-500/10 text-sky-300';
  if (label === 'Błąd') return 'border-rose-400/30 bg-rose-500/10 text-rose-300';
  return 'border-slate-500/30 bg-slate-500/10 text-slate-300';
};

const safeDate = (value?: string) => {
  if (!value) return '-';
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('pl-PL') : value;
};

const changeDate = (ms: number) => (ms ? new Date(ms).toLocaleString('pl-PL') : '-');

const callSaveEndpoint = httpsCallable(functions, 'saveMaintenanceEndpoint');
const callTestEndpoint = httpsCallable(functions, 'testMaintenanceEndpoint');
const callSetActive = httpsCallable(functions, 'setActiveMaintenanceEndpoint');
const callDisable = httpsCallable(functions, 'disableMaintenanceEndpoint');
const callRollback = httpsCallable(functions, 'rollbackMaintenanceEndpoint');

function normalizeEndpoint(id: string, data: Record<string, unknown>): MaintenanceEndpoint {
  const role = String(data.role || 'production') as MaintenanceEndpointRole;
  return {
    id,
    name: String(data.name || 'Endpoint'),
    url: String(data.url || ''),
    role: roleOptions.includes(role) ? role : 'production',
    priority: Number(data.priority || 1),
    region: String(data.region || 'PL'),
    source: String(data.source || 'Firestore'),
    fallbackEnabled: Boolean(data.fallbackEnabled),
    enabled: data.enabled !== false,
    active: data.active === true,
    lastTest: data.lastTest && typeof data.lastTest === 'object'
      ? data.lastTest as MaintenanceEndpoint['lastTest']
      : undefined,
  };
}

function emptyDraft(endpoint?: MaintenanceEndpoint): MaintenanceEndpoint {
  return endpoint ? { ...endpoint } : {
    ...DEFAULT_ENDPOINT,
    id: '',
    name: 'Nowy endpoint',
    url: '',
    active: false,
    priority: 5,
    role: 'backup',
  };
}

export function MaintenanceView({
  onMenuClick,
  canEdit,
}: {
  onMenuClick: () => void;
  canEdit: boolean;
}) {
  const [endpoints, setEndpoints] = useState<MaintenanceEndpoint[]>([]);
  const [changes, setChanges] = useState<MaintenanceChange[]>([]);
  const [settings, setSettings] = useState<{ activeEndpointId?: string; previousEndpointId?: string }>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'enabled' | 'disabled'>('all');
  const [sort, setSort] = useState<'priority' | 'name' | 'latency'>('priority');
  const [selectedId, setSelectedId] = useState<string>('default-transport-api');
  const [draft, setDraft] = useState<MaintenanceEndpoint>(DEFAULT_ENDPOINT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'maintenance_endpoints'), (snap) => {
      const rows = snap.docs.map((entry) => normalizeEndpoint(entry.id, entry.data() as Record<string, unknown>));
      setEndpoints(rows.length ? rows : [DEFAULT_ENDPOINT]);
    }, (err) => setError(err.message || String(err)));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'admin_settings', 'maintenance'), (snap) => {
      setSettings(snap.exists() ? snap.data() as { activeEndpointId?: string; previousEndpointId?: string } : {});
    }, () => undefined);
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'maintenance_changes'), orderBy('createdAt', 'desc'), limit(40));
    const unsub = onSnapshot(q, (snap) => {
      setChanges(snap.docs.map((entry) => {
        const data = entry.data() as any;
        const createdAtMs = data.createdAt?.toDate?.()?.getTime?.() || 0;
        return {
          id: entry.id,
          action: String(data.action || ''),
          endpointId: String(data.endpointId || ''),
          actorId: String(data.actorId || ''),
          summary: String(data.summary || ''),
          createdAtMs,
        };
      }));
    }, () => undefined);
    return () => unsub();
  }, []);

  const visibleEndpoints = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = endpoints.filter((endpoint) => {
      const matchesSearch = !q || [endpoint.name, endpoint.url, endpoint.region, endpoint.source, endpoint.role]
        .some((value) => String(value).toLowerCase().includes(q));
      const matchesFilter =
        filter === 'all' ||
        (filter === 'active' && endpoint.active) ||
        (filter === 'enabled' && endpoint.enabled) ||
        (filter === 'disabled' && !endpoint.enabled);
      return matchesSearch && matchesFilter;
    });
    return [...filtered].sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, 'pl');
      if (sort === 'latency') return (left.lastTest?.latencyMs ?? 999999) - (right.lastTest?.latencyMs ?? 999999);
      return left.priority - right.priority || left.name.localeCompare(right.name, 'pl');
    });
  }, [endpoints, filter, search, sort]);

  const selectedEndpoint = endpoints.find((endpoint) => endpoint.id === selectedId) || endpoints[0] || DEFAULT_ENDPOINT;
  const activeEndpoint = endpoints.find((endpoint) => endpoint.active || endpoint.id === settings.activeEndpointId) || DEFAULT_ENDPOINT;
  const successfulTests = endpoints.filter((endpoint) => endpoint.lastTest?.ok).length;
  const lastGlobalTest = endpoints
    .map((endpoint) => endpoint.lastTest?.testedAt || '')
    .filter(Boolean)
    .sort()
    .pop();

  useEffect(() => {
    if (!selectedEndpoint) return;
    setDraft(emptyDraft(selectedEndpoint));
  }, [selectedEndpoint?.id]);

  const runAction = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const selectEndpoint = (endpoint: MaintenanceEndpoint) => {
    setSelectedId(endpoint.id);
    setDraft(emptyDraft(endpoint));
  };

  const saveDraft = () => runAction('save', () => callSaveEndpoint({ endpoint: draft }));
  const testSelected = () => runAction('test', () => callTestEndpoint({ endpointId: selectedEndpoint.id || undefined, url: selectedEndpoint.id ? undefined : draft.url }));
  const activateSelected = () => runAction('active', () => callSetActive({ endpointId: selectedEndpoint.id }));
  const disableSelected = () => runAction('disable', () => callDisable({ endpointId: selectedEndpoint.id }));
  const rollback = () => runAction('rollback', () => callRollback({}));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#040609] p-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] sm:p-8 sm:pb-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onMenuClick} className="lg:hidden flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-400">
              <Menu size={20} />
            </button>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight text-white sm:text-2xl">Konserwacja</h1>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Zarządzanie infrastrukturą API</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#111623] px-4 text-xs font-black uppercase tracking-widest text-slate-300 transition-colors hover:bg-white/5"
          >
            <History size={15} />
            Historia zmian
          </button>
        </header>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatusCard icon={<Globe2 size={22} />} title="Aktywny endpoint" value={activeEndpoint.url.replace(/^https?:\/\//, '')} hint={activeEndpoint.enabled ? 'Aktywny' : 'Fallback'} tone="cyan" />
          <StatusCard icon={<Database size={22} />} title="Źródło konfiguracji" value="Firestore" hint={endpoints.length ? `${endpoints.length} endpointów` : 'fallback .env'} tone="blue" />
          <StatusCard icon={<Activity size={22} />} title="Status infrastruktury" value={endpoints.some((e) => e.lastTest?.ok === false) ? 'Wymaga uwagi' : 'Stabilny'} hint={`${successfulTests}/${endpoints.length} testów OK`} tone="emerald" />
          <StatusCard icon={<Clock3 size={22} />} title="Ostatni test globalny" value={lastGlobalTest ? safeDate(lastGlobalTest) : 'Brak danych'} hint={activeEndpoint.lastTest?.latencyMs ? `${activeEndpoint.lastTest.latencyMs} ms` : 'uruchom test'} tone="violet" />
        </section>

        <section className="rounded-3xl border border-white/10 bg-[#0b1019] shadow-2xl">
          <div className="grid gap-3 border-b border-white/5 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Szukaj endpointu..."
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 text-sm font-semibold text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/40"
              />
            </div>
            <SelectButton icon={<SlidersHorizontal size={15} />} value={sort} onChange={(value) => setSort(value as typeof sort)} options={[['priority', 'Sortowanie'], ['name', 'Nazwa'], ['latency', 'Opóźnienie']]} />
            <SelectButton icon={<Filter size={15} />} value={filter} onChange={(value) => setFilter(value as typeof filter)} options={[['all', 'Wszystkie'], ['active', 'Aktywne'], ['enabled', 'Włączone'], ['disabled', 'Wyłączone']]} />
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                setSelectedId('');
                setDraft(emptyDraft());
              }}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/10 px-4 text-xs font-black uppercase tracking-widest text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-40"
            >
              <Plus size={15} />
              Dodaj
            </button>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="bg-white/[0.025] text-[10px] uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-5 py-4">Nazwa endpointu</th>
                  <th className="px-4 py-4">URL</th>
                  <th className="px-4 py-4">Rola</th>
                  <th className="px-4 py-4">Priorytet</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-4 py-4">Opóźnienie</th>
                  <th className="px-4 py-4">Region</th>
                  <th className="px-4 py-4">Fallback</th>
                  <th className="px-4 py-4">Ostatni test</th>
                  <th className="px-4 py-4 text-right">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visibleEndpoints.map((endpoint) => {
                  const status = endpointStatus(endpoint);
                  return (
                    <tr key={endpoint.id} className={cn('transition-colors hover:bg-white/[0.03]', selectedEndpoint.id === endpoint.id && 'bg-cyan-500/[0.04]')}>
                      <td className="px-5 py-4">
                        <button type="button" onClick={() => selectEndpoint(endpoint)} className="flex min-w-0 items-center gap-3 text-left">
                          <span className={cn('h-3 w-3 shrink-0 rounded-full', endpoint.active ? 'bg-cyan-400' : endpoint.enabled ? 'bg-slate-500' : 'bg-rose-400')} />
                          <span className="min-w-0">
                            <span className="block truncate font-black text-white">{endpoint.name}</span>
                            {endpoint.active && <span className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Aktywny</span>}
                          </span>
                        </button>
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-4 font-mono text-[11px] text-slate-300">{endpoint.url}</td>
                      <td className="px-4 py-4"><Badge>{roleLabels[endpoint.role]}</Badge></td>
                      <td className="px-4 py-4 font-mono text-slate-300">{endpoint.priority}</td>
                      <td className="px-4 py-4"><Badge className={statusClass(status)}>{status}</Badge></td>
                      <td className="px-4 py-4 font-mono text-cyan-300">{endpoint.lastTest?.latencyMs ? `${endpoint.lastTest.latencyMs} ms` : '-'}</td>
                      <td className="px-4 py-4 text-slate-300">{endpoint.region}</td>
                      <td className="px-4 py-4">{endpoint.fallbackEnabled ? <Badge>Tak</Badge> : <Badge className="border-rose-400/30 bg-rose-500/10 text-rose-300">Nie</Badge>}</td>
                      <td className="px-4 py-4 text-[11px] text-slate-400">{safeDate(endpoint.lastTest?.testedAt)}</td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <IconButton title="Edytuj" onClick={() => selectEndpoint(endpoint)} icon={<Pencil size={15} />} />
                          <IconButton title="Testuj" onClick={() => runAction(`test-${endpoint.id}`, () => callTestEndpoint({ endpointId: endpoint.id }))} icon={<TestTube2 size={15} />} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 p-3 md:hidden">
            {visibleEndpoints.map((endpoint) => {
              const status = endpointStatus(endpoint);
              return (
                <button
                  key={endpoint.id}
                  type="button"
                  onClick={() => selectEndpoint(endpoint)}
                  className={cn('w-full rounded-2xl border border-white/10 bg-[#111623] p-4 text-left shadow-lg', selectedEndpoint.id === endpoint.id && 'border-cyan-400/30')}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-black text-white">{endpoint.name}</div>
                      <div className="mt-1 truncate font-mono text-[11px] text-slate-400">{endpoint.url}</div>
                    </div>
                    <MoreVertical className="shrink-0 text-slate-500" size={18} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge>{roleLabels[endpoint.role]}</Badge>
                    <Badge className={statusClass(status)}>{status}</Badge>
                    <Badge>{endpoint.region}</Badge>
                    <Badge>{endpoint.lastTest?.latencyMs ? `${endpoint.lastTest.latencyMs} ms` : 'Brak testu'}</Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 rounded-3xl border border-cyan-400/20 bg-[#07111a] p-4 shadow-2xl xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.8fr)_minmax(260px,0.7fr)]">
          <div className="min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Edytuj endpoint</h2>
                <p className="mt-1 text-xs text-slate-500">{draft.id || 'nowy endpoint'}</p>
              </div>
              {draft.active && <Badge className="border-cyan-400/30 bg-cyan-500/10 text-cyan-200">Aktywny</Badge>}
            </div>
            <EndpointForm draft={draft} disabled={!canEdit || Boolean(busy)} onChange={setDraft} />
          </div>

          <div className="min-w-0 border-t border-white/10 pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
            <h3 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-slate-300">Test połączenia</h3>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <CheckLine label="Połączenie z endpointem" ok={selectedEndpoint.lastTest?.ok !== false} />
              <CheckLine label="HTTPS / SSL" ok={selectedEndpoint.url.startsWith('https://')} />
              <CheckLine label="Odpowiedź API" ok={selectedEndpoint.lastTest?.ok === true} value={selectedEndpoint.lastTest?.statusCode ? `OK (${selectedEndpoint.lastTest.statusCode})` : '-'} />
              <CheckLine label="Czas odpowiedzi" ok={(selectedEndpoint.lastTest?.latencyMs || 9999) < 1000} value={selectedEndpoint.lastTest?.latencyMs ? `${selectedEndpoint.lastTest.latencyMs} ms` : '-'} />
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={testSelected}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-500/5 text-xs font-black uppercase tracking-widest text-cyan-200 transition-colors hover:bg-cyan-500/10 disabled:opacity-50"
              >
                <RefreshCcw size={15} className={busy === 'test' ? 'animate-spin' : ''} />
                Testuj ponownie
              </button>
            </div>
          </div>

          <div className="min-w-0 border-t border-white/10 pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
            <h3 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-slate-300">Zastosuj zmiany</h3>
            <div className="grid gap-3">
              <ActionButton disabled={!canEdit || Boolean(busy)} onClick={saveDraft} icon={<Save size={15} />} label="Zapisz zmiany" tone="cyan" />
              <ActionButton disabled={!canEdit || Boolean(busy) || !selectedEndpoint.id || selectedEndpoint.active} onClick={activateSelected} icon={<CheckCircle2 size={15} />} label="Ustaw jako aktywny" />
              <ActionButton disabled={!canEdit || Boolean(busy) || !selectedEndpoint.id || selectedEndpoint.active} onClick={disableSelected} icon={<Power size={15} />} label="Wyłącz endpoint" tone="rose" />
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
              <h4 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Szybki rollback</h4>
              <p className="mt-3 break-all font-mono text-xs text-slate-300">{settings.previousEndpointId || 'Brak poprzedniego endpointu'}</p>
              <button
                type="button"
                disabled={!canEdit || Boolean(busy) || !settings.previousEndpointId}
                onClick={rollback}
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 text-xs font-black uppercase tracking-widest text-rose-200 transition-colors hover:bg-rose-500/20 disabled:opacity-40"
              >
                <RotateCcw size={15} />
                Przywróć poprzedni endpoint
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100">
            {error}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showHistory && (
          <motion.div className="fixed inset-0 z-[12000] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 28, opacity: 0 }} className="max-h-[85dvh] w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-[#111623] shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 p-5">
                <div>
                  <h2 className="text-lg font-black text-white">Historia zmian</h2>
                  <p className="text-xs text-slate-500">Ostatnie operacje infrastruktury API</p>
                </div>
                <button type="button" onClick={() => setShowHistory(false)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-slate-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>
              <div className="max-h-[65dvh] space-y-2 overflow-y-auto p-4">
                {changes.length ? changes.map((change) => (
                  <div key={change.id} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black text-white">{change.summary}</span>
                      <Badge>{change.action}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{change.endpointId} · {changeDate(change.createdAtMs)}</div>
                  </div>
                )) : (
                  <div className="py-10 text-center text-sm text-slate-500">Brak historii zmian.</div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusCard({ icon, title, value, hint, tone }: { icon: React.ReactNode; title: string; value: string; hint: string; tone: 'cyan' | 'blue' | 'emerald' | 'violet' }) {
  const colors = {
    cyan: 'text-cyan-300 bg-cyan-500/10 border-cyan-400/20',
    blue: 'text-blue-300 bg-blue-500/10 border-blue-400/20',
    emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/20',
    violet: 'text-violet-300 bg-violet-500/10 border-violet-400/20',
  };
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-[#111623] p-4 shadow-xl">
      <div className="flex items-center gap-4">
        <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border', colors[tone])}>{icon}</div>
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{title}</div>
          <div className="mt-1 truncate text-sm font-black text-white">{value}</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-emerald-400">{hint}</div>
        </div>
      </div>
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-300', className)}>{children}</span>;
}

function IconButton({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return <button type="button" title={title} onClick={onClick} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white">{icon}</button>;
}

function SelectButton({ icon, value, onChange, options }: { icon: React.ReactNode; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <label className="relative flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-[#111623] px-3 text-xs font-black uppercase tracking-widest text-slate-300">
      {icon}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="appearance-none bg-transparent pr-4 outline-none">
        {options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
  );
}

function EndpointForm({ draft, disabled, onChange }: { draft: MaintenanceEndpoint; disabled: boolean; onChange: (next: MaintenanceEndpoint) => void }) {
  const update = <K extends keyof MaintenanceEndpoint>(key: K, value: MaintenanceEndpoint[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nazwa" className="sm:col-span-2">
        <input disabled={disabled} value={draft.name} onChange={(event) => update('name', event.target.value)} className="field-input" />
      </Field>
      <Field label="URL" className="sm:col-span-2">
        <input disabled={disabled} value={draft.url} onChange={(event) => update('url', event.target.value)} className="field-input" />
      </Field>
      <Field label="Rola">
        <select disabled={disabled} value={draft.role} onChange={(event) => update('role', event.target.value as MaintenanceEndpointRole)} className="field-input">
          {roleOptions.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
        </select>
      </Field>
      <Field label="Priorytet">
        <input disabled={disabled} type="number" min={1} max={99} value={draft.priority} onChange={(event) => update('priority', Number(event.target.value))} className="field-input" />
      </Field>
      <Field label="Region">
        <input disabled={disabled} value={draft.region} onChange={(event) => update('region', event.target.value)} className="field-input" />
      </Field>
      <Field label="Źródło konfiguracji">
        <input disabled={disabled} value={draft.source} onChange={(event) => update('source', event.target.value)} className="field-input" />
      </Field>
      <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 sm:col-span-2">
        <span>
          <span className="block text-xs font-black uppercase tracking-widest text-slate-300">Fallback</span>
          <span className="text-xs text-slate-500">Użyj, jeśli Firestore niedostępne</span>
        </span>
        <input disabled={disabled} type="checkbox" checked={draft.fallbackEnabled} onChange={(event) => update('fallbackEnabled', event.target.checked)} className="h-5 w-5 accent-cyan-400" />
      </label>
      <style jsx>{`
        .field-input {
          height: 44px;
          width: 100%;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          padding: 0 12px;
          color: white;
          outline: none;
          font-size: 13px;
          font-weight: 700;
        }
        .field-input:focus { border-color: rgba(34, 211, 238, 0.45); }
        .field-input:disabled { opacity: 0.55; }
      `}</style>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('min-w-0', className)}>
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function CheckLine({ label, ok, value }: { label: string; ok: boolean; value?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-300">
        {ok ? <CheckCircle2 size={14} className="shrink-0 text-emerald-400" /> : <X size={14} className="shrink-0 text-rose-400" />}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('shrink-0 font-mono text-[11px] font-black', ok ? 'text-emerald-400' : 'text-rose-300')}>{value || (ok ? 'OK' : 'BŁĄD')}</span>
    </div>
  );
}

function ActionButton({ disabled, onClick, icon, label, tone = 'emerald' }: { disabled: boolean; onClick: () => void; icon: React.ReactNode; label: string; tone?: 'cyan' | 'emerald' | 'rose' }) {
  const classes = {
    cyan: 'border-cyan-400/25 bg-cyan-500/15 text-cyan-50 hover:bg-cyan-500/25',
    emerald: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20',
    rose: 'border-rose-400/25 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20',
  };
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn('flex h-12 items-center justify-center gap-2 rounded-xl border text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-40', classes[tone])}>
      {icon}
      {label}
    </button>
  );
}
