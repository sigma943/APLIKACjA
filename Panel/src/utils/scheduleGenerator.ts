import { Stop, Departure, Carrier } from "../types";

export const CARRIERS: Record<string, Carrier> = {
  PKS: { id: 'pks', name: 'PKS Rzeszów', colorClass: 'text-teal-400', borderClass: 'border-teal-400/30', bgClass: 'bg-teal-400/10', dotClass: 'bg-teal-400' },
  MPK: { id: 'mpk', name: 'MPK Rzeszów', colorClass: 'text-orange-500', borderClass: 'border-orange-500/30', bgClass: 'bg-orange-500/10', dotClass: 'bg-orange-500' },
  MARCEL: { id: 'marcel', name: 'Marcel', colorClass: 'text-lime-400', borderClass: 'border-lime-400/30', bgClass: 'bg-lime-400/10', dotClass: 'bg-lime-400' },
  PKP_IC: { id: 'pkp_ic', name: 'PKP IC', colorClass: 'text-amber-500', borderClass: 'border-amber-500/30', bgClass: 'bg-amber-500/10', dotClass: 'bg-amber-500' },
  POLREGIO: { id: 'polregio', name: 'POLREGIO', colorClass: 'text-red-500', borderClass: 'border-red-500/30', bgClass: 'bg-red-500/10', dotClass: 'bg-red-500' },
};

