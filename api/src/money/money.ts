// The only module that converts between a decimal amount and kobo. Nothing
// else in the app may call parseFloat, Number(), or multiply/divide an amount
// by 100 — every other module moves amountKobo around as a bigint.

export const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * "12999.75" -> 1299975n. Works entirely in integer arithmetic: splits on the
 * decimal point, pads the fraction to two digits, and combines with bigint
 * multiplication so a value above Number.MAX_SAFE_INTEGER never touches a
 * float.
 */
export function parseAmountToKobo(amount: string): bigint {
  if (!AMOUNT_PATTERN.test(amount)) {
    throw new Error(`"${amount}" is not a valid decimal amount`);
  }
  const [wholePart = '0', fractionPart = ''] = amount.split('.');
  const koboFraction = fractionPart.padEnd(2, '0');
  const kobo = BigInt(wholePart) * 100n + BigInt(koboFraction);
  if (kobo <= 0n) {
    throw new Error('Amount must be greater than zero');
  }
  return kobo;
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
