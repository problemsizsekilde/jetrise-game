import {
  consumeTrialAttempt,
  getSignalUserAccess,
} from './db.mjs';
import { buildSignalForNow } from './globalTimeline.mjs';

const cooldownMap = new Map(); // telegramId -> lastSignalTimestampMs

function getSignalBotConfig() {
  const token = (
    process.env.TELEGRAM_SIGNAL_BOT_TOKEN ||
    process.env.SIGNAL_BOT_TOKEN ||
    ''
  ).trim();
  const adminToken = (
    process.env.TELEGRAM_ADMIN_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.ADMIN_BOT_TOKEN ||
    ''
  ).trim();
  const adminId = String(
    process.env.TELEGRAM_ADMIN_ID ||
      process.env.TELEGRAM_ADMIN_CHAT_ID ||
      process.env.ADMIN_CHAT_ID ||
      process.env.ADMIN_ID ||
      ''
  ).trim();

  return {
    token,
    adminToken,
    adminContact: process.env.TELEGRAM_ADMIN_CONTACT || `Admin (ID: ${adminId})`,
    accessPriceAzn: Number(process.env.SIGNAL_ACCESS_PRICE_AZN || 55),
    testPriceAzn: Number(process.env.SIGNAL_TEST_PRICE_AZN || 2),
    cooldownSec: Number(process.env.SIGNAL_COOLDOWN_SECONDS || 12),
    mode: (process.env.TELEGRAM_MODE || 'polling').toLowerCase(),
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function signalTgApi(method, payload = {}) {
  const { token } = getSignalBotConfig();
  if (!token) {
    return { ok: false, description: 'TELEGRAM_SIGNAL_BOT_TOKEN təyin edilməyib' };
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

const MAIN_REPLY_KEYBOARD = {
  keyboard: [[{ text: '🚀 Siqnal Al' }, { text: 'ℹ️ Statusum' }]],
  resize_keyboard: true,
};

const SIGNAL_INLINE_KEYBOARD = {
  inline_keyboard: [[{ text: '🚀 Siqnal Al', callback_data: 'signal:get' }]],
};

function buildAccessDeniedMessage(telegramId) {
  const { accessPriceAzn, testPriceAzn, adminContact } = getSignalBotConfig();
  return [
    '<b>🔒 Siqnal Girişi Aktiv Deyil / Sınaq Cəhdləri Bitib</b>',
    '',
    `Lucky Jet Siqnal Botundan limitsiz istifadə etmək üçün <b>${accessPriceAzn} AZN</b> tam giriş aktivləşdirilməlidir.`,
    `<i>(Sınaq üçün 1 dəfəlik test: ${testPriceAzn} AZN)</i>`,
    '',
    `🆔 <b>Sizin Telegram ID:</b> <code>${escapeHtml(telegramId)}</code>`,
    `📩 <b>Adminlə əlaqə:</b> ${escapeHtml(adminContact)}`,
    '',
    'Ödənişdən sonra Telegram ID-nizi adminə göndərin — giriş aktiv edildiyi an <b>🚀 Siqnal Al</b> düyməsi işləyəcək.',
  ].join('\n');
}

function buildSignalCardMessage(trialRemaining = null) {
  const { accessPriceAzn, adminContact } = getSignalBotConfig();
  const sig = buildSignalForNow(Date.now());
  const takeoffTimeStr = new Date(sig.takeoffAt).toLocaleTimeString('az-AZ', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const isTrial = trialRemaining !== null;
  const roundLabel = sig.isCurrentRound ? 'Cari raund' : 'Növbəti raund';
  const targetLine =
    sig.recommendedMultiplier !== null
      ? `🎯 <b>Tövsiyə olunan əmsal:</b> <b>${sig.recommendedMultiplier.toFixed(2)}x</b>`
      : '🎯 <b>Tövsiyə:</b> <b>Bu raundu buraxın (Mərc etməyin)</b>';

  const lines = [
    isTrial
      ? '<b>🎟️ LUCKY JET — SINAQ SİQNALI</b>'
      : '<b>🚀 LUCKY JET CANLI SİQNAL</b>',
    '',
    `🔢 <b>Raund:</b> #${sig.targetRoundNumber} (${roundLabel})`,
    `⏱️ <b>Uçuş vaxtı:</b> ~${sig.startsInSec} saniyə sonra (${takeoffTimeStr})`,
    targetLine,
    `📊 <b>Risk səviyyəsi:</b> ${sig.riskLabel}`,
    `💡 <b>Qeyd:</b> ${sig.riskNote}`,
  ];

  if (isTrial) {
    lines.push('', '────────────────────');
    if (trialRemaining > 0) {
      lines.push(`🎟️ <b>Qalan sınaq cəhdi:</b> <b>${trialRemaining}</b>`);
    } else {
      lines.push(
        '⚠️ <b>Sınaq cəhdləriniz bitdi (qalan cəhd: 0).</b>',
        `🔒 Davam etmək üçün <b>${accessPriceAzn} AZN</b> tam siqnal girişi lazımdır.`,
        `📩 <b>Adminlə əlaqə:</b> ${escapeHtml(adminContact)}`
      );
    }
  }

  return lines.join('\n');
}

function formatStatusLabel(access) {
  if (access.unlimited) return '✅ Tam giriş (Limitsiz)';
  if (access.trial_attempts > 0) {
    return `🎟️ Sınaq cəhdləri aktivdir (qalan: ${access.trial_attempts})`;
  }
  return '🔒 Aktiv deyil';
}

async function sendSignalResponse(chatId, telegramId) {
  const cleanId = String(telegramId);
  const access = getSignalUserAccess(cleanId);

  // 1. Tam / Limitsiz giriş
  if (access.unlimited) {
    const { cooldownSec } = getSignalBotConfig();
    const now = Date.now();
    const lastAt = cooldownMap.get(cleanId) || 0;
    const remainingMs = cooldownSec * 1000 - (now - lastAt);

    if (remainingMs > 0) {
      const waitSec = Math.ceil(remainingMs / 1000);
      await signalTgApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `⏳ Zəhmət olmasa növbəti siqnal üçün <b>${waitSec} saniyə</b> gözləyin.`,
        reply_markup: SIGNAL_INLINE_KEYBOARD,
      });
      return;
    }

    cooldownMap.set(cleanId, now);

    await signalTgApi('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: buildSignalCardMessage(null),
      reply_markup: SIGNAL_INLINE_KEYBOARD,
    });
    return;
  }

  // 2. Sınaq cəhdləri (trial_attempts > 0)
  if (access.trial_attempts > 0) {
    const { cooldownSec } = getSignalBotConfig();
    const now = Date.now();
    const lastAt = cooldownMap.get(cleanId) || 0;
    const remainingMs = cooldownSec * 1000 - (now - lastAt);

    if (remainingMs > 0) {
      const waitSec = Math.ceil(remainingMs / 1000);
      await signalTgApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `⏳ Növbəti sınaq siqnalı üçün <b>${waitSec} saniyə</b> gözləyin (qalan cəhd: <b>${access.trial_attempts}</b>).`,
        reply_markup: SIGNAL_INLINE_KEYBOARD,
      });
      return;
    }

    const consumed = consumeTrialAttempt(cleanId);
    if (!consumed.ok) {
      await signalTgApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: buildAccessDeniedMessage(cleanId),
        reply_markup: MAIN_REPLY_KEYBOARD,
      });
      return;
    }

    cooldownMap.set(cleanId, now);

    await signalTgApi('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: buildSignalCardMessage(consumed.remaining),
      reply_markup: consumed.remaining > 0 ? SIGNAL_INLINE_KEYBOARD : MAIN_REPLY_KEYBOARD,
    });
    return;
  }

  // 3. Aktiv haqqı qalmayıb -> 55 AZN giriş məlumatı
  await signalTgApi('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: buildAccessDeniedMessage(cleanId),
    reply_markup: MAIN_REPLY_KEYBOARD,
  });
}

