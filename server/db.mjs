import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LIMITS = {
  CURRENCY: 'AZN',
  MIN_DEPOSIT_TERMINAL: 7,
  MIN_DEPOSIT_CARD: 10,
  MIN_DEPOSIT_M10: 10,
  MIN_WITHDRAW: 1,
  MAX_WITHDRAW: 40,
  INITIAL_BALANCE: 0,
};

export const PAYMENT_METHODS = {
  TERMINAL: {
    id: 'TERMINAL',
    label: 'Terminal',
    minDeposit: LIMITS.MIN_DEPOSIT_TERMINAL,
  },
  CARD: {
    id: 'CARD',
    label: 'Kartdan karta',
    minDeposit: LIMITS.MIN_DEPOSIT_CARD,
  },
  M10: {
    id: 'M10',
    label: 'M10',
    minDeposit: LIMITS.MIN_DEPOSIT_M10,
  },
};

const DATA_DIR = path.resolve(process.cwd(), 'server', 'data');
const RECEIPTS_DIR = path.resolve(process.cwd(), 'server', 'uploads', 'receipts');
const DB_PATH = path.join(DATA_DIR, 'db.json');

function roundMoney(v) {
  return Math.round(Number(v) * 100) / 100;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifyPassword(password, salt, expectedHash) {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function createEmptyDb() {
  return {
    nextRequestSeq: 1001,
    users: {},
    sessions: {},
    requests: [],
    transactions: [],
    signalUsers: {},
  };
}

let dbCache = null;

function loadDb() {
  if (dbCache) return dbCache;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    dbCache = createEmptyDb();
    saveDb();
    return dbCache;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    dbCache = {
      nextRequestSeq: parsed.nextRequestSeq || 1001,
      users: parsed.users || {},
      sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      signalUsers:
        parsed.signalUsers && typeof parsed.signalUsers === 'object' ? parsed.signalUsers : {},
    };
  } catch {
    dbCache = createEmptyDb();
    saveDb();
  }
  return dbCache;
}

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(dbCache, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

function toPublicUser(user) {
  return {
    userId: user.userId,
    username: user.username,
    nick: user.nick || user.username,
    gmail: user.gmail || null,
    isRegistered: Boolean(user.isRegistered),
    balance: roundMoney(user.balance),
  };
}

function addTransaction(db, { userId, type, amount, balanceAfter, note }) {
  const tx = {
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId,
    type,
    amount: roundMoney(amount),
    balanceAfter: roundMoney(balanceAfter),
    timestamp: Date.now(),
    note,
  };
  db.transactions.unshift(tx);
  if (db.transactions.length > 500) {
    db.transactions = db.transactions.slice(0, 500);
  }
  return tx;
}

// --- Auth: Register / Login / Session ---

export function registerUser({ gmail, nick, password }) {
  const db = loadDb();
  const cleanGmail = String(gmail || '').trim();
  const cleanNick = String(nick || '').trim();
  const rawPassword = String(password ?? '');

  if (!/^[^\s@]+@gmail\.com$/i.test(cleanGmail)) {
    return { ok: false, error: 'Zəhmət olmasa düzgün Gmail ünvanı daxil edin (məs: ad@gmail.com).' };
  }

  if (cleanNick.length < 2 || cleanNick.length > 24) {
    return { ok: false, error: 'Şəxsi nick 2 ilə 24 simvol arasında olmalıdır.' };
  }

  if (rawPassword.length < 6) {
    return { ok: false, error: 'Şifrə minimum 6 simvoldan ibarət olmalıdır.' };
  }

  const gmailLower = cleanGmail.toLowerCase();
  const nickLower = cleanNick.toLowerCase();

  for (const existing of Object.values(db.users)) {
    if (existing.gmailLower && existing.gmailLower === gmailLower) {
      return { ok: false, error: 'Bu Gmail ünvanı ilə artıq hesab qeydiyyatdan keçib.' };
    }
    if (existing.nickLower && existing.nickLower === nickLower) {
      return { ok: false, error: 'Bu şəxsi nick artıq istifadə olunur. Başqa nick seçin.' };
    }
  }

  const userId = `LJ-${Math.floor(100000 + Math.random() * 900000)}`;
  const { salt, hash } = hashPassword(rawPassword);

  const user = {
    userId,
    username: cleanNick,
    nick: cleanNick,
    nickLower,
    gmail: cleanGmail,
    gmailLower,
    passwordSalt: salt,
    passwordHash: hash,
    isRegistered: true,
    balance: LIMITS.INITIAL_BALANCE,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  db.users[userId] = user;
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = userId;
  saveDb();

  return { ok: true, token, user: toPublicUser(user) };
}

export function loginUser({ identifier, password }) {
  const db = loadDb();
  const cleanIdent = String(identifier || '').trim().toLowerCase();
  const rawPassword = String(password ?? '');

  if (!cleanIdent || !rawPassword) {
    return { ok: false, error: 'Gmail/Nick və şifrə daxil edin.' };
  }

  const user = Object.values(db.users).find(
    (u) =>
      u.isRegistered &&
      ((u.gmailLower && u.gmailLower === cleanIdent) ||
        (u.nickLower && u.nickLower === cleanIdent))
  );

  if (!user || !user.passwordSalt || !user.passwordHash) {
    return { ok: false, error: 'İstifadəçi tapılmadı və ya şifrə yanlışdır.' };
  }

  if (!verifyPassword(rawPassword, user.passwordSalt, user.passwordHash)) {
    return { ok: false, error: 'İstifadəçi tapılmadı və ya şifrə yanlışdır.' };
  }

  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = user.userId;
  saveDb();

  return { ok: true, token, user: toPublicUser(user) };
}

export function getUserBySessionToken(token) {
  const db = loadDb();
  if (!token) return null;
  const userId = db.sessions[token];
  if (!userId || !db.users[userId]) return null;
  return toPublicUser(db.users[userId]);
}

export function logoutSession(token) {
  const db = loadDb();
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    saveDb();
  }
  return { ok: true };
}

// --- User & Wallet State ---

export function getOrCreateUser(userId, username) {
  const db = loadDb();
  const safeId =
    String(userId || '').trim() || `LJ-${Math.floor(100000 + Math.random() * 900000)}`;
  if (!db.users[safeId]) {
    db.users[safeId] = {
      userId: safeId,
      username: String(username || '').trim() || `Qonaq ${safeId.slice(-4)}`,
      nick: String(username || '').trim() || `Qonaq ${safeId.slice(-4)}`,
      gmail: null,
      isRegistered: false,
      balance: LIMITS.INITIAL_BALANCE,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveDb();
  }
  return db.users[safeId];
}

export function updateUserProfile(userId, username) {
  const db = loadDb();
  const user = getOrCreateUser(userId);
  const cleanName = String(username || '').trim().slice(0, 32);
  if (cleanName) {
    const nickLower = cleanName.toLowerCase();
    const conflict = Object.values(db.users).find(
      (u) => u.userId !== user.userId && u.nickLower && u.nickLower === nickLower
    );
    if (conflict) {
      return { ok: false, error: 'Bu nick artıq başqa istifadəçi tərəfindən istifadə olunur.' };
    }
    user.username = cleanName;
    user.nick = cleanName;
    user.nickLower = nickLower;
    user.updatedAt = Date.now();
    saveDb();
  }
  return { ok: true, user: toPublicUser(user) };
}

export function getUserState(userId, username) {
  const db = loadDb();
  const user = getOrCreateUser(userId, username);
  const requests = db.requests
    .filter((r) => r.userId === user.userId)
    .slice(0, 30);
  const transactions = db.transactions
    .filter((t) => t.userId === user.userId)
    .slice(0, 30);

  return {
    user: toPublicUser(user),
    requests,
    transactions,
    serverTimeMs: Date.now(),
  };
}

function saveReceiptFile(reqId, receiptDataUrl, receiptFileName) {
  if (!receiptDataUrl || typeof receiptDataUrl !== 'string') return null;
  const match = receiptDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 6 * 1024 * 1024) {
    return { error: 'Qəbz faylının ölçüsü 6 MB-dan böyük ola bilməz.' };
  }

  let ext = 'bin';
  if (mimeType.includes('png')) ext = 'png';
  else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
  else if (mimeType.includes('webp')) ext = 'webp';
  else if (mimeType.includes('pdf')) ext = 'pdf';

  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  const safeFileName = `${reqId}.${ext}`;
  const fullPath = path.join(RECEIPTS_DIR, safeFileName);
  fs.writeFileSync(fullPath, buffer);

  return {
    mimeType,
    originalName: String(receiptFileName || safeFileName).slice(0, 80),
    fileName: safeFileName,
    fullPath,
    sizeBytes: buffer.length,
  };
}

export function createWalletRequest({
  userId,
  username,
  type,
  amount,
  paymentMethod,
  paymentDetails,
  receiptDataUrl,
  receiptFileName,
}) {
  const db = loadDb();
  const user = getOrCreateUser(userId, username);
  const cleanAmount = roundMoney(amount);

  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    return { ok: false, error: 'Düzgün məbləğ daxil edin.' };
  }

  let resolvedMethod = null;

  if (type === 'DEPOSIT') {
    const methodKey = String(paymentMethod || 'CARD').toUpperCase();
    resolvedMethod = PAYMENT_METHODS[methodKey];
    if (!resolvedMethod) {
      return { ok: false, error: 'Düzgün depozit üsulu seçin (Terminal, Kartdan karta və ya M10).' };
    }
    if (cleanAmount < resolvedMethod.minDeposit) {
      return {
        ok: false,
        error: `${resolvedMethod.label} üsulu üçün minimum depozit məbləği ${resolvedMethod.minDeposit} ${LIMITS.CURRENCY}-dir.`,
      };
    }
    if (!receiptDataUrl) {
      return {
        ok: false,
        error: 'Depozit sorğusunu göndərmək üçün ödəniş qəbzini (şəkil/fayl) əlavə edin.',
      };
    }
  } else if (type === 'WITHDRAW') {
    if (cleanAmount < LIMITS.MIN_WITHDRAW) {
      return {
        ok: false,
        error: `Minimum çıxarış məbləği ${LIMITS.MIN_WITHDRAW} ${LIMITS.CURRENCY}-dir.`,
      };
    }
    if (cleanAmount > LIMITS.MAX_WITHDRAW) {
      return {
        ok: false,
        error: `Maksimum birdəfəlik çıxarış limiti ${LIMITS.MAX_WITHDRAW} ${LIMITS.CURRENCY}-dir.`,
      };
    }
    const pendingWithdrawSum = db.requests
      .filter((r) => r.userId === user.userId && r.type === 'WITHDRAW' && r.status === 'PENDING')
      .reduce((acc, r) => acc + r.amount, 0);

    if (roundMoney(pendingWithdrawSum + cleanAmount) > user.balance) {
      return {
        ok: false,
        error: `Balansınızda kifayət qədər vəsait yoxdur (Mövcud: ${user.balance.toFixed(2)} ${LIMITS.CURRENCY}, Gözləyən çıxarış: ${pendingWithdrawSum.toFixed(2)} ${LIMITS.CURRENCY}).`,
      };
    }
  } else {
    return { ok: false, error: 'Yanlış əməliyyat növü.' };
  }

  const reqId = `REQ-${db.nextRequestSeq++}`;
  let receiptInfo = null;
  if (type === 'DEPOSIT' && receiptDataUrl) {
    const saved = saveReceiptFile(reqId, receiptDataUrl, receiptFileName);
    if (saved?.error) {
      return { ok: false, error: saved.error };
    }
    receiptInfo = saved;
  }

  const request = {
    id: reqId,
    userId: user.userId,
    username: user.nick || user.username,
    gmail: user.gmail || null,
    type,
    paymentMethod: resolvedMethod ? resolvedMethod.id : null,
    paymentMethodLabel: resolvedMethod ? resolvedMethod.label : null,
    amount: cleanAmount,
    paymentDetails: String(paymentDetails || '').trim().slice(0, 120),
    receiptFileName: receiptInfo ? receiptInfo.originalName : null,
    receiptMimeType: receiptInfo ? receiptInfo.mimeType : null,
    receiptPath: receiptInfo ? receiptInfo.fullPath : null,
    status: 'PENDING',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resolvedBy: null,
    rejectReason: null,
  };

  db.requests.unshift(request);
  saveDb();

  return { ok: true, request, user: toPublicUser(user) };
}

export function resolveWalletRequest(requestId, decision, resolvedBy = 'admin') {
  const db = loadDb();
  const req = db.requests.find((r) => r.id === requestId);
  if (!req) {
    return { ok: false, error: `Sorğu tapılmadı: ${requestId}` };
  }
  if (req.status !== 'PENDING') {
    return {
      ok: false,
      error: `Bu sorğu artıq icra olunub (Status: ${req.status}).`,
      request: req,
      user: db.users[req.userId] ? toPublicUser(db.users[req.userId]) : null,
    };
  }

  const user = getOrCreateUser(req.userId, req.username);

  if (decision === 'APPROVED') {
    if (req.type === 'DEPOSIT') {
      user.balance = roundMoney(user.balance + req.amount);
      user.updatedAt = Date.now();
      req.status = 'APPROVED';
      req.updatedAt = Date.now();
      req.resolvedBy = resolvedBy;
      addTransaction(db, {
        userId: user.userId,
        type: 'DEPOSIT',
        amount: req.amount,
        balanceAfter: user.balance,
        note: `Depozit təsdiqləndi (${req.paymentMethodLabel || 'Depozit'} • ${req.id})`,
      });
    } else if (req.type === 'WITHDRAW') {
      if (req.amount > LIMITS.MAX_WITHDRAW) {
        return {
          ok: false,
          error: `Çıxarış limiti (${LIMITS.MAX_WITHDRAW} ${LIMITS.CURRENCY}) aşılıb.`,
        };
      }
      if (user.balance < req.amount) {
        return {
          ok: false,
          error: `İstifadəçinin balansı kifayət etmir (${user.balance.toFixed(2)} ${LIMITS.CURRENCY} < ${req.amount.toFixed(2)} ${LIMITS.CURRENCY}).`,
        };
      }
      user.balance = roundMoney(user.balance - req.amount);
      user.updatedAt = Date.now();
      req.status = 'APPROVED';
      req.updatedAt = Date.now();
      req.resolvedBy = resolvedBy;
      addTransaction(db, {
        userId: user.userId,
        type: 'WITHDRAW',
        amount: -req.amount,
        balanceAfter: user.balance,
        note: `Çıxarış təsdiqləndi (${req.id})`,
      });
    }
  } else if (decision === 'REJECTED') {
    req.status = 'REJECTED';
    req.updatedAt = Date.now();
    req.resolvedBy = resolvedBy;
  } else {
    return { ok: false, error: 'Yanlış qərar statusu.' };
  }

  saveDb();
  return { ok: true, request: req, user: toPublicUser(user) };
}

export function applyGameBet(userId, amount, roundNumber) {
  const db = loadDb();
  const user = getOrCreateUser(userId);
  const cleanAmount = roundMoney(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    return { ok: false, error: 'Yanlış mərc məbləği.' };
  }
  if (cleanAmount > user.balance) {
    return { ok: false, error: 'Balans kifayət etmir.' };
  }
  user.balance = roundMoney(user.balance - cleanAmount);
  user.updatedAt = Date.now();
  const tx = addTransaction(db, {
    userId: user.userId,
    type: 'BET',
    amount: -cleanAmount,
    balanceAfter: user.balance,
    note: `Raund #${roundNumber} mərc`,
  });
  saveDb();
  return { ok: true, balance: user.balance, transaction: tx };
}

export function applyGameCancel(userId, amount) {
  const db = loadDb();
  const user = getOrCreateUser(userId);
  const cleanAmount = roundMoney(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    return { ok: false, error: 'Yanlış məbləğ.' };
  }
  user.balance = roundMoney(user.balance + cleanAmount);
  user.updatedAt = Date.now();
  const tx = addTransaction(db, {
    userId: user.userId,
    type: 'DEPOSIT',
    amount: cleanAmount,
    balanceAfter: user.balance,
    note: 'Ləğv edilən mərcin qaytarılması',
  });
  saveDb();
  return { ok: true, balance: user.balance, transaction: tx };
}

export function applyGameWin(userId, amount, multiplier, roundNumber) {
  const db = loadDb();
  const user = getOrCreateUser(userId);
  const cleanAmount = roundMoney(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    return { ok: false, error: 'Yanlış uduş məbləği.' };
  }
  user.balance = roundMoney(user.balance + cleanAmount);
  user.updatedAt = Date.now();
  const tx = addTransaction(db, {
    userId: user.userId,
    type: 'WIN',
    amount: cleanAmount,
    balanceAfter: user.balance,
    note: `Raund #${roundNumber} uduş (${Number(multiplier).toFixed(2)}x)`,
  });
  saveDb();
  return { ok: true, balance: user.balance, transaction: tx };
}

export function getPendingRequests() {
  const db = loadDb();
  return db.requests.filter((r) => r.status === 'PENDING');
}

export function getAdminStats() {
  const db = loadDb();
  const userCount = Object.keys(db.users).length;
  const registeredCount = Object.values(db.users).filter((u) => u.isRegistered).length;
  const pending = db.requests.filter((r) => r.status === 'PENDING').length;
  const approved = db.requests.filter((r) => r.status === 'APPROVED').length;
  const rejected = db.requests.filter((r) => r.status === 'REJECTED').length;
  const signalUsersCount = Object.keys(db.signalUsers || {}).length;
  return { userCount, registeredCount, pending, approved, rejected, signalUsersCount };
}

function normalizeSignalEntry(raw, telegramId) {
  if (!raw || typeof raw !== 'object') return null;
  const rawTrials =
    raw.trial_attempts !== undefined ? raw.trial_attempts : raw.single_signal_credits;
  const unlimited =
    typeof raw.unlimited === 'boolean' ? raw.unlimited : rawTrials === undefined;
  const trialAttempts = Number.isFinite(Number(rawTrials))
    ? Math.max(0, Math.floor(Number(rawTrials)))
    : 0;
  return {
    telegramId: String(raw.telegramId || telegramId),
    unlimited,
    trial_attempts: trialAttempts,
    grantedAt: raw.grantedAt || Date.now(),
    grantedBy: String(raw.grantedBy || 'admin'),
  };
}

export function getSignalUserAccess(telegramId) {
  const db = loadDb();
  const cleanId = String(telegramId || '').trim();
  const entry = normalizeSignalEntry(db.signalUsers?.[cleanId], cleanId);
  if (!entry) {
    return { telegramId: cleanId, unlimited: false, trial_attempts: 0 };
  }
  return entry;
}

export function grantSignalAccess(telegramId, grantedBy = 'admin') {
  const db = loadDb();
  const cleanId = String(telegramId || '').trim();
  if (!/^\d{4,20}$/.test(cleanId)) {
    return { ok: false, error: 'Düzgün Telegram ID daxil edin (yalnız rəqəmlər).' };
  }
  const existing = normalizeSignalEntry(db.signalUsers?.[cleanId], cleanId);
  const alreadyUnlimited = Boolean(existing?.unlimited);
  db.signalUsers[cleanId] = {
    telegramId: cleanId,
    unlimited: true,
    trial_attempts: existing?.trial_attempts || 0,
    grantedAt: Date.now(),
    grantedBy: String(grantedBy),
  };
  saveDb();
  return { ok: true, alreadyExists: alreadyUnlimited, entry: db.signalUsers[cleanId] };
}

export function grantTrialAttempts(telegramId, count = 1, grantedBy = 'admin') {
  const db = loadDb();
  const cleanId = String(telegramId || '').trim();
  if (!/^\d{4,20}$/.test(cleanId)) {
    return { ok: false, error: 'Düzgün Telegram ID daxil edin (yalnız rəqəmlər).' };
  }
  const parsedCount = Math.floor(Number(count));
  if (!Number.isFinite(parsedCount) || parsedCount < 1 || parsedCount > 1000) {
    return { ok: false, error: 'Sınaq cəhd sayı 1 ilə 1000 arasında tam ədəd olmalıdır.' };
  }
  const existing = normalizeSignalEntry(db.signalUsers?.[cleanId], cleanId);
  db.signalUsers[cleanId] = {
    telegramId: cleanId,
    unlimited: Boolean(existing?.unlimited),
    trial_attempts: parsedCount,
    grantedAt: Date.now(),
    grantedBy: String(grantedBy),
  };
  saveDb();
  return { ok: true, entry: db.signalUsers[cleanId] };
}

export function consumeTrialAttempt(telegramId) {
  const db = loadDb();
  const cleanId = String(telegramId || '').trim();
  const existing = normalizeSignalEntry(db.signalUsers?.[cleanId], cleanId);
  if (!existing || existing.trial_attempts <= 0) {
    return { ok: false, remaining: 0 };
  }
  const remaining = Math.max(0, existing.trial_attempts - 1);
  db.signalUsers[cleanId] = {
    ...existing,
    trial_attempts: remaining,
    lastUsedAt: Date.now(),
  };
  saveDb();
  return { ok: true, remaining };
}

export function revokeSignalAccess(telegramId) {
  const db = loadDb();
  const cleanId = String(telegramId || '').trim();
  if (!/^\d{4,20}$/.test(cleanId)) {
    return { ok: false, error: 'Düzgün Telegram ID daxil edin (yalnız rəqəmlər).' };
  }
  if (!db.signalUsers[cleanId]) {
    return { ok: false, error: `ID ${cleanId} icazəli siyahıda tapılmadı.` };
  }
  delete db.signalUsers[cleanId];
  saveDb();
  return { ok: true, telegramId: cleanId };
}

export function isSignalUserAuthorized(telegramId) {
  const access = getSignalUserAccess(telegramId);
  return access.unlimited || access.trial_attempts > 0;
}

export function listSignalUsers() {
  const db = loadDb();
  return Object.entries(db.signalUsers || {})
    .map(([id, raw]) => normalizeSignalEntry(raw, id))
    .filter((u) => u && (u.unlimited || u.trial_attempts > 0))
    .sort((a, b) => b.grantedAt - a.grantedAt);
}
