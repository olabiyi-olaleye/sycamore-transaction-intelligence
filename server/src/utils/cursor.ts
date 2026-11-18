import { Buffer } from 'node:buffer';
import { ValidationError } from './errors.js';

// Keyset pagination on (date, id), opaque to the client. No `skip`, which
// gets slower the deeper you page.
export interface ListCursor {
  date: Date;
  id: string;
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify({ d: cursor.date.toISOString(), i: cursor.id })).toString('base64url');
}

export function decodeCursor(raw: string): ListCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { d: string; i: string };
    const date = new Date(parsed.d);
    if (Number.isNaN(date.getTime()) || typeof parsed.i !== 'string' || !parsed.i) {
      throw new Error('malformed cursor payload');
    }
    return { date, id: parsed.i };
  } catch {
    throw new ValidationError('cursor is not valid');
  }
}
