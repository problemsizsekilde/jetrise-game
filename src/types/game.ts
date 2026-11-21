import type { DepositMethodId } from '../config/limits';

export type RoundPhase = 'WAITING' | 'FLYING' | 'CRASHED';

export type MultiplierTier = 'low' | 'mid' | 'high' | 'mega';

export interface HistoryEntry {
  id: string;
  roundNumber: number;
  crashPoint: number;
  timestamp: number;
  tier: MultiplierTier;
}

export type BetSlotStatus =
  | 'IDLE'
  | 'QUEUED'
  | 'PLACED'
  | 'CASHED_OUT'
  | 'LOST';

export interface BetSlotState {
  slotId: 1 | 2;
  amount: number;
  autoCashoutEnabled: boolean;
  autoCashoutTarget: number;
  status: BetSlotStatus;
  placedAmount: number;
  placedRoundNumber: number | null;
  cashoutMultiplier: number | null;
  payout: number | null;
  lastFeedback: string | null;
}

export type TransactionType = 'DEPOSIT' | 'WITHDRAW' | 'BET' | 'WIN';

export interface WalletTransaction {
  id: string;
  userId?: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  timestamp: number;
  note: string;
}

export type WalletRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface WalletRequest {
  id: string;
  userId: string;
  username: string;
  gmail?: string | null;
  type: 'DEPOSIT' | 'WITHDRAW';
  paymentMethod?: DepositMethodId | null;
  paymentMethodLabel?: string | null;
  amount: number;
  paymentDetails: string;
  receiptFileName?: string | null;
  status: WalletRequestStatus;
  createdAt: number;
  updatedAt: number;
  resolvedBy: string | null;
}

export interface UserProfile {
  userId: string;
  username: string;
  nick: string;
  gmail: string | null;
  isRegistered: boolean;
  balance: number;
}

export interface RoundSnapshot {
  roundId: string;
  roundNumber: number;
  phase: RoundPhase;
  multiplier: number;
  countdownMs: number;
  countdownProgress: number;
  crashPoint: number | null;
  elapsedFlightMs: number;
}

export type SignalEvent =
  | { type: 'ROUND_WAITING'; roundId: string; roundNumber: number; startsInMs: number }
  | { type: 'ROUND_STARTED'; roundId: string; roundNumber: number; startedAt: number }
  | { type: 'MULTIPLIER_TICK'; roundId: string; multiplier: number; elapsedMs: number }
  | { type: 'ROUND_CRASHED'; roundId: string; roundNumber: number; crashPoint: number; timestamp: number }
  | { type: 'BET_PLACED'; slotId: 1 | 2; amount: number; roundNumber: number }
  | { type: 'BET_CASHED_OUT'; slotId: 1 | 2; multiplier: number; payout: number; roundNumber: number }
  | { type: 'WALLET_UPDATED'; balance: number; transaction?: WalletTransaction };
