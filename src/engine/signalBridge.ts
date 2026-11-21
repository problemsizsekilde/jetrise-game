import type { HistoryEntry, RoundSnapshot, SignalEvent } from '../types/game';
import { generateCrashPoint } from './crashMath';

export type SignalListener = (event: SignalEvent) => void;

export interface CrashPointProvider {
  nextCrashPoint: (roundNumber: number, history: HistoryEntry[]) => number;
}

/**
 * Gələcəkdə siqnal sistemi, analitika və ya xarici WebSocket servisi ilə
 * təmiz əlaqələndirmə üçün mərkəzi hadisə körpüsü (Signal Bridge).
 */
class LuckyJetSignalBridge {
  private listeners = new Set<SignalListener>();
  private crashProvider: CrashPointProvider = {
    nextCrashPoint: () => generateCrashPoint(),
  };
  private latestRound: RoundSnapshot | null = null;
  private latestHistory: HistoryEntry[] = [];
  private latestBalance = 0;

  public subscribe(listener: SignalListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public emit(event: SignalEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error('[LuckyJetSignalBridge] Listener error:', err);
      }
    });
  }

  public setCrashPointProvider(provider: CrashPointProvider): void {
    this.crashProvider = provider;
  }

  public resolveNextCrashPoint(roundNumber: number, history: HistoryEntry[]): number {
    return this.crashProvider.nextCrashPoint(roundNumber, history);
  }

  public updateSnapshot(round: RoundSnapshot, history: HistoryEntry[], balance: number): void {
    this.latestRound = round;
    this.latestHistory = history;
    this.latestBalance = balance;
  }

  public getStateSnapshot() {
    return {
      round: this.latestRound,
      history: this.latestHistory,
      balance: this.latestBalance,
    };
  }
}

export const luckyJetBridge = new LuckyJetSignalBridge();

declare global {
  interface Window {
    __LUCKY_JET_BRIDGE__?: LuckyJetSignalBridge;
  }
}

if (typeof window !== 'undefined') {
  window.__LUCKY_JET_BRIDGE__ = luckyJetBridge;
}