export const STOPS: Stop[] = [
  { id: '1', name: 'Babica (dół) 80', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108', '208'], isFavorite: false },
  { id: '2', name: 'Babica (dół) 85', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108', '208'], isFavorite: true },
  { id: '3', name: 'Babica (kolonia) 81', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108', '208'], isFavorite: false },
  { id: '4', name: 'Babica (kolonia) 84', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108', '208'], isFavorite: false },
  { id: '5', name: 'Babica 82', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108', '208'], isFavorite: false },
  { id: '6', name: 'Babica 83', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108', '208'], isFavorite: true },
  { id: '7', name: 'Babica, DPS 2', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108', '208'], isFavorite: false },
  { id: '8', name: 'Babica, DPS 45', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108', '208'], isFavorite: false },
  { id: '9', name: 'Babica, Przyst. Kolejowy 1', type: 'train', carriers: [CARRIERS.PKP_IC, CARRIERS.POLREGIO], lines: [], isFavorite: false },
  { id: '10', name: 'Babica, Przyst. Kolejowy 2', type: 'train', carriers: [CARRIERS.PKP_IC, CARRIERS.POLREGIO], lines: [], isFavorite: false },
  { id: '11', name: 'Rzeszów Główny', type: 'train', carriers: [CARRIERS.PKP_IC, CARRIERS.POLREGIO], lines: [], isFavorite: true },
  { id: '12', name: 'Rejtana / Szpital', type: 'bus', carriers: [CARRIERS.MPK], lines: ['0A', '18', '19'], isFavorite: false },
  { id: '13', name: 'Rzeszów D.A.', type: 'bus', carriers: [CARRIERS.PKS, CARRIERS.MARCEL], lines: ['203', '208', '217', '19', '108', 'M'], isFavorite: true },
  { id: '14', name: 'Gwoźnica Górna skr 03', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: true },
  { id: '15', name: 'Gwoźnica Górna skr 04', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: false },
  { id: '16', name: 'Gwoźnica Górna 01', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: false },
  { id: '17', name: 'Gwoźnica Górna 02', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: false },
  { id: '18', name: 'Gwoźnica Dolna 01', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: false },
  { id: '19', name: 'Gwoźnica Dolna 02', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: false },
  { id: '20', name: 'Baryczka Kościół 01', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: false },
  { id: '21', name: 'Baryczka Kościół 02', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: false },
  { id: '22', name: 'Połomia 11', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: false },
  { id: '23', name: 'Połomia 12', type: 'bus', carriers: [CARRIERS.PKS], lines: ['108'], isFavorite: false },
  { id: '24', name: 'Wyżne koło mostu 01', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108'], isFavorite: false },
  { id: '25', name: 'Wyżne koło mostu 02', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108'], isFavorite: false },
  { id: '26', name: 'Czudec, Rynek 01', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108'], isFavorite: false },
  { id: '27', name: 'Czudec, Rynek 02', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108'], isFavorite: false },
  { id: '28', name: 'Czudec (przystanek kolejowy)', type: 'train', carriers: [CARRIERS.PKP_IC, CARRIERS.POLREGIO], lines: [], isFavorite: false },
  { id: '29', name: 'Boguchwała, Urząd Gminy 01', type: 'bus', carriers: [CARRIERS.PKS, CARRIERS.MPK], lines: ['203', '208', '217', '19', '108'], isFavorite: false },
  { id: '30', name: 'Boguchwała, Urząd Gminy 02', type: 'bus', carriers: [CARRIERS.PKS, CARRIERS.MPK], lines: ['203', '208', '217', '19', '108'], isFavorite: false },
  { id: '31', name: 'Boguchwała (przystanek kolejowy)', type: 'train', carriers: [CARRIERS.PKP_IC, CARRIERS.POLREGIO], lines: [], isFavorite: false },
  { id: '32', name: 'Lutoryż 01', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108'], isFavorite: false },
  { id: '33', name: 'Lutoryż 02', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108'], isFavorite: false },
  { id: '34', name: 'Zarzecze 01', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108'], isFavorite: false },
  { id: '35', name: 'Zarzecze 02', type: 'bus', carriers: [CARRIERS.PKS], lines: ['203', '108'], isFavorite: false },
];

export const ORIGIN_SCHEDULES: Record<string, { northbound: string[]; southbound: string[] }> = {
  '203': {
    northbound: ['04:35', '05:35', '06:35', '07:55', '09:35', '11:25', '13:15', '14:15', '15:05', '16:25', '17:45', '19:15', '20:45'],
    southbound: ['04:50', '06:00', '07:10', '08:30', '10:30', '11:50', '13:00', '14:15', '15:05', '15:55', '17:00', '18:30', '20:00', '21:45']
  },
  '108': {
    northbound: ['04:30', '05:25', '06:15', '07:10', '08:20', '10:00', '11:40', '13:25', '14:35', '15:57', '16:50', '17:45', '18:25', '20:40'],
    southbound: ['05:10', '06:10', '07:15', '08:35', '10:15', '11:15', '12:07', '13:23', '14:44', '15:35', '16:29', '17:09', '18:17', '19:22', '20:47', '23:15']
  },
  '208': {
    northbound: ['04:50', '05:50', '06:50', '08:20', '10:00', '12:17', '13:27', '14:35', '15:04', '16:50', '18:20', '19:50', '21:30'],
    southbound: ['05:40', '07:05', '08:45', '10:15', '12:21', '13:58', '14:43', '15:28', '16:30', '17:45', '18:50', '20:40']
  },
  '217': {
    northbound: ['05:20', '06:50', '08:35', '11:35', '13:25', '14:25', '15:10', '15:45', '17:00', '18:05', '19:40', '21:40'],
    southbound: ['06:25', '08:05', '11:05', '12:55', '13:55', '14:40', '15:10', '15:40', '16:30', '17:35', '19:10', '21:10']
  }
};

const MPK_VEHICLES = [
  "Solaris Urbino 12 Electric • Elektrowóz",
  "Autosan Sancity 12LF • Klimatyzowany",
  "Solaris Urbino 18 • Przegubowy",
  "Mercedes-Benz Conecto • Niski stopień",
  "Solaris Urbino 12 niska emisja"
];

const PKS_VEHICLES = [
  "Iveco Crossway 12M • PKS Rzeszów",
  "Autosan Lider 9 • Komfortowy",
  "Mercedes-Benz Intouro • Klimatyzowany",
  "Iveco Crossway Line • PKS Rzeszów",
  "MAN Lion's Regio • PKS"
];

const MARCEL_VEHICLES = [
  "Express Bus • Mercedes Sprinter 519",
  "Commuter • Volkswagen Crafter VIP",
  "Szybki Kurs • Mercedes Sprinter",
  "Marcel Bus • Renault Master"
];

export function isNorthboundSegment(stopId: string): boolean {
  const northboundStops = ['2', '3', '6', '8', '11', '13', '14', '16', '18', '20', '22', '24', '26', '29', '32', '34'];
  return northboundStops.includes(stopId);
}

export function getRouteMinutesOffset(stopId: string, line: string, isNorth: boolean): number {
  if (isNorth) {
    switch (stopId) {
      case '16': return 0; // Gwoźnica Górna 01
      case '14': return 2; // Gwoźnica Górna skr 03
      case '18': return 6; // Gwoźnica Dolna 01
      case '20': return 11; // Baryczka Kościół 01
      case '22': return 16; // Połomia 11
      case '24': return 21; // Wyżne koło mostu 01
      case '26': return 25; // Czudec, Rynek 01
      case '2': return 30; // Babica dół 85
      case '3': return 32; // Babica kolonia 81
      case '6': return 33; // Babica 83
      case '8': return 35; // Babica dps 45
      case '32': return 39; // Lutoryż 01
      case '34': return 42; // Zarzecze 01
      case '29': return 45; // Boguchwała, Urząd Gminy 01
      case '13': return 55; // Rzeszów D.A. (end)
      default: return 20;
    }
  } else {
    switch (stopId) {
      case '13': return 0; // Rzeszów D.A. (start)
      case '30': return 15; // Boguchwała, Urząd Gminy 02
      case '35': return 18; // Zarzecze 02
      case '33': return 21; // Lutoryż 02
      case '1': return 25; // Babica dół 80
      case '4': return 27; // Babica kolonia 84
      case '5': return 28; // Babica 82
      case '7': return 30; // Babica dps 2
      case '27': return 35; // Czudec, Rynek 02
      case '25': return 39; // Wyżne koło mostu 02
      case '23': return 44; // Połomia 12
      case '21': return 49; // Baryczka Kościół 02
      case '19': return 54; // Gwoźnica Dolna 02
      case '15': return 58; // Gwoźnica Górna skr 04
      case '17': return 60; // Gwoźnica Górna 02 (end)
      default: return 20;
    }
  }
}

export function addMinutesToTime(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  const finalH = Math.floor(totalMin / 60) % 24;
  const finalM = totalMin % 60;
  return `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
}

export function getMinutesDiff(timeStr: string, currentTimeStr: string): number {
  const [hA, mA] = timeStr.split(':').map(Number);
  const [hB, mB] = currentTimeStr.split(':').map(Number);
  return (hA * 60 + mA) - (hB * 60 + mB);
}

export function getDeparturesForStop(
  stopId: string, 
  lineFilter: string, 
  dayIndex: number, 
  currentTime?: string
): Departure[] {
  const stop = STOPS.find(s => s.id === stopId);
  if (!stop) return [];

  const departures: Departure[] = [];

  // A. TRAIN SCHEDULER: Babica Kolejowy (9, 10), Czudec (28), Boguchwała (31), Rzeszów Główny (11)
  if (stop.type === 'train') {
    const isRzeszow = stop.id === '11';
    
    const baseTrains = [
      { id: 't0', line: 'R 30811', direction: 'Przemyśl Główny', baseHour: 4, baseMin: 15, carrier: CARRIERS.POLREGIO, platform: '1', track: '2', type: 'departure' as const },
      { id: 't1', line: 'IC 83170', direction: 'Warszawa Wschodnia', baseHour: 5, baseMin: 18, carrier: CARRIERS.PKP_IC, platform: '2', track: '4', type: 'departure' as const },
      { id: 't1a', line: 'R 33510', direction: 'Tarnobrzeg', baseHour: 5, baseMin: 45, carrier: CARRIERS.POLREGIO, platform: '3', track: '6', type: 'departure' as const },
      { id: 't2', line: 'R 30812', direction: 'Przemyśl Główny', baseHour: 6, baseMin: 30, carrier: CARRIERS.POLREGIO, platform: '1', track: '2', type: 'departure' as const },
      { id: 't2a', line: 'R 33880', direction: 'Jasło', baseHour: 7, baseMin: 15, carrier: CARRIERS.POLREGIO, platform: '1', track: '1', type: 'departure' as const },
      { id: 't3', line: 'IC 63104', direction: 'Kraków Główny', baseHour: 8, baseMin: 45, carrier: CARRIERS.PKP_IC, platform: '3', track: '5', type: 'departure' as const },
      { id: 't3a', line: 'R 30814', direction: 'Rzeszów Główny', baseHour: 9, baseMin: 20, carrier: CARRIERS.POLREGIO, platform: '2', track: '4', type: 'departure' as const },
      { id: 't9', line: 'R 30820', direction: 'Rzeszów Główny', baseHour: 10, baseMin: 12, carrier: CARRIERS.POLREGIO, platform: '1', track: '2', type: 'departure' as const },
      { id: 't4', line: 'TLK 42101', direction: 'Gdynia Główna', baseHour: 11, baseMin: 5, carrier: CARRIERS.PKP_IC, platform: '2', track: '1', type: 'departure' as const },
      { id: 't4a', line: 'R 30816', direction: 'Tarnów', baseHour: 12, baseMin: 30, carrier: CARRIERS.POLREGIO, platform: '3', track: '5', type: 'departure' as const },
      { id: 't10', line: 'IC 3514', direction: 'Gdynia Główna', baseHour: 13, baseMin: 5, carrier: CARRIERS.PKP_IC, platform: '2', track: '3', type: 'departure' as const },
      { id: 't5', line: 'R 33520', direction: 'Tarnobrzeg', baseHour: 14, baseMin: 20, carrier: CARRIERS.POLREGIO, platform: '1', track: '3', type: 'departure' as const },
      { id: 't5a', line: 'R 30818', direction: 'Przemyśl Główny', baseHour: 15, baseMin: 45, carrier: CARRIERS.POLREGIO, platform: '2', track: '4', type: 'departure' as const },
      { id: 't11', line: 'R 33890', direction: 'Jasło', baseHour: 16, baseMin: 15, carrier: CARRIERS.POLREGIO, platform: '1', track: '1', type: 'departure' as const },
      { id: 't6', line: 'EIP 4500', direction: 'Warszawa Centralna', baseHour: 17, baseMin: 40, carrier: CARRIERS.PKP_IC, platform: '2', track: '4', type: 'departure' as const },
      { id: 't6a', line: 'R 33530', direction: 'Stalowa Wola', baseHour: 18, baseMin: 25, carrier: CARRIERS.POLREGIO, platform: '1', track: '2', type: 'departure' as const },
      { id: 't7', line: 'IC 38171', direction: 'Kraków Główny', baseHour: 19, baseMin: 25, carrier: CARRIERS.PKP_IC, platform: '1', track: '2', type: 'arrival' as const },
      { id: 't12', line: 'IC 3804', direction: 'Szczecin Główny', baseHour: 20, baseMin: 10, carrier: CARRIERS.PKP_IC, platform: '3', track: '1', type: 'departure' as const },
      { id: 't8', line: 'R 30815', direction: 'Tarnów', baseHour: 21, baseMin: 50, carrier: CARRIERS.POLREGIO, platform: '3', track: '6', type: 'arrival' as const },
      { id: 't13', line: 'R 30819', direction: 'Rzeszów Główny', baseHour: 22, baseMin: 40, carrier: CARRIERS.POLREGIO, platform: '2', track: '3', type: 'departure' as const },
    ];

    baseTrains.forEach((train, i) => {
      let minOffset = dayIndex * 4 + (isRzeszow ? 0 : 12);
      let h = train.baseHour;
      let m = train.baseMin + minOffset;
      if (m >= 60) {
        h = (h + Math.floor(m / 60)) % 24;
        m = m % 60;
      }

      let status: 'on_time' | 'delayed' = 'on_time';
      let delayMins: number | undefined;

      const depTimeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

      if (dayIndex === 0 && currentTime) {
        const diffMins = getMinutesDiff(depTimeStr, currentTime);
        if (diffMins >= -30 && diffMins <= 50) {
          const seed = (h * 3 + m * 5 + i) % 100;
          if (seed < 22) {
            status = 'delayed';
            delayMins = (seed % 9) + 2;
          }
        }
      }

      departures.push({
        id: `train_${stop.id}_${train.id}_${dayIndex}`,
        line: train.line,
        direction: train.direction,
        time: depTimeStr,
        status,
        delayMins,
        carrier: train.carrier,
        platform: train.platform,
        track: train.track,
        type: train.type
      });
    });

    return departures.sort((a, b) => a.time.localeCompare(b.time));
  }

  // B. BUS SCHEDULER: City MPK lines (0A, 18, 19) for stop 12 or 29, 30
  const isCityStop = stop.id === '12';
  if (isCityStop) {
    const lines = ['0A', '18', '19'];
    lines.forEach(line => {
      if (lineFilter !== 'all' && lineFilter !== line) return;

      const intervals = line === '0A' ? 15 : line === '18' ? 20 : 30;
      const startH = 5;
      const endH = 23;

      for (let hour = startH; hour <= endH; hour++) {
        for (let min = 0; min < 60; min += intervals) {
          const isWeekend = (dayIndex === 5 || dayIndex === 6);
          if (isWeekend && (hour % 2 === 0) && (min === 0)) continue;

          const depTimeStr = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
          
          let status: 'on_time' | 'delayed' = 'on_time';
          let delayMins: number | undefined;

          if (dayIndex === 0 && currentTime) {
            const diffMins = getMinutesDiff(depTimeStr, currentTime);
            if (diffMins >= -10 && diffMins <= 30) {
              const seed = (hour * 7 + min + 12) % 100;
              if (seed < 15) {
                status = 'delayed';
                delayMins = (seed % 6) + 2;
              }
            }
          }

          const direction = line === '0A' ? 'Rzeszów D.M. (Okólna)' : line === '18' ? 'Miłocińska' : 'Łukasiewicza Hospital';

          departures.push({
            id: `bus_mpk_${stop.id}_${line}_${hour}_${min}`,
            line,
            direction,
            time: depTimeStr,
            status,
            delayMins,
            vehicleDesc: MPK_VEHICLES[(hour + min) % MPK_VEHICLES.length],
            carrier: CARRIERS.MPK
          });
        }
      }
    });

    return departures.sort((a, b) => a.time.localeCompare(b.time));
  }

  // C. HIGH QUALITY COMMUTER SCHEDULER FOR THE CORRIDOR! (PKS, Marcel)
  const isNorth = isNorthboundSegment(stop.id);

  stop.lines.forEach(line => {
    if (lineFilter !== 'all' && lineFilter !== line) return;

    const sch = ORIGIN_SCHEDULES[line];
    if (!sch) return;

    const baseTimes = isNorth ? sch.northbound : sch.southbound;
    const offset = getRouteMinutesOffset(stop.id, line, isNorth);

    baseTimes.forEach((baseTime, i) => {
      const isWeekend = (dayIndex === 5 || dayIndex === 6);
      if (isWeekend && i % 4 === 0) return;

      const actualTime = addMinutesToTime(baseTime, offset);

      let status: 'on_time' | 'delayed' = 'on_time';
      let delayMins: number | undefined;

      if (dayIndex === 0 && currentTime) {
        const diffMins = getMinutesDiff(actualTime, currentTime);
        if (diffMins >= -15 && diffMins <= 40) {
          const seed = (parseInt(actualTime.replace(':', ''), 10) + parseInt(stop.id, 10)) % 100;
          if (seed < 20) {
            status = 'delayed';
            delayMins = (seed % 6) + 2;
          }
        }
      }

      let direction = "Rzeszów D.A.";
      if (!isNorth) {
        if (line === '108') {
          direction = "Gwoźnica Górna";
        } else if (line === '203') {
          direction = "Czudec Rynek";
        } else if (line === '208') {
          direction = "Mogielnica pętla";
        } else if (line === '217') {
          direction = "Niechobrz rondo";
        } else {
          direction = "Czudec Rynek";
        }
      }

      departures.push({
        id: `commuter_pks_${stop.id}_${line}_${i}`,
        line,
        direction,
        time: actualTime,
        status,
        delayMins,
        vehicleDesc: PKS_VEHICLES[(i + parseInt(stop.id, 10)) % PKS_VEHICLES.length],
        carrier: CARRIERS.PKS
      });
    });
  });

  // Include Marcel 'M' bus departures at Rzeszów D.A. or key corridors along regional routes
  if (stop.id === '13' || stop.id === '30' || stop.id === '1' || stop.id === '27') {
    const marcelLines = ['M'];
    marcelLines.forEach(line => {
      if (lineFilter !== 'all' && lineFilter !== line) return;

      const baseMarcelM1 = ['05:40', '07:10', '08:50', '10:30', '12:10', '13:50', '15:30', '17:10', '18:50', '20:30'];
      const baseMarcelM2 = ['06:15', '07:45', '09:15', '10:45', '12:15', '13:45', '15:15', '16:45', '18:15', '19:45', '21:15'];

      let offset = 0;
      if (stop.id === '30') offset = 10;
      if (stop.id === '1') offset = 16;
      if (stop.id === '27') offset = 24;

      // M1 schedule to Lublin
      baseMarcelM1.forEach((bTime, i) => {
        if (dayIndex === 6 && i % 3 === 0) return;
        const actualTime = addMinutesToTime(bTime, offset);

        let status: 'on_time' | 'delayed' = 'on_time';
        let delayMins: number | undefined;

        if (dayIndex === 0 && currentTime) {
          const diffMins = getMinutesDiff(actualTime, currentTime);
          if (diffMins >= -10 && diffMins <= 40) {
            const seed = (parseInt(actualTime.replace(':', ''), 10)) % 100;
            if (seed < 25) {
              status = 'delayed';
              delayMins = (seed % 6) + 3;
            }
          }
        }

        departures.push({
          id: `marcel_m1_${stop.id}_${line}_${i}`,
          line: 'M',
          direction: 'Lublin D.A. przez Janów',
          time: actualTime,
          status,
          delayMins,
          vehicleDesc: MARCEL_VEHICLES[(i + offset) % MARCEL_VEHICLES.length],
          carrier: CARRIERS.MARCEL
        });
      });

      // M2 schedule to Krosno
      baseMarcelM2.forEach((bTime, i) => {
        if (dayIndex === 6 && i % 3 === 0) return;
        const actualTime = addMinutesToTime(bTime, offset);

        let status: 'on_time' | 'delayed' = 'on_time';
        let delayMins: number | undefined;

        if (dayIndex === 0 && currentTime) {
          const diffMins = getMinutesDiff(actualTime, currentTime);
          if (diffMins >= -10 && diffMins <= 40) {
            const seed = (parseInt(actualTime.replace(':', ''), 10)) % 100;
            if (seed < 25) {
              status = 'delayed';
              delayMins = (seed % 6) + 3;
            }
          }
        }

        departures.push({
          id: `marcel_m2_${stop.id}_${line}_${i}`,
          line: 'M',
          direction: 'Krosno D.A. przez Domaradz',
          time: actualTime,
          status,
          delayMins,
          vehicleDesc: MARCEL_VEHICLES[(i + offset + 1) % MARCEL_VEHICLES.length],
          carrier: CARRIERS.MARCEL
        });
      });
    });
  }

  return departures.sort((a, b) => a.time.localeCompare(b.time));
}
