import { ROUND_TIMING } from '../config/limits';
import type { HistoryEntry, RoundPhase, RoundSnapshot } from '../types/game';
import {
  getMultiplierAtTime,
  getMultiplierTier,
  getTimeForMultiplier,
} from './crashMath';

const DAY_MS = 86_400_000;
const GLOBAL_SEED_SALT = 0x51a7c9e3;

/**
 * Fast, deterministic PRNG (Mulberry32) so every client and server
 * derives the exact same crash point for any given roundNumber.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDeterministicCrashPoint(roundNumber: number): number {
  const mixedSeed = Math.imul(roundNumber ^ GLOBAL_SEED_SALT, 0x45d9f3b) >>> 0;
  const rand = mulberry32(mixedSeed);
  const r = rand();
  const r2 = rand();

  if (r < 0.035) {
    return Math.floor((1.0 + r2 * 0.05) * 100) / 100;
  }

  const houseEdge = 0.96;
  const raw = houseEdge / (1 - r);
  const clamped = Math.min(150.0, Math.max(1.01, raw));
  return Math.floor(clamped * 100) / 100;
}

export interface TimelineRoundWindow {
  dayIndex: number;
  roundNumber: number;
  roundId: string;
  crashPoint: number;
  startMs: number;
  flyingStartMs: number;
  crashMs: number;
  endMs: number;
}

export interface GlobalTimelineState {
  window: TimelineRoundWindow;
  snapshot: RoundSnapshot;
  history: HistoryEntry[];
}

function buildRoundWindow(
  dayIndex: number,
  roundNumber: number,
  startMs: number
): TimelineRoundWindow {
  const crashPoint = getDeterministicCrashPoint(roundNumber);
  const flightMs = Math.max(120, Math.round(getTimeForMultiplier(crashPoint)));
  const flyingStartMs = startMs + ROUND_TIMING.WAITING_DURATION_MS;
  const crashMs = flyingStartMs + flightMs;
  const endMs = crashMs + ROUND_TIMING.CRASH_COOLDOWN_MS;

  return {
    dayIndex,
    roundNumber,
    roundId: `round-${roundNumber}`,
    crashPoint,
    startMs,
    flyingStartMs,
    crashMs,
    endMs,
  };
}

function toHistoryEntry(win: TimelineRoundWindow): HistoryEntry {
  return {
    id: win.roundId,
    roundNumber: win.roundNumber,
    crashPoint: win.crashPoint,
    timestamp: win.crashMs,
    tier: getMultiplierTier(win.crashPoint),
  };
}

/**
 * Stateful O(1) evaluator for the deterministic global Lucky Jet timeline.
 */
export class GlobalTimelineEngine {
  private currentWindow: TimelineRoundWindow | null = null;
  private completedHistory: HistoryEntry[] = [];

  private syncToTimestamp(nowMs: number): void {
    const dayIndex = Math.floor(nowMs / DAY_MS);

    // Fast path: still inside cached round window
    if (
      this.currentWindow &&
      this.currentWindow.dayIndex === dayIndex &&
      nowMs >= this.currentWindow.startMs &&
      nowMs < this.currentWindow.endMs
    ) {
      return;
    }

    // Fast forward 1..15 rounds if we just crossed endMs within the same day
    if (
      this.currentWindow &&
      this.currentWindow.dayIndex === dayIndex &&
      nowMs >= this.currentWindow.endMs &&
      nowMs - this.currentWindow.endMs < 180_000
    ) {
      let win = this.currentWindow;
      while (nowMs >= win.endMs) {
        this.completedHistory = [
          toHistoryEntry(win),
          ...this.completedHistory,
        ].slice(0, ROUND_TIMING.MAX_HISTORY_ITEMS);
        win = buildRoundWindow(dayIndex, win.roundNumber + 1, win.endMs);
      }
      this.currentWindow = win;
      return;
    }

    // Full anchor scan from start of UTC day (takes < 0.5ms)
    const dayStartMs = dayIndex * DAY_MS;
    const baseRound = (dayIndex - 19000) * 10000 + 1;
    let cursor = dayStartMs;
    let roundNumber = baseRound;
    const recent: HistoryEntry[] = [];

    // Seed previous day's tail if we're near midnight UTC
    let win = buildRoundWindow(dayIndex, roundNumber, cursor);
    while (win.endMs <= nowMs) {
      recent.push(toHistoryEntry(win));
      if (recent.length > ROUND_TIMING.MAX_HISTORY_ITEMS) {
        recent.shift();
      }
      cursor = win.endMs;
      roundNumber += 1;
      win = buildRoundWindow(dayIndex, roundNumber, cursor);
    }

    // If very early in UTC day (< 16 rounds), backfill deterministic previous rounds
    if (recent.length < 16) {
      const needed = 16 - recent.length;
      const backfill: HistoryEntry[] = [];
      for (let i = needed; i >= 1; i--) {
        const rn = baseRound - i;
        const cp = getDeterministicCrashPoint(rn);
        backfill.push({
          id: `round-${rn}`,
          roundNumber: rn,
          crashPoint: cp,
          timestamp: dayStartMs - i * 14000,
          tier: getMultiplierTier(cp),
        });
      }
      this.completedHistory = [...recent.reverse(), ...backfill.reverse()].slice(
        0,
        ROUND_TIMING.MAX_HISTORY_ITEMS
      );
    } else {
      this.completedHistory = recent.reverse();
    }

    this.currentWindow = win;
  }

  public evaluate(nowMs: number): GlobalTimelineState {
    this.syncToTimestamp(nowMs);
    const win = this.currentWindow!;

    let phase: RoundPhase;
    let multiplier = 1.0;
    let countdownMs = 0;
    let countdownProgress = 0;
    let crashPoint: number | null = null;
    let elapsedFlightMs = 0;

    if (nowMs < win.flyingStartMs) {
      phase = 'WAITING';
      countdownMs = Math.max(0, win.flyingStartMs - nowMs);
      countdownProgress = countdownMs / ROUND_TIMING.WAITING_DURATION_MS;
      multiplier = 1.0;
    } else if (nowMs < win.crashMs) {
      phase = 'FLYING';
      elapsedFlightMs = nowMs - win.flyingStartMs;
      multiplier = Math.min(win.crashPoint, getMultiplierAtTime(elapsedFlightMs));
    } else {
      phase = 'CRASHED';
      elapsedFlightMs = win.crashMs - win.flyingStartMs;
      multiplier = win.crashPoint;
      crashPoint = win.crashPoint;
    }

    const history =
      phase === 'CRASHED'
        ? [toHistoryEntry(win), ...this.completedHistory].slice(
            0,
            ROUND_TIMING.MAX_HISTORY_ITEMS
          )
        : this.completedHistory;

    return {
      window: win,
      snapshot: {
        roundId: win.roundId,
        roundNumber: win.roundNumber,
        phase,
        multiplier,
        countdownMs,
        countdownProgress,
        crashPoint,
        elapsedFlightMs,
      },
      history,
    };
  }
}
