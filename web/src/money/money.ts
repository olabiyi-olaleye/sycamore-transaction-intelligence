// The web app's one money-formatting module. Amounts arrive from the API as
// decimal strings ("12999.75") and are only ever formatted as strings here —
// never parsed with Number() or parseFloat, so there is nothing for a float
// to round.

// For sizing a UI element (a spending bar) by relative magnitude only — never
// for display or storage. Parses with the same split-on-decimal-point
// approach as the server's money module, so the money value itself never
// touches Number()/parseFloat; only the resulting small integer percentage
// (0-100) is ever converted to a JS number, which is exact.
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
