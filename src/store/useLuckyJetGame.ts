import { useCallback, useEffect, useRef, useState } from 'react';
import { BET_LIMITS, type DepositMethodId } from '../config/limits';
import {
  getDeterministicCrashPoint,
  GlobalTimelineEngine,
} from '../engine/globalTimeline';
import { luckyJetBridge } from '../engine/signalBridge';
import { soundEngine } from '../engine/soundEngine';
import {
  roundMoney,
  validateBet,
  validateDeposit,
  validateWithdraw,
  type ValidationResult,
} from '../engine/walletRules';
import {
  fetchMeApi,
  fetchServerTime,
  fetchUserState,
  loginApi,
  logoutApi,
  registerApi,
  submitWalletRequestApi,
  syncBetApi,
  syncCancelBetApi,
  syncWinApi,
} from '../services/api';
import type {
  BetSlotState,
  HistoryEntry,
  RoundPhase,
  RoundSnapshot,
  UserProfile,
  WalletRequest,
  WalletTransaction,
} from '../types/game';

const AUTH_TOKEN_KEY = 'lucky_jet_auth_token';

function createInitialSlot(slotId: 1 | 2): BetSlotState {
  return {
    slotId,
    amount: slotId === 1 ? BET_LIMITS.DEFAULT_BET_SLOT_1 : BET_LIMITS.DEFAULT_BET_SLOT_2,
    autoCashoutEnabled: false,
    autoCashoutTarget: BET_LIMITS.DEFAULT_AUTO_CASHOUT,
    status: 'IDLE',
    placedAmount: 0,
    placedRoundNumber: null,
    cashoutMultiplier: null,
    payout: null,
    lastFeedback: null,
  };
}

