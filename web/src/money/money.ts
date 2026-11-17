// Amounts arrive from the API as decimal strings ("12999.75") and stay
// strings everywhere here — no Number()/parseFloat.

// Only used to compare two amounts by size (for sizing a spending bar), not
// for anything displayed or stored — still parsed by splitting the string,
// same as the server side.
export function parseKoboForComparison(amount: string): bigint {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const kobo = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
  return negative ? -kobo : kobo;
}

export function formatNaira(amount: string): string {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole = '0', fraction = '00'] = unsigned.split('.');
  const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fractionPadded = fraction.padEnd(2, '0').slice(0, 2);
  return `${negative ? '-' : ''}₦${withSeparators}.${fractionPadded}`;
}
