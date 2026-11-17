// All decimal-to-kobo conversion lives here. Everywhere else just moves
// amountKobo around as a bigint; no parseFloat, no Number(), no *100.

export const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

// Splits on the decimal point and pads the fraction, so even a value above
// Number.MAX_SAFE_INTEGER never passes through a float.
function parseAmountPatternToKobo(amount: string): bigint {
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new Error(`"${amount}" is not a valid decimal amount`);
  }
  const [wholePart = '0', fractionPart = ''] = amount.split('.');
  const koboFraction = fractionPart.padEnd(2, '0');
  return BigInt(wholePart) * 100n + BigInt(koboFraction);
}

/** "12999.75" -> 1299975n. A transacted amount is always positive; direction carries the sign. */
export function parseAmountToKobo(amount: string): bigint {
  const kobo = parseAmountPatternToKobo(amount);
  if (kobo <= 0n) {
    throw new Error('Amount must be greater than zero');
  }
  return kobo;
}

/** Same parsing, but for range filters (minAmount=0 is a legitimate, if pointless, filter). */
export function parseFilterAmountToKobo(amount: string): bigint {
  return parseAmountPatternToKobo(amount);
}

/** 1299975n -> "12999.75". The inverse of parseAmountToKobo. */
export function formatKoboAsAmount(kobo: bigint): string {
  if (kobo < 0n) {
    throw new Error('amountKobo must not be negative');
  }
  const whole = kobo / 100n;
  const fraction = (kobo % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${fraction}`;
}

/** 1299975n -> "₦12,999.75", for human-readable explanations (review flag reasons, logs). */
export function formatNaira(kobo: bigint): string {
  const [whole, fraction] = formatKoboAsAmount(kobo).split('.') as [string, string];
  const withThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₦${withThousands}.${fraction}`;
}