export function useLuckyJetGame() {
  const timelineRef = useRef<GlobalTimelineEngine | null>(null);
  if (!timelineRef.current) {
    timelineRef.current = new GlobalTimelineEngine();
  }

  // null = Guest (unauthenticated, no balance or wallet shown)
  const [user, setUser] = useState<UserProfile | null>(null);
  const [requests, setRequests] = useState<WalletRequest[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => soundEngine.isEnabled());
  const [slots, setSlots] = useState<[BetSlotState, BetSlotState]>(() => [
    createInitialSlot(1),
    createInitialSlot(2),
  ]);

  const initialEval = timelineRef.current.evaluate(Date.now());
  const [round, setRound] = useState<RoundSnapshot>(initialEval.snapshot);
  const [history, setHistory] = useState<HistoryEntry[]>(initialEval.history);

  const serverTimeOffsetRef = useRef<number>(0);
  const userRef = useRef<UserProfile | null>(user);
  const historyRef = useRef(history);
  const slotsRef = useRef(slots);
  const roundRef = useRef(round);
  const lastPhaseRef = useRef<RoundPhase>(initialEval.snapshot.phase);
  const lastRoundNumberRef = useRef<number>(initialEval.snapshot.roundNumber);
  const lastCountdownSecRef = useRef<number>(
    Math.ceil(initialEval.snapshot.countdownMs / 1000)
  );
  const lastSignalEmitRef = useRef<number>(0);
  const pendingBalanceSyncRef = useRef<number>(0);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  useEffect(() => {
    roundRef.current = round;
    luckyJetBridge.updateSnapshot(round, historyRef.current, userRef.current?.balance ?? 0);
  }, [round]);

  const syncWithBackend = useCallback(async (targetUser?: UserProfile | null) => {
    const activeUser = targetUser !== undefined ? targetUser : userRef.current;
    if (!activeUser) return;

    const state = await fetchUserState(activeUser.userId, activeUser.nick);
    if (!state) return;

    const drift = state.serverTimeMs - Date.now();
    if (Math.abs(drift) < 60_000) {
      serverTimeOffsetRef.current = drift;
    }

    setUser((prev) => {
      if (!prev || prev.userId !== state.user.userId) return prev;
      const nextBalance =
        pendingBalanceSyncRef.current > 0 ? prev.balance : roundMoney(state.user.balance);
      return {
        userId: state.user.userId,
        username: state.user.username,
        nick: state.user.nick || state.user.username,
        gmail: state.user.gmail ?? null,
        isRegistered: Boolean(state.user.isRegistered),
        balance: nextBalance,
      };
    });
    setRequests(state.requests);
    setTransactions(state.transactions);
  }, []);

  // Restore saved auth session on page reload + sync global server clock
  useEffect(() => {
    let active = true;

    const syncClock = async () => {
      const res = await fetchServerTime();
      if (res && active) {
        serverTimeOffsetRef.current = res.serverTimeMs + res.rttMs / 2 - Date.now();
      }
    };

    const restoreSession = async () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
      if (!token) return;
      const res = await fetchMeApi(token);
      if (!active) return;
      if (res.ok && res.user) {
        userRef.current = res.user;
        setUser(res.user);
        await syncWithBackend(res.user);
      } else {
        try {
          localStorage.removeItem(AUTH_TOKEN_KEY);
        } catch {
          // ignore
        }
      }
    };

    syncClock();
    restoreSession();

    const pollTimer = window.setInterval(() => {
      if (userRef.current) {
        syncWithBackend();
      }
    }, 2500);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncClock();
        if (userRef.current) {
          syncWithBackend();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      active = false;
      window.clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [syncWithBackend]);

  const settleCashoutInternal = useCallback(
    (slotId: 1 | 2, cashoutMult: number, roundNumber: number) => {
      const activeUser = userRef.current;
      if (!activeUser) return false;

      const currentSlots = slotsRef.current;
      const targetSlot = currentSlots[slotId - 1];
      if (targetSlot.status !== 'PLACED') return false;

      const payout = roundMoney(targetSlot.placedAmount * cashoutMult);
      const nextBalance = roundMoney(activeUser.balance + payout);

      const updatedUser: UserProfile = { ...activeUser, balance: nextBalance };
      userRef.current = updatedUser;
      setUser(updatedUser);

      const updatedSlot: BetSlotState = {
        ...targetSlot,
        status: 'CASHED_OUT',
        cashoutMultiplier: cashoutMult,
        payout,
        lastFeedback: `Qazandınız: +${payout.toFixed(2)} AZN (${cashoutMult.toFixed(2)}x)`,
      };

      const nextSlots: [BetSlotState, BetSlotState] =
        slotId === 1 ? [updatedSlot, currentSlots[1]] : [currentSlots[0], updatedSlot];
      slotsRef.current = nextSlots;
      setSlots(nextSlots);

      soundEngine.playCashout();
      luckyJetBridge.emit({
        type: 'BET_CASHED_OUT',
        slotId,
        multiplier: cashoutMult,
        payout,
        roundNumber,
      });

      pendingBalanceSyncRef.current += 1;
      syncWinApi(activeUser.userId, payout, cashoutMult, roundNumber).finally(() => {
        pendingBalanceSyncRef.current = Math.max(0, pendingBalanceSyncRef.current - 1);
        syncWithBackend();
      });

      return true;
    },
    [syncWithBackend]
  );

  // Continuous Global Timeline RAF Loop
  useEffect(() => {
    const timeline = timelineRef.current!;
    let rafId = 0;

    const tick = () => {
      const syncedNowMs = Date.now() + serverTimeOffsetRef.current;
      const evaluated = timeline.evaluate(syncedNowMs);
      const { snapshot, window: win, history: nextHistory } = evaluated;

      const prevRoundNum = lastRoundNumberRef.current;
      const prevPhase = lastPhaseRef.current;

      if (snapshot.roundNumber !== prevRoundNum) {
        const nextSlots = slotsRef.current.map((slot) => {
          if (
            slot.status === 'PLACED' &&
            slot.placedRoundNumber !== null &&
            slot.placedRoundNumber < snapshot.roundNumber
          ) {
            const oldCrash = getDeterministicCrashPoint(slot.placedRoundNumber);
            const activeUser = userRef.current;
            if (activeUser && slot.autoCashoutEnabled && slot.autoCashoutTarget <= oldCrash) {
              const payout = roundMoney(slot.placedAmount * slot.autoCashoutTarget);
              const nextBal = roundMoney(activeUser.balance + payout);
              const updatedUser: UserProfile = { ...activeUser, balance: nextBal };
              userRef.current = updatedUser;
              setUser(updatedUser);
              pendingBalanceSyncRef.current += 1;
              syncWinApi(
                activeUser.userId,
                payout,
                slot.autoCashoutTarget,
                slot.placedRoundNumber
              ).finally(() => {
                pendingBalanceSyncRef.current = Math.max(0, pendingBalanceSyncRef.current - 1);
                syncWithBackend();
              });
            }
            return {
              ...slot,
              status: 'IDLE' as const,
              placedAmount: 0,
              placedRoundNumber: null,
              cashoutMultiplier: null,
              payout: null,
              lastFeedback: null,
            };
          }

          if (slot.status === 'QUEUED') {
            return {
              ...slot,
              status: 'PLACED' as const,
              placedRoundNumber: snapshot.roundNumber,
              cashoutMultiplier: null,
              payout: null,
              lastFeedback: null,
            };
          }

          if (slot.status === 'CASHED_OUT' || slot.status === 'LOST') {
            return {
              ...slot,
              status: 'IDLE' as const,
              placedAmount: 0,
              placedRoundNumber: null,
              cashoutMultiplier: null,
              payout: null,
              lastFeedback: null,
            };
          }

          return slot;
        }) as [BetSlotState, BetSlotState];

        slotsRef.current = nextSlots;
        setSlots(nextSlots);

        lastCountdownSecRef.current = Math.ceil(snapshot.countdownMs / 1000);
        luckyJetBridge.emit({
          type: 'ROUND_WAITING',
          roundId: snapshot.roundId,
          roundNumber: snapshot.roundNumber,
          startsInMs: snapshot.countdownMs,
        });
      }

      if (snapshot.phase === 'WAITING') {
        const secLeft = Math.ceil(snapshot.countdownMs / 1000);
        if (secLeft < lastCountdownSecRef.current && secLeft > 0 && secLeft <= 3) {
          soundEngine.playCountdownTick(secLeft === 1);
        }
        lastCountdownSecRef.current = secLeft;
      } else if (snapshot.phase === 'FLYING') {
        if (prevPhase !== 'FLYING' || prevRoundNum !== snapshot.roundNumber) {
          soundEngine.playTakeoff();
          luckyJetBridge.emit({
            type: 'ROUND_STARTED',
            roundId: snapshot.roundId,
            roundNumber: snapshot.roundNumber,
            startedAt: win.flyingStartMs,
          });
        } else {
          soundEngine.updateFlightPitch(snapshot.multiplier);
        }

        for (const s of slotsRef.current) {
          if (
            s.status === 'PLACED' &&
            s.autoCashoutEnabled &&
            snapshot.multiplier >= s.autoCashoutTarget &&
            s.autoCashoutTarget <= win.crashPoint
          ) {
            settleCashoutInternal(s.slotId, s.autoCashoutTarget, snapshot.roundNumber);
          }
        }

        if (syncedNowMs - lastSignalEmitRef.current > 100) {
          lastSignalEmitRef.current = syncedNowMs;
          luckyJetBridge.emit({
            type: 'MULTIPLIER_TICK',
            roundId: snapshot.roundId,
            multiplier: snapshot.multiplier,
            elapsedMs: snapshot.elapsedFlightMs,
          });
        }
      } else if (snapshot.phase === 'CRASHED') {
        if (prevPhase !== 'CRASHED' || prevRoundNum !== snapshot.roundNumber) {
          for (const s of slotsRef.current) {
            if (
              s.status === 'PLACED' &&
              s.autoCashoutEnabled &&
              s.autoCashoutTarget <= win.crashPoint
            ) {
              settleCashoutInternal(s.slotId, s.autoCashoutTarget, snapshot.roundNumber);
            }
          }

          const settledSlots = slotsRef.current.map((slot) =>
            slot.status === 'PLACED'
              ? {
                  ...slot,
                  status: 'LOST' as const,
                  lastFeedback: `Raund ${win.crashPoint.toFixed(2)}x-də dayandı`,
                }
              : slot
          ) as [BetSlotState, BetSlotState];
          slotsRef.current = settledSlots;
          setSlots(settledSlots);

          soundEngine.playCrash();
          luckyJetBridge.emit({
            type: 'ROUND_CRASHED',
            roundId: snapshot.roundId,
            roundNumber: snapshot.roundNumber,
            crashPoint: win.crashPoint,
            timestamp: win.crashMs,
          });
        }
      }

      lastPhaseRef.current = snapshot.phase;
      lastRoundNumberRef.current = snapshot.roundNumber;

      if (nextHistory[0]?.id !== historyRef.current[0]?.id) {
        historyRef.current = nextHistory;
        setHistory(nextHistory);
      }

      roundRef.current = snapshot;
      setRound(snapshot);

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      soundEngine.stopFlightHum();
    };
  }, [settleCashoutInternal, syncWithBackend]);

  // --- Auth Actions ---

  const registerAccount = useCallback(
    async (payload: { gmail: string; nick: string; password: string }) => {
      const res = await registerApi(payload);
      if (!res.ok || !res.user || !res.token) {
        return { ok: false, error: res.error || 'Qeydiyyat tamamlanmadı.' };
      }
      try {
        localStorage.setItem(AUTH_TOKEN_KEY, res.token);
      } catch {
        // ignore
      }
      userRef.current = res.user;
      setUser(res.user);
      await syncWithBackend(res.user);
      return { ok: true, user: res.user };
    },
    [syncWithBackend]
  );

  const loginAccount = useCallback(
    async (payload: { identifier: string; password: string }) => {
      const res = await loginApi(payload);
      if (!res.ok || !res.user || !res.token) {
        return { ok: false, error: res.error || 'Giriş alınmadı.' };
      }
      try {
        localStorage.setItem(AUTH_TOKEN_KEY, res.token);
      } catch {
        // ignore
      }
      userRef.current = res.user;
      setUser(res.user);
      await syncWithBackend(res.user);
      return { ok: true, user: res.user };
    },
    [syncWithBackend]
  );

  const logoutAccount = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
    if (token) {
      await logoutApi(token);
    }
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    } catch {
      // ignore
    }
    userRef.current = null;
    setUser(null);
    setRequests([]);
    setTransactions([]);
    const resetSlots: [BetSlotState, BetSlotState] = [
      createInitialSlot(1),
      createInitialSlot(2),
    ];
    slotsRef.current = resetSlots;
    setSlots(resetSlots);
  }, []);

  // --- Game & Wallet Actions ---

  const toggleSound = useCallback(() => {
    const next = soundEngine.toggle();
    setSoundEnabled(next);
  }, []);

  const updateSlotAmount = useCallback((slotId: 1 | 2, amount: number) => {
    const safe = Number.isFinite(amount)
      ? roundMoney(Math.min(BET_LIMITS.MAX_BET, Math.max(0, amount)))
      : 0;
    setSlots((prev) => {
      const next = prev.map((s) =>
        s.slotId === slotId ? { ...s, amount: safe, lastFeedback: null } : s
      ) as [BetSlotState, BetSlotState];
      slotsRef.current = next;
      return next;
    });
  }, []);

  const updateSlotAutoCashout = useCallback(
    (slotId: 1 | 2, enabled: boolean, target?: number) => {
      setSlots((prev) => {
        const next = prev.map((s) => {
          if (s.slotId !== slotId) return s;
          const nextTarget =
            target !== undefined && Number.isFinite(target)
              ? Math.min(
                  BET_LIMITS.MAX_AUTO_CASHOUT,
                  Math.max(BET_LIMITS.MIN_AUTO_CASHOUT, Math.round(target * 100) / 100)
                )
              : s.autoCashoutTarget;
          return {
            ...s,
            autoCashoutEnabled: enabled,
            autoCashoutTarget: nextTarget,
          };
        }) as [BetSlotState, BetSlotState];
        slotsRef.current = next;
        return next;
      });
    },
    []
  );

  const placeOrQueueBet = useCallback(
    (slotId: 1 | 2): ValidationResult => {
      soundEngine.unlock();
      const activeUser = userRef.current;
      if (!activeUser) {
        return { valid: false, error: 'AUTH_REQUIRED' };
      }

      const slot = slotsRef.current[slotId - 1];
      const phase = roundRef.current.phase;

      if (slot.status === 'PLACED' || slot.status === 'QUEUED') {
        return { valid: false, error: 'Bu paneldə artıq aktiv mərc var.' };
      }

      const check = validateBet(slot.amount, activeUser.balance);
      if (!check.valid) {
        setSlots((prev) => {
          const next = prev.map((s) =>
            s.slotId === slotId ? { ...s, lastFeedback: check.error ?? null } : s
          ) as [BetSlotState, BetSlotState];
          slotsRef.current = next;
          return next;
        });
        return check;
      }

      const betAmount = roundMoney(slot.amount);
      const nextBalance = roundMoney(activeUser.balance - betAmount);
      const updatedUser: UserProfile = { ...activeUser, balance: nextBalance };
      userRef.current = updatedUser;
      setUser(updatedUser);

      const targetStatus = phase === 'WAITING' ? 'PLACED' : 'QUEUED';
      const targetRoundNum =
        phase === 'WAITING' ? roundRef.current.roundNumber : roundRef.current.roundNumber + 1;

      setSlots((prev) => {
        const next = prev.map((s) =>
          s.slotId === slotId
            ? {
                ...s,
                status: targetStatus,
                placedAmount: betAmount,
                placedRoundNumber: targetRoundNum,
                cashoutMultiplier: null,
                payout: null,
                lastFeedback: null,
              }
            : s
        ) as [BetSlotState, BetSlotState];
        slotsRef.current = next;
        return next;
      });

      soundEngine.playClick();
      luckyJetBridge.emit({
        type: 'BET_PLACED',
        slotId,
        amount: betAmount,
        roundNumber: targetRoundNum,
      });

      pendingBalanceSyncRef.current += 1;
      syncBetApi(activeUser.userId, betAmount, targetRoundNum).finally(() => {
        pendingBalanceSyncRef.current = Math.max(0, pendingBalanceSyncRef.current - 1);
        syncWithBackend();
      });

      return { valid: true };
    },
    [syncWithBackend]
  );

  const cancelBet = useCallback(
    (slotId: 1 | 2) => {
      soundEngine.unlock();
      const activeUser = userRef.current;
      if (!activeUser) return;

      const slot = slotsRef.current[slotId - 1];
      const phase = roundRef.current.phase;

      const canCancel =
        slot.status === 'QUEUED' || (slot.status === 'PLACED' && phase === 'WAITING');
      if (!canCancel) return;

      const refund = roundMoney(slot.placedAmount);
      const nextBalance = roundMoney(activeUser.balance + refund);
      const updatedUser: UserProfile = { ...activeUser, balance: nextBalance };
      userRef.current = updatedUser;
      setUser(updatedUser);

      setSlots((prev) => {
        const next = prev.map((s) =>
          s.slotId === slotId
            ? {
                ...s,
                status: 'IDLE' as const,
                placedAmount: 0,
                placedRoundNumber: null,
                lastFeedback: 'Mərc ləğv edildi',
              }
            : s
        ) as [BetSlotState, BetSlotState];
        slotsRef.current = next;
        return next;
      });

      soundEngine.playClick();

      pendingBalanceSyncRef.current += 1;
      syncCancelBetApi(activeUser.userId, refund).finally(() => {
        pendingBalanceSyncRef.current = Math.max(0, pendingBalanceSyncRef.current - 1);
        syncWithBackend();
      });
    },
    [syncWithBackend]
  );

  const manualCashout = useCallback(
    (slotId: 1 | 2) => {
      soundEngine.unlock();
      if (!userRef.current || roundRef.current.phase !== 'FLYING') return;
      settleCashoutInternal(slotId, roundRef.current.multiplier, roundRef.current.roundNumber);
    },
    [settleCashoutInternal]
  );

  const submitWalletRequest = useCallback(
    async (params: {
      type: 'DEPOSIT' | 'WITHDRAW';
      amount: number;
      paymentMethod?: DepositMethodId;
      paymentDetails: string;
      receiptDataUrl?: string | null;
      receiptFileName?: string | null;
    }): Promise<{
      ok: boolean;
      error?: string;
      request?: WalletRequest;
      telegramSent?: boolean;
      telegramNotified?: boolean;
      telegramError?: string | null;
    }> => {
      soundEngine.unlock();
      const activeUser = userRef.current;
      if (!activeUser) {
        return { ok: false, error: 'Əməliyyat üçün əvvəlcə hesabınıza daxil olun.' };
      }

      const localCheck =
        params.type === 'DEPOSIT'
          ? validateDeposit(params.amount, params.paymentMethod || 'CARD')
          : validateWithdraw(params.amount, activeUser.balance);

      if (!localCheck.valid) {
        return { ok: false, error: localCheck.error };
      }

      if (params.type === 'DEPOSIT' && !params.receiptDataUrl) {
        return {
          ok: false,
          error: 'Zəhmət olmasa ödəniş qəbzini (şəkil və ya PDF) əlavə edin.',
        };
      }

      const res = await submitWalletRequestApi({
        userId: activeUser.userId,
        username: activeUser.nick || activeUser.username,
        type: params.type,
        amount: roundMoney(params.amount),
        paymentMethod: params.paymentMethod,
        paymentDetails: params.paymentDetails,
        receiptDataUrl: params.receiptDataUrl,
        receiptFileName: params.receiptFileName,
      });

      if (!res.ok) {
        return { ok: false, error: res.error || 'Sorğu göndərilə bilmədi.' };
      }

      soundEngine.playClick();
      await syncWithBackend();
      return {
        ok: true,
        request: res.request,
        telegramSent: res.telegramSent ?? res.telegramNotified,
        telegramNotified: res.telegramNotified,
        telegramError: res.telegramError ?? null,
      };
    },
    [syncWithBackend]
  );

  return {
    user,
    isAuthenticated: Boolean(user),
    round,
    history,
    balance: user?.balance ?? 0,
    requests,
    transactions,
    slots,
    soundEnabled,
    toggleSound,
    registerAccount,
    loginAccount,
    logoutAccount,
    updateSlotAmount,
    updateSlotAutoCashout,
    placeOrQueueBet,
    cancelBet,
    manualCashout,
    submitWalletRequest,
    refreshWallet: () => syncWithBackend(),
  };
}
