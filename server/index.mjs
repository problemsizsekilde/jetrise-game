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

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, x-admin-id, x-telegram-bot-api-secret-token',
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
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    // Health & shared clock sync
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        serverTimeMs: Date.now(),
        adminBotConfigured: Boolean(
          (process.env.TELEGRAM_ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN) &&
            process.env.TELEGRAM_ADMIN_ID
        ),
        signalBotConfigured: Boolean(process.env.TELEGRAM_SIGNAL_BOT_TOKEN),
      });
    }

    if (req.method === 'GET' && pathname === '/api/time') {
      return sendJson(res, 200, { serverTimeMs: Date.now() });
    }

    if (req.method === 'GET' && pathname === '/api/round') {
      const state = getCurrentAndNextRound(Date.now());
      return sendJson(res, 200, {
        serverTimeMs: Date.now(),
        roundNumber: state.current.roundNumber,
        phase: state.phase,
        multiplier: state.liveMultiplier,
        nextRoundNumber: state.next.roundNumber,
      });
    }

    // --- Auth Endpoints (Gmail + Nick + Password) ---
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await readJsonBody(req);
      const result = registerUser({
        gmail: body.gmail,
        nick: body.nick,
        password: body.password,
      });
      return sendJson(res, result.ok ? 201 : 400, result);
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await readJsonBody(req);
      const result = loginUser({
        identifier: body.identifier,
        password: body.password,
      });
      return sendJson(res, result.ok ? 200 : 401, result);
    }

    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const token = getBearerToken(req);
      const user = getUserBySessionToken(token);
      if (!user) {
        return sendJson(res, 401, { ok: false, error: 'Sessiya aktiv deyil.' });
      }
      return sendJson(res, 200, { ok: true, user });
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const token = getBearerToken(req);
      logoutSession(token);
      return sendJson(res, 200, { ok: true });
    }

    // User state (balance, pending/approved/rejected requests, transactions)
    const userStateMatch = pathname.match(/^\/api\/user\/([^/]+)\/state$/);
    if (req.method === 'GET' && userStateMatch) {
      const userId = decodeURIComponent(userStateMatch[1]);
      const username = url.searchParams.get('username') || undefined;
      return sendJson(res, 200, getUserState(userId, username));
    }

    // Update username
    const userProfileMatch = pathname.match(/^\/api\/user\/([^/]+)\/profile$/);
    if (req.method === 'POST' && userProfileMatch) {
      const userId = decodeURIComponent(userProfileMatch[1]);
      const body = await readJsonBody(req);
      const result = updateUserProfile(userId, body.username);
      return sendJson(res, result.ok ? 200 : 400, result);
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
        return sendJson(res, 400, result);
      }

      const tgResult = await notifyAdminNewRequest(result.request, result.user);
      return sendJson(res, 201, {
        ok: true,
        request: result.request,
        user: result.user,
        telegramNotified: Boolean(tgResult?.ok),
      });
    }

    // Game balance mutations (bet, cancel, win)
    if (req.method === 'POST' && pathname === '/api/wallet/bet') {
      const body = await readJsonBody(req);
      const result = applyGameBet(body.userId, body.amount, body.roundNumber);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'POST' && pathname === '/api/wallet/cancel') {
      const body = await readJsonBody(req);
      const result = applyGameCancel(body.userId, body.amount);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'POST' && pathname === '/api/wallet/win') {
      const body = await readJsonBody(req);
      const result = applyGameWin(body.userId, body.amount, body.multiplier, body.roundNumber);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    // Admin Bot Webhook Endpoint
    if (req.method === 'POST' && pathname === '/api/telegram/webhook') {
      const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
      const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (expectedSecret && incomingSecret && incomingSecret !== expectedSecret) {
        return sendJson(res, 403, { ok: false, error: 'Invalid webhook secret' });
      }
      const update = await readJsonBody(req);
      await handleTelegramUpdate(update);
      return sendJson(res, 200, { ok: true });
    }

    // Signal Bot Webhook Endpoint (completely separate from Admin Bot)
    if (req.method === 'POST' && pathname === '/api/telegram/signal-webhook') {
      const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
      const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (expectedSecret && incomingSecret && incomingSecret !== expectedSecret) {
        return sendJson(res, 403, { ok: false, error: 'Invalid webhook secret' });
      }
      const update = await readJsonBody(req);
      await handleSignalBotUpdate(update);
      return sendJson(res, 200, { ok: true });
    }

    // Admin API endpoints
    if (req.method === 'GET' && pathname === '/api/admin/pending') {
      const adminHeader = String(req.headers['x-admin-id'] || '');
      if (process.env.TELEGRAM_ADMIN_ID && adminHeader !== String(process.env.TELEGRAM_ADMIN_ID)) {
        return sendJson(res, 403, { ok: false, error: 'Forbidden' });
      }
      return sendJson(res, 200, { ok: true, requests: getPendingRequests() });
    }

    if (req.method === 'POST' && pathname === '/api/admin/resolve') {
      const adminHeader = String(req.headers['x-admin-id'] || '');
      if (process.env.TELEGRAM_ADMIN_ID && adminHeader !== String(process.env.TELEGRAM_ADMIN_ID)) {
        return sendJson(res, 403, { ok: false, error: 'Forbidden' });
      }
      const body = await readJsonBody(req);
      const result = resolveWalletRequest(body.requestId, body.decision, 'admin-api');
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    sendJson(res, 404, { ok: false, error: 'Endpoint tapılmadı' });
  } catch (err) {
    console.error('[Server] Error:', err);
    sendJson(res, 500, { ok: false, error: 'Daxili server xətası' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[LuckyJet API] http://localhost:${PORT} ünvanında aktivdir`);
  startTelegramBot();
  startSignalBot();
});
