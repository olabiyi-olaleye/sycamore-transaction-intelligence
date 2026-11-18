import { config } from '../config/env.js';
import { tryGetRequestContext } from '../context/requestContext.js';

// One JSON object per line, so logs can be searched and charted by field
// (requestId, organisationId, event) in whatever collects them. Honours
// LOG_LEVEL; tests run with 'silent'.
type Level = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<string, number> = { fatal: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

function enabled(level: Level): boolean {
  if (config.LOG_LEVEL === 'silent') return false;
  return ORDER[level]! <= ORDER[config.LOG_LEVEL]!;
}

function serialiseError(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return error;
}

function write(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (!enabled(level)) return;
  const context = tryGetRequestContext();
  const line = {
    time: new Date().toISOString(),
    level,
    event,
    ...(context ? { requestId: context.requestId, organisationId: context.organisationId } : {}),
    ...fields,
    ...(fields.error !== undefined ? { error: serialiseError(fields.error) } : {}),
  };
  const output = JSON.stringify(line, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
  if (level === 'error' || level === 'warn') {
    console.error(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  debug: (event: string, fields?: Record<string, unknown>) => write('debug', event, fields),
};
