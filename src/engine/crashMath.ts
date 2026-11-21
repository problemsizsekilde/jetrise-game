import type { HistoryEntry, MultiplierTier } from '../types/game';

/**
 * Multiplier growth speed constant:
 * m(t) = e^(GROWTH_RATE * t_sec)
 * At t = 0s -> 1.00x
 * At t = 5s -> ~1.42x
 * At t = 10s -> ~2.01x
 * At t = 20s -> ~4.05x
 * At t = 33s -> ~10.0x
 */
const GROWTH_RATE = 0.07;

export function getMultiplierAtTime(elapsedMs: number): number {
  if (elapsedMs <= 0) return 1.0;
  const seconds = elapsedMs / 1000;
  const raw = Math.exp(GROWTH_RATE * seconds);
  return Math.max(1.0, Math.floor(raw * 100) / 100);
}

export function getTimeForMultiplier(multiplier: number): number {
  if (multiplier <= 1.0) return 0;
  return (Math.log(multiplier) / GROWTH_RATE) * 1000;
}

export function getMultiplierTier(multiplier: number): MultiplierTier {
  if (multiplier < 2.0) return 'low';
  if (multiplier < 10.0) return 'mid';
  if (multiplier < 50.0) return 'high';
  return 'mega';
}

export function formatMultiplier(value: number): string {
  return `${value.toFixed(2)}x`;
}

/**
 * Standard crash-game inverse distribution with ~4% house edge.
 * Produces realistic mix:
 * - ~52% under 2.00x
 * - ~38% between 2.00x and 9.99x
 * - ~10% 10.00x and above (capped at 150.00x)
 */
export function generateCrashPoint(): number {
  const r = Math.random();
  // ~3.5% instant crash at 1.00x - 1.05x
  if (r < 0.035) {
    return Math.floor((1.0 + Math.random() * 0.05) * 100) / 100;
  }
  const houseEdge = 0.96;
  const raw = houseEdge / (1 - r);
  const clamped = Math.min(150.0, Math.max(1.01, raw));
  return Math.floor(clamped * 100) / 100;
}

/**
 * Initial history seed so the top history strip looks alive immediately on first load.
 */
export function createInitialHistory(count = 16): HistoryEntry[] {
  const sampleValues = [
    1.24, 2.85, 1.09, 6.40, 1.52, 14.32, 1.87, 3.15,
    1.12, 2.41, 8.90, 1.38, 4.76, 1.04, 11.20, 2.08,
  ];
  const now = Date.now();
  return sampleValues.slice(0, count).map((val, idx) => ({
    id: `seed-${idx}`,
    roundNumber: 1000 - idx,
    crashPoint: val,
    timestamp: now - (idx + 1) * 15000,
    tier: getMultiplierTier(val),
  }));
}
