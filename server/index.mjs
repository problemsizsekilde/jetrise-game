import http from 'node:http';
import { loadEnvFile } from './env.mjs';
import {
  applyGameBet,
  applyGameCancel,
  applyGameWin,
  createWalletRequest,
  getPendingRequests,
  getUserBySessionToken,
  getUserState,
  loginUser,
  logoutSession,
  registerUser,
  resolveWalletRequest,
  updateUserProfile,
} from './db.mjs';
import {
  handleTelegramUpdate,
  notifyAdminNewRequest,
  startTelegramBot,
} from './telegramBot.mjs';
import { handleSignalBotUpdate, startSignalBot } from './signalBot.mjs';
import { getCurrentAndNextRound } from './globalTimeline.mjs';

loadEnvFile();

const PORT = Number(process.env.PORT || 3001);

function resolveCorsOrigin(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return '*';

  // Allow localhost, LAN IPs, any *.vercel.app deployment, and custom ALLOWED_ORIGINS
  const extraAllowed = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const isVercel = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
  const isLocal =
    /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/i.test(origin);

  if (isVercel || isLocal || extraAllowed.includes('*') || extraAllowed.includes(origin)) {
    return origin;
  }

  // Default permissive fallback unless STRICT_CORS=true
  if (process.env.STRICT_CORS === 'true') {
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return '';
  }
  return origin;
}

function buildCorsHeaders(req) {
  const allowOrigin = resolveCorsOrigin(req);
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, x-admin-id, x-telegram-bot-api-secret-token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
    if (allowOrigin !== '*') {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
  }
  return headers;
}

function sendJson(req, res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...buildCorsHeaders(req),
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000_000) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

