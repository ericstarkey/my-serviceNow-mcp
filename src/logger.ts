type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const raw = process.env['LOG_LEVEL'] ?? 'info';
  if (raw in LEVELS) return raw as LogLevel;
  return 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[getConfiguredLevel()];
}

export const logger = {
  debug: (msg: string, ...args: unknown[]): void => {
    if (shouldLog('debug')) console.debug(`[DEBUG] ${msg}`, ...args);
  },
  info: (msg: string, ...args: unknown[]): void => {
    if (shouldLog('info')) console.info(`[INFO] ${msg}`, ...args);
  },
  warn: (msg: string, ...args: unknown[]): void => {
    if (shouldLog('warn')) console.warn(`[WARN] ${msg}`, ...args);
  },
  error: (msg: string, ...args: unknown[]): void => {
    if (shouldLog('error')) console.error(`[ERROR] ${msg}`, ...args);
  },
};