export async function handleSignalBotUpdate(update) {
  if (update.callback_query) {
    const cq = update.callback_query;
    const fromId = String(cq.from?.id || '');
    const chatId = cq.message?.chat?.id || fromId;
    const data = String(cq.data || '');

    await signalTgApi('answerCallbackQuery', {
      callback_query_id: cq.id,
    });

    if (data === 'signal:get') {
      await sendSignalResponse(chatId, fromId);
    }
    return;
  }

  if (update.message && update.message.text) {
    const msg = update.message;
    const fromId = String(msg.from?.id || '');
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const lower = text.toLowerCase();

    if (lower === '/start' || lower === '/help') {
      const access = getSignalUserAccess(fromId);
      await signalTgApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: [
          '<b>🚀 Lucky Jet Siqnal Botuna Xoş Gəlmisiniz!</b>',
          '',
          `🆔 <b>Sizin Telegram ID:</b> <code>${escapeHtml(fromId)}</code>`,
          `🔐 <b>Giriş statusu:</b> ${formatStatusLabel(access)}`,
          '',
          'Canlı raund siqnalı almaq üçün aşağıdakı <b>🚀 Siqnal Al</b> düyməsinə basın.',
        ].join('\n'),
        reply_markup: MAIN_REPLY_KEYBOARD,
      });
      return;
    }

    if (lower === 'ℹ️ statusum' || lower === 'statusum' || lower === '/status') {
      const access = getSignalUserAccess(fromId);
      if (access.unlimited || access.trial_attempts > 0) {
        await signalTgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: [
            `<b>${formatStatusLabel(access)}</b>`,
            `🆔 Telegram ID: <code>${escapeHtml(fromId)}</code>`,
            access.unlimited
              ? 'İstədiyiniz vaxt <b>🚀 Siqnal Al</b> düyməsi ilə canlı raund siqnalı ala bilərsiniz.'
              : `Qalan <b>${access.trial_attempts}</b> sınaq cəhdinizdən istifadə etmək üçün <b>🚀 Siqnal Al</b> düyməsinə basın.`,
          ].join('\n'),
          reply_markup: SIGNAL_INLINE_KEYBOARD,
        });
      } else {
        await signalTgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: buildAccessDeniedMessage(fromId),
          reply_markup: MAIN_REPLY_KEYBOARD,
        });
      }
      return;
    }

    if (lower.includes('siqnal') || lower === '/siqnal') {
      await sendSignalResponse(chatId, fromId);
      return;
    }

    await signalTgApi('sendMessage', {
      chat_id: chatId,
      text: 'Siqnal almaq üçün "🚀 Siqnal Al" düyməsini sıxın.',
      reply_markup: MAIN_REPLY_KEYBOARD,
    });
  }
}

