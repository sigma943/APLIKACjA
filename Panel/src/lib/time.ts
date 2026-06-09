export function parseDelay(deviation: any): number {
  if (typeof deviation === 'number') {
    return Math.floor(deviation / 60);
  }
  if (typeof deviation === 'string') {
    const match = deviation.match(/-?\d+/);
    if (match) {
      return parseInt(match[0], 10);
    }
  }
  return 0;
}

export function formatTime(timestampOrTimeString: any): string | null {
  if (!timestampOrTimeString) return null;
  
  if (typeof timestampOrTimeString === 'string') {
    // If it's already HH:mm
    if (/^\d{2}:\d{2}$/.test(timestampOrTimeString)) {
      return timestampOrTimeString;
    }
    // If it's a date string like 2026-05-20T14:20:00.000Z
    const date = new Date(timestampOrTimeString);
    if (!isNaN(date.getTime())) {
      const h = String(date.getHours()).padStart(2, '0');
      const m = String(date.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }
  }

  // If it's a Unix timestamp in ms
  if (typeof timestampOrTimeString === 'number') {
    const date = new Date(timestampOrTimeString);
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  return null;
}
