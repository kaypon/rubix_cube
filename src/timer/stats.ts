// Speedcubing numbers. Singles are cut (not rounded) to hundredths, the way
// competition timers show them; averages follow the WCA: of the last n,
// drop the fastest and slowest and take the mean of the rest.

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "--";
  const cs = Math.floor(ms / 10);
  const s = Math.floor(cs / 100);
  const hundredths = pad2(cs % 100);
  if (s < 60) return `${s}.${hundredths}`;
  return `${Math.floor(s / 60)}:${pad2(s % 60)}.${hundredths}`;
}

export function best(times: number[]): number | null {
  return times.length ? Math.min(...times) : null;
}

export function mean(times: number[]): number | null {
  return times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
}

/** Average of the last `n` (n ≥ 3), or null until there are that many. */
export function averageOf(times: number[], n: number): number | null {
  if (times.length < n) return null;
  const last = times.slice(-n).sort((a, b) => a - b);
  return mean(last.slice(1, -1));
}
