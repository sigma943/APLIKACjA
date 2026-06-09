export type PolishServiceDayType = 'weekday' | 'saturday' | 'sunday_or_holiday';

function dateKeyFromParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function easterDateParts(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function addDays(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fixedHolidayKeys(year: number) {
  return new Set([
    dateKeyFromParts(year, 1, 1),
    dateKeyFromParts(year, 1, 6),
    dateKeyFromParts(year, 5, 1),
    dateKeyFromParts(year, 5, 3),
    dateKeyFromParts(year, 8, 15),
    dateKeyFromParts(year, 11, 1),
    dateKeyFromParts(year, 11, 11),
    dateKeyFromParts(year, 12, 25),
    dateKeyFromParts(year, 12, 26),
  ]);
}

export function isPolishPublicHoliday(dateIso: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : '';
  if (!normalized) return false;
  const year = Number(normalized.slice(0, 4));
  if (!Number.isFinite(year)) return false;

  const easter = easterDateParts(year);
  const easterIso = dateKeyFromParts(easter.year, easter.month, easter.day);
  const movableHolidays = new Set([
    easterIso,
    addDays(easterIso, 1),
    addDays(easterIso, 49),
    addDays(easterIso, 60),
  ]);

  return fixedHolidayKeys(year).has(normalized) || movableHolidays.has(normalized);
}

export function resolvePolishServiceDayType(dateIso: string): PolishServiceDayType {
  const date = new Date(`${dateIso}T12:00:00`);
  const day = date.getDay();
  if (day === 0 || isPolishPublicHoliday(dateIso)) return 'sunday_or_holiday';
  if (day === 6) return 'saturday';
  return 'weekday';
}
