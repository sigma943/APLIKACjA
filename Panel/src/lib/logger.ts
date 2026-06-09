export const logger = {
  info: (msg: string, data?: any) => {
    const ts = new Date().toISOString();
    console.log(`[INFO] ${ts} - ${msg}`, data ? JSON.stringify(data) : '');
  },
  warn: (msg: string, data?: any) => {
    const ts = new Date().toISOString();
    console.warn(`[WARN] ${ts} - ${msg}`, data ? JSON.stringify(data) : '');
  },
  error: (msg: string, err?: any) => {
    const ts = new Date().toISOString();
    console.error(`[ERROR] ${ts} - ${msg}`, err instanceof Error ? err.message : err);
  }
};
