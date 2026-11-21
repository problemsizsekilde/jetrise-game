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

/**
 * Backend API base URL.
 * - Production (Vercel): set `VITE_API_URL` in Vercel Environment Variables (e.g. https://your-api.onrender.com)
 * - Strips trailing slashes and any trailing `/api` so `/api/api/...` or `//` never occurs.
 * - Local dev: leave empty to use Vite `/api` proxy -> http://127.0.0.1:3001
 */
export const API_BASE_URL = String(import.meta.env.VITE_API_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/api$/i, '');

function buildApiUrl(path: string): string {
  const cleanPath = `/${path.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
  return API_BASE_URL ? `${API_BASE_URL}${cleanPath}` : cleanPath;
}

function isLocalHost(): boolean {
  if (typeof window === 'undefined') return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.');
}

async function requestJson<T>(
  path: string,
  options?: RequestInit
): Promise<{ ok: true; data: T; status: number } | { ok: false; error: string; status: number }> {
  const url = buildApiUrl(path);
  const method = options?.method || 'GET';

  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      const preview = (await res.text()).slice(0, 140);
      console.error(
        `[LuckyJet API] ${method} ${url} returned non-JSON (HTTP ${res.status}):`,
        preview
      );
      if (!API_BASE_URL && !isLocalHost()) {
        return {
          ok: false,
          status: res.status,
          error:
            'Backend API ünvanı (VITE_API_URL) Vercel mühitində təyin edilməyib. Vercel Settings → Environment Variables bölməsində VITE_API_URL əlavə edin.',
        };
      }
      return {
        ok: false,
        status: res.status,
        error: `Server düzgün cavab qaytarmadı (HTTP ${res.status}). Backend serverin aktiv olduğunu yoxlayın.`,
      };
    }

    const data = (await res.json()) as T;
    return { ok: true, data, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[LuckyJet API] Network/CORS error on ${method} ${url}:`, msg);

    if (!API_BASE_URL && !isLocalHost()) {
      return {
        ok: false,
        status: 0,
        error:
          'Backend API ünvanı (VITE_API_URL) təyin edilməyib. Vercel mühit dəyişənlərinə backend URL-ni əlavə edin.',
      };
    }

    return {
      ok: false,
      status: 0,
      error: `Serverlə əlaqə yaradılmadı (${API_BASE_URL || 'local /api'}). Backend serverin işlədiyini və CORS icazəsini yoxlayın.`,
    };
  }
}

export async function fetchServerTime(): Promise<{ serverTimeMs: number; rttMs: number } | null> {
  const t0 = Date.now();
  const res = await requestJson<{ serverTimeMs: number }>('/api/time', { cache: 'no-store' });
  if (!res.ok) return null;
  const t1 = Date.now();
  return { serverTimeMs: Number(res.data.serverTimeMs), rttMs: t1 - t0 };
}

export async function registerApi(payload: {
  gmail: string;
  nick: string;
  password: string;
}): Promise<AuthResponse> {
  const res = await requestJson<AuthResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return res.data;
}

export async function loginApi(payload: {
  identifier: string;
  password: string;
}): Promise<AuthResponse> {
  const res = await requestJson<AuthResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return res.data;
}

export async function fetchMeApi(token: string): Promise<AuthResponse> {
  const res = await requestJson<AuthResponse>('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return { ok: false, error: res.error };
  return res.data;
}

export async function logoutApi(token: string): Promise<void> {
  await requestJson('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function fetchUserState(
  userId: string,
  username?: string
): Promise<UserStateResponse | null> {
  const qs = username ? `?username=${encodeURIComponent(username)}` : '';
  const res = await requestJson<UserStateResponse>(
    `/api/user/${encodeURIComponent(userId)}/state${qs}`,
    { cache: 'no-store' }
  );
  if (!res.ok) return null;
  return res.data;
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
  const res = await requestJson<CreateRequestResponse>('/api/wallet/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return res.data;
}

export async function syncBetApi(
  userId: string,
  amount: number,
  roundNumber: number
): Promise<{ ok: boolean; balance?: number; error?: string }> {
  const res = await requestJson<{ ok: boolean; balance?: number; error?: string }>(
    '/api/wallet/bet',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount, roundNumber }),
    }
  );
  if (!res.ok) return { ok: false, error: res.error };
  return res.data;
}

export async function syncCancelBetApi(
  userId: string,
  amount: number
): Promise<{ ok: boolean; balance?: number }> {
  const res = await requestJson<{ ok: boolean; balance?: number }>('/api/wallet/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, amount }),
  });
  if (!res.ok) return { ok: false };
  return res.data;
}

export async function syncWinApi(
  userId: string,
  amount: number,
  multiplier: number,
  roundNumber: number
): Promise<{ ok: boolean; balance?: number }> {
  const res = await requestJson<{ ok: boolean; balance?: number }>('/api/wallet/win', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, amount, multiplier, roundNumber }),
  });
  if (!res.ok) return { ok: false };
  return res.data;
}