let signalPollingActive = false;
const signalBotState = {
  connected: false,
  username: null,
  lastError: null,
  lastPollAt: null,
};

export function getSignalBotStatus() {
  const { token, mode } = getSignalBotConfig();
  return {
    configured: Boolean(token),
    hasToken: Boolean(token),
    mode,
    pollingActive: signalPollingActive,
    connected: signalBotState.connected,
    username: signalBotState.username,
    lastError: signalBotState.lastError,
    lastPollAt: signalBotState.lastPollAt,
  };
}

export async function startSignalBot() {
  const { token, adminToken, mode } = getSignalBotConfig();
  if (!token) {
    signalBotState.lastError = 'TELEGRAM_SIGNAL_BOT_TOKEN təyin edilməyib';
    console.error('[SignalBot] XƏTA: TELEGRAM_SIGNAL_BOT_TOKEN (və ya SIGNAL_BOT_TOKEN) tapılmadı — Siqnal Botu başlamadı.');
    return;
  }

  if (adminToken && token === adminToken) {
    signalBotState.lastError = 'TELEGRAM_SIGNAL_BOT_TOKEN və TELEGRAM_ADMIN_BOT_TOKEN eyni ola bilməz';
    console.error(`[SignalBot] XƏTA: ${signalBotState.lastError}! Siqnal botu dayandırıldı.`);
    return;
  }

  // Verify token via getMe
  try {
    const me = await signalTgApi('getMe');
    if (me.ok && me.result) {
      signalBotState.connected = true;
      signalBotState.username = `@${me.result.username}`;
      signalBotState.lastError = null;
      console.log(`[SignalBot] Bağlandı: @${me.result.username} (ID: ${me.result.id}) | Rejim: ${mode}`);
    } else {
      signalBotState.connected = false;
      signalBotState.lastError = `getMe xətası (${me.error_code || ''}): ${me.description || JSON.stringify(me)}`;
      console.error(`[SignalBot] ${signalBotState.lastError}`);
      return;
    }
  } catch (err) {
    signalBotState.connected = false;
    signalBotState.lastError = `getMe şəbəkə xətası: ${err.message}`;
    console.error(`[SignalBot] ${signalBotState.lastError}`);
  }

  if (mode === 'webhook') {
    console.log('[SignalBot] Webhook rejimi aktivdir: POST /api/telegram/signal-webhook');
    return;
  }

  if (signalPollingActive) return;
  signalPollingActive = true;

  try {
    const delRes = await signalTgApi('deleteWebhook', { drop_pending_updates: false });
    if (!delRes.ok) {
      console.error('[SignalBot] deleteWebhook xətası:', delRes.description || JSON.stringify(delRes));
    }
  } catch (err) {
    console.error('[SignalBot] deleteWebhook istisnası:', err.message);
  }

  let offset = 0;
  let lastLoggedErr = '';
  const poll = async () => {
    while (signalPollingActive) {
      try {
        const res = await signalTgApi('getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        signalBotState.lastPollAt = Date.now();
        if (res.ok && Array.isArray(res.result)) {
          signalBotState.connected = true;
          signalBotState.lastError = null;
          lastLoggedErr = '';
          for (const upd of res.result) {
            offset = upd.update_id + 1;
            try {
              await handleSignalBotUpdate(upd);
            } catch (handlerErr) {
              console.error('[SignalBot] Update emalı xətası:', handlerErr);
            }
          }
        } else if (!res.ok) {
          const code = res.error_code || '';
          const desc = res.description || JSON.stringify(res);
          const msg =
            code === 409
              ? `409 Conflict (başqa bir server/kompüter eyni Siqnal Bot tokeni ilə polling edir): ${desc}`
              : `getUpdates xətası (${code}): ${desc}`;
          signalBotState.lastError = msg;
          if (msg !== lastLoggedErr) {
            console.error(`[SignalBot] ${msg}`);
            lastLoggedErr = msg;
          }
          await new Promise((r) => setTimeout(r, code === 409 ? 5000 : 3000));
        }
      } catch (err) {
        const msg = `getUpdates şəbəkə xətası: ${err.message}`;
        signalBotState.lastError = msg;
        if (msg !== lastLoggedErr) {
          console.error(`[SignalBot] ${msg}`);
          lastLoggedErr = msg;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };

  poll();
}
