import { Buffer } from 'node:buffer';
import { ValidationError } from '../../http/errors.js';

// Keyset pagination on (date, _id), opaque to the client. Never a `skip` —
// that degrades linearly with offset and millions of transactions is exactly
// the scale this is meant to survive.
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
