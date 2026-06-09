export type StopType = 'bus' | 'train';

export interface Carrier {
  id: string;
  name: string;
  colorClass: string;
  bgClass?: string;
  borderClass?: string;
  dotClass?: string;
}

export interface Stop {
  id: string;
  name: string;
  type: StopType;
  carriers: Carrier[];
  lines: string[]; // For bus stops
  isFavorite: boolean;
  areaId?: string;
  code?: string;
  lat?: number;
  lon?: number;
  sourceProviderIds?: string[];
  providerStopIds?: Record<string, string>;
}

export interface Departure {
  id: string;
  line: string; // e.g. "233" or "IC 83170"
  direction: string;
  time: string; // e.g. "19:24"
  status: 'on_time' | 'delayed';
  delayMins?: number;
  vehicleDesc?: string; // e.g. "Autobus 16 • Iveco Crossway"
  carrier?: Carrier; // Especially for trains
  platform?: string; // For trains
  track?: string; // For trains
  type?: 'departure' | 'arrival'; // For trains
  plannedAtMs?: number;
  realAtMs?: number;
}