const server = http.createServer(async (req, res) => {
  const reply = (status, data) => sendJson(req, res, status, data);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, buildCorsHeaders(req));
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let pathname = url.pathname
    .replace(/\/{2,}/g, '/')
    .replace(/^\/api\/api(\/|$)/i, '/api$1');
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  try {
    // Root status endpoint (so opening Render URL directly shows healthy status)
    if (req.method === 'GET' && (pathname === '/' || pathname === '/api')) {
      return reply(200, {
        ok: true,
        service: 'Lucky Jet API',
        status: 'running',
        serverTimeMs: Date.now(),
        health: '/api/health',
      });
    }

    // Health & shared clock sync
    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      const hasAdminBotToken = Boolean(
        process.env.TELEGRAM_ADMIN_BOT_TOKEN ||
          process.env.TELEGRAM_BOT_TOKEN ||
          process.env.ADMIN_BOT_TOKEN
      );
      const hasAdminId = Boolean(
        process.env.TELEGRAM_ADMIN_ID ||
          process.env.TELEGRAM_ADMIN_CHAT_ID ||
          process.env.ADMIN_CHAT_ID ||
          process.env.ADMIN_ID
      );
      const hasSignalBotToken = Boolean(process.env.TELEGRAM_SIGNAL_BOT_TOKEN);

      return reply(200, {
        ok: true,
        serverTimeMs: Date.now(),
        hasAdminBotToken,
        hasAdminId,
        adminBotConfigured: hasAdminBotToken && hasAdminId,
        signalBotConfigured: hasSignalBotToken,
      });
    }

    if (req.method === 'GET' && (pathname === '/api/time' || pathname === '/time')) {
      return reply(200, { serverTimeMs: Date.now() });
    }

    if (req.method === 'GET' && (pathname === '/api/round' || pathname === '/round')) {
      const state = getCurrentAndNextRound(Date.now());
      return reply(200, {
        serverTimeMs: Date.now(),
        roundNumber: state.current.roundNumber,
        phase: state.phase,
        multiplier: state.liveMultiplier,
        nextRoundNumber: state.next.roundNumber,
      });
    }

    // --- Auth Endpoints (Gmail + Nick + Password) with clean aliases ---
    if (
      req.method === 'POST' &&
      (pathname === '/api/auth/register' ||
        pathname === '/api/register' ||
        pathname === '/auth/register')
    ) {
      const body = await readJsonBody(req);
      const result = registerUser({
        gmail: body.gmail,
        nick: body.nick,
        password: body.password,
      });
      return reply(result.ok ? 201 : 400, result);
    }

    if (
      req.method === 'POST' &&
      (pathname === '/api/auth/login' || pathname === '/api/login' || pathname === '/auth/login')
    ) {
      const body = await readJsonBody(req);
      const result = loginUser({
        identifier: body.identifier,
        password: body.password,
      });
      return reply(result.ok ? 200 : 401, result);
    }

    if (
      req.method === 'GET' &&
      (pathname === '/api/auth/me' || pathname === '/api/me' || pathname === '/auth/me')
    ) {
      const token = getBearerToken(req);
      const user = getUserBySessionToken(token);
      if (!user) {
        return reply(401, { ok: false, error: 'Sessiya aktiv deyil.' });
      }
      return reply(200, { ok: true, user });
    }

    if (
      req.method === 'POST' &&
      (pathname === '/api/auth/logout' || pathname === '/api/logout' || pathname === '/auth/logout')
    ) {
      const token = getBearerToken(req);
      logoutSession(token);
      return reply(200, { ok: true });
    }

    // User state (balance, pending/approved/rejected requests, transactions)
    const userStateMatch = pathname.match(/^\/api\/user\/([^/]+)\/state$/);
    if (req.method === 'GET' && userStateMatch) {
      const userId = decodeURIComponent(userStateMatch[1]);
      const username = url.searchParams.get('username') || undefined;
      return reply(200, getUserState(userId, username));
    }

    // Update username
    const userProfileMatch = pathname.match(/^\/api\/user\/([^/]+)\/profile$/);
    if (req.method === 'POST' && userProfileMatch) {
      const userId = decodeURIComponent(userProfileMatch[1]);
      const body = await readJsonBody(req);
      const result = updateUserProfile(userId, body.username);
      return reply(result.ok ? 200 : 400, result);
    }

    // Create Deposit / Withdraw request -> Persist as PENDING -> Notify Telegram Admin Bot
    if (req.method === 'POST' && pathname === '/api/wallet/request') {
      const body = await readJsonBody(req);
      const result = createWalletRequest({
        userId: body.userId,
        username: body.username,
        type: body.type,
        amount: body.amount,
        paymentMethod: body.paymentMethod,
        paymentDetails: body.paymentDetails,
        receiptDataUrl: body.receiptDataUrl,
        receiptFileName: body.receiptFileName,
      });

      if (!result.ok) {
        return reply(400, result);
      }

      const tgResult = await notifyAdminNewRequest(result.request, result.user);
      const telegramSent = Boolean(tgResult?.ok);
      const telegramError = telegramSent
        ? null
        : tgResult?.error || tgResult?.description || 'Telegram bildirişi göndərilə bilmədi';

      if (!telegramSent) {
        console.error(`[WalletRequest ${result.request.id}] Telegram bildirişi uğursuz:`, telegramError);
      }

      return reply(201, {
        ok: true,
        request: result.request,
        user: result.user,
        telegramSent,
        telegramNotified: telegramSent,
        telegramError,
      });
    }

    // Game balance mutations (bet, cancel, win)
    if (req.method === 'POST' && pathname === '/api/wallet/bet') {
      const body = await readJsonBody(req);
      const result = applyGameBet(body.userId, body.amount, body.roundNumber);
      return reply(result.ok ? 200 : 400, result);
    }

    if (req.method === 'POST' && pathname === '/api/wallet/cancel') {
      const body = await readJsonBody(req);
      const result = applyGameCancel(body.userId, body.amount);
      return reply(result.ok ? 200 : 400, result);
    }

    if (req.method === 'POST' && pathname === '/api/wallet/win') {
      const body = await readJsonBody(req);
      const result = applyGameWin(body.userId, body.amount, body.multiplier, body.roundNumber);
      return reply(result.ok ? 200 : 400, result);
    }

    // Admin Bot Webhook Endpoint
    if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
      const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
      const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (expectedSecret && incomingSecret && incomingSecret !== expectedSecret) {
        return reply(403, { ok: false, error: 'Invalid webhook secret' });
      }
      const update = await readJsonBody(req);
      await handleTelegramUpdate(update);
      return reply(200, { ok: true });
    }

    // Signal Bot Webhook Endpoint (completely separate from Admin Bot)
    if (req.method === 'POST' && pathname === '/api/telegram/signal-webhook') {
      const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
      const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (expectedSecret && incomingSecret && incomingSecret !== expectedSecret) {
        return reply(403, { ok: false, error: 'Invalid webhook secret' });
      }
      const update = await readJsonBody(req);
      await handleSignalBotUpdate(update);
      return reply(200, { ok: true });
    }

    // Admin API endpoints
    if (req.method === 'GET' && pathname === '/api/admin/pending') {
      const adminHeader = String(req.headers['x-admin-id'] || '');
      if (process.env.TELEGRAM_ADMIN_ID && adminHeader !== String(process.env.TELEGRAM_ADMIN_ID)) {
        return reply(403, { ok: false, error: 'Forbidden' });
      }
      return reply(200, { ok: true, requests: getPendingRequests() });
    }

    if (req.method === 'POST' && pathname === '/api/admin/resolve') {
      const adminHeader = String(req.headers['x-admin-id'] || '');
      if (process.env.TELEGRAM_ADMIN_ID && adminHeader !== String(process.env.TELEGRAM_ADMIN_ID)) {
        return reply(403, { ok: false, error: 'Forbidden' });
      }
      const body = await readJsonBody(req);
      const result = resolveWalletRequest(body.requestId, body.decision, 'admin-api');
      return reply(result.ok ? 200 : 400, result);
    }

    reply(404, { ok: false, error: 'Endpoint tapılmadı' });
  } catch (err) {
    console.error('[Server] Error:', err);
    reply(500, { ok: false, error: 'Daxili server xətası' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[LuckyJet API] http://localhost:${PORT} ünvanında aktivdir`);
  startTelegramBot();
  startSignalBot();
});
