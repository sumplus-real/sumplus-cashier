/**
 * One place that turns metered micro-dollars into text. Costs are held as
 * integers so the chain and the screen cannot drift apart.
 */
export function usd(microUsd: number): string {
  const dollars = microUsd / 1_000_000;
  // Widen the decimals until the printed figure reads back as the same number,
  // so nothing is rounded and, in particular, nothing is rounded down.
  for (let places = 2; places <= 6; places += 1) {
    const shown = dollars.toFixed(places);
    if (Number(shown) === dollars) return `$${shown}`;
  }
  // Beyond six decimals, round up. A displayed figure below the metered one
  // would understate what the session actually costs.
  return `$${(Math.ceil(dollars * 1e6) / 1e6).toFixed(6)}`;
}

export function short(hash: string, n = 10): string {
  return hash.length <= n * 2 ? hash : `${hash.slice(0, n)}…${hash.slice(-4)}`;
}
