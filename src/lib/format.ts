/** Rounded, comma-grouped integer. The shared building block for all $/qty formatting. */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function money(n: number, opts: { sign?: boolean } = {}): string {
  const rounded = Math.round(n);
  const abs = formatNumber(Math.abs(rounded));
  if (opts.sign && rounded > 0) return `+$${abs}`;
  if (rounded < 0) return `−$${abs}`;
  return `$${abs}`;
}

export function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}
