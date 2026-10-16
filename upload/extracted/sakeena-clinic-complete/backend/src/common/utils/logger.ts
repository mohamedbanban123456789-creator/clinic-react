export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let level: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

export function setLogLevel(next: LogLevel): void {
  level = next;
}

function emit(at: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
  if (ORDER[at] < ORDER[level]) return;
  // Logger is the only sanctioned console user (PROJECT_CONVENTIONS §1).
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: at, message, ...meta, at: new Date().toISOString() }));
}

export const logger = {
  debug: (message: string, meta: Record<string, unknown> = {}): void => emit('debug', message, meta),
  info: (message: string, meta: Record<string, unknown> = {}): void => emit('info', message, meta),
  warn: (message: string, meta: Record<string, unknown> = {}): void => emit('warn', message, meta),
  error: (message: string, meta: Record<string, unknown> = {}): void => emit('error', message, meta),
};
