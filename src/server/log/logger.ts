/**
 * Routine logs carry identifiers, counts, and outcome codes. They never carry
 * note text, athlete names, or anything a staff member typed. Values that do
 * not look like an identifier are replaced rather than truncated.
 */
const SAFE_VALUE = /^[A-Za-z0-9_.:/@-]{0,64}$/;

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function redactFields(fields: LogFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    out[key] = SAFE_VALUE.test(value) ? value : '[redacted]';
  }
  return out;
}

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  lines(): string[];
}

export function createLogger(sink: (line: string) => void = console.log, keep = 500): Logger {
  const buffer: string[] = [];
  const emit = (level: string, event: string, fields: LogFields = {}): void => {
    const safe = redactFields(fields);
    const parts = Object.entries(safe).map(([k, v]) => `${k}=${v}`);
    const line = `${new Date().toISOString()} ${level} ${event}${parts.length ? ' ' : ''}${parts.join(' ')}`;
    buffer.push(line);
    if (buffer.length > keep) buffer.shift();
    sink(line);
  };
  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    lines: () => [...buffer],
  };
}
