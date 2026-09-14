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

/**
 * Wei to the chain's native token, as text. Gas is paid in the native token
 * and not in dollars, so it is shown in the unit it was actually paid in
 * rather than converted through a price we do not have.
 */
export function native(wei: string, symbol: string): string {
  let value: bigint;
  try {
    value = BigInt(wei);
  } catch {
    return `${wei} wei`;
  }
  const base = BigInt(10) ** BigInt(18);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole.toString()}${fraction ? `.${fraction}` : ""} ${symbol}`;
}

export function short(hash: string, n = 10): string {
  return hash.length <= n * 2 ? hash : `${hash.slice(0, n)}…${hash.slice(-4)}`;
}
