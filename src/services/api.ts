import type { DepositMethodId } from '../config/limits';
import type { UserProfile, WalletRequest, WalletTransaction } from '../types/game';

export interface UserStateResponse {
  user: UserProfile;
  requests: WalletRequest[];
  transactions: WalletTransaction[];
  serverTimeMs: number;
}

export interface CreateRequestResponse {
  ok: boolean;
  error?: string;
  request?: WalletRequest;
  user?: UserProfile;
  telegramNotified?: boolean;
}

export interface AuthResponse {
  ok: boolean;
  error?: string;
  token?: string;
  user?: UserProfile;
}

export async function fetchServerTime(): Promise<{ serverTimeMs: number; rttMs: number } | null> {
  try {
    const t0 = Date.now();
    const res = await fetch('/api/time', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const t1 = Date.now();
    return { serverTimeMs: Number(data.serverTimeMs), rttMs: t1 - t0 };
  } catch {
    return null;
  }
}

export async function registerApi(payload: {
  gmail: string;
  nick: string;
  password: string;
}): Promise<AuthResponse> {
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Serverlə əlaqə yaradılmadı.' };
  }
}

export async function loginApi(payload: {
  identifier: string;
  password: string;
}): Promise<AuthResponse> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Serverlə əlaqə yaradılmadı.' };
  }
}

export async function fetchMeApi(token: string): Promise<AuthResponse> {
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function logoutApi(token: string): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // ignore
  }
}

export async function fetchUserState(
  userId: string,
  username?: string
): Promise<UserStateResponse | null> {
  try {
    const qs = username ? `?username=${encodeURIComponent(username)}` : '';
    const res = await fetch(`/api/user/${encodeURIComponent(userId)}/state${qs}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function submitWalletRequestApi(payload: {
  userId: string;
  username: string;
  type: 'DEPOSIT' | 'WITHDRAW';
  amount: number;
  paymentMethod?: DepositMethodId;
  paymentDetails: string;
  receiptDataUrl?: string | null;
  receiptFileName?: string | null;
}): Promise<CreateRequestResponse> {
  try {
    const res = await fetch('/api/wallet/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch {
    return {
      ok: false,
      error: 'Serverlə əlaqə yaradılmadı. Backend serverin işlədiyini yoxlayın.',
    };
  }
}

export async function syncBetApi(
  userId: string,
  amount: number,
  roundNumber: number
): Promise<{ ok: boolean; balance?: number; error?: string }> {
  try {
    const res = await fetch('/api/wallet/bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount, roundNumber }),
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function syncCancelBetApi(
  userId: string,
  amount: number
): Promise<{ ok: boolean; balance?: number }> {
  try {
    const res = await fetch('/api/wallet/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount }),
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function syncWinApi(
  userId: string,
  amount: number,
  multiplier: number,
  roundNumber: number
): Promise<{ ok: boolean; balance?: number }> {
  try {
    const res = await fetch('/api/wallet/win', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount, multiplier, roundNumber }),
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}
