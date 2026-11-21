import {
  consumeSingleSignalCredit,
  getSignalUserAccess,
} from './db.mjs';
import { buildSignalForNow } from './globalTimeline.mjs';

const cooldownMap = new Map(); // telegramId -> lastSignalTimestampMs

function getSignalBotConfig() {
  return {
    token: process.env.TELEGRAM_SIGNAL_BOT_TOKEN || '',
    adminToken: process.env.TELEGRAM_ADMIN_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
    adminContact:
      process.env.TELEGRAM_ADMIN_CONTACT || `Admin (ID: ${process.env.TELEGRAM_ADMIN_ID || ''})`,
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
    '<b>🔒 Siqnal Girişi Aktiv Deyil</b>',
    '',
    `Lucky Jet Siqnal Botundan limitsiz istifadə üçün <b>${accessPriceAzn} AZN</b> tam giriş aktivləşdirilməlidir.`,
    `<i>(Sınaq üçün 1 dəfəlik test siqnalı: ${testPriceAzn} AZN)</i>`,
    '',
    `🆔 <b>Sizin Telegram ID:</b> <code>${escapeHtml(telegramId)}</code>`,
    `📩 <b>Adminlə əlaqə:</b> ${escapeHtml(adminContact)}`,
    '',
    'Ödənişdən sonra Telegram ID-nizi adminə göndərin — giriş aktiv edildiyi an <b>🚀 Siqnal Al</b> düyməsi işləyəcək.',
  ].join('\n');
}

function buildSignalCardMessage(isSingleTest = false) {
  const { accessPriceAzn, adminContact } = getSignalBotConfig();
  const sig = buildSignalForNow(Date.now());
  const takeoffTimeStr = new Date(sig.takeoffAt).toLocaleTimeString('az-AZ', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const roundLabel = sig.isCurrentRound ? 'Cari raund' : 'Növbəti raund';
  const targetLine =
    sig.recommendedMultiplier !== null
      ? `🎯 <b>Tövsiyə olunan əmsal:</b> <b>${sig.recommendedMultiplier.toFixed(2)}x</b>`
      : '🎯 <b>Tövsiyə:</b> <b>Bu raundu buraxın (Mərc etməyin)</b>';

  const lines = [
    isSingleTest
      ? '<b>🎟️ LUCKY JET — 1 DƏFƏLİK TEST SİQNALI</b>'
      : '<b>🚀 LUCKY JET CANLI SİQNAL</b>',
    '',
    `🔢 <b>Raund:</b> #${sig.targetRoundNumber} (${roundLabel})`,
    `⏱️ <b>Uçuş vaxtı:</b> ~${sig.startsInSec} saniyə sonra (${takeoffTimeStr})`,
    targetLine,
    `📊 <b>Risk səviyyəsi:</b> ${sig.riskLabel}`,
    `💡 <b>Qeyd:</b> ${sig.riskNote}`,
  ];

  if (isSingleTest) {
    lines.push(
      '',
      '────────────────────',
      '⚠️ <b>1 dəfəlik test haqqınız istifadə olundu (qalan kredit: 0).</b>',
      `🔒 Davam etmək üçün <b>${accessPriceAzn} AZN</b> tam siqnal girişi lazımdır.`,
      `📩 <b>Adminlə əlaqə:</b> ${escapeHtml(adminContact)}`
    );
  }

  return lines.join('\n');
}

function formatStatusLabel(access) {
  if (access.unlimited) return '✅ Tam giriş (Limitsiz)';
  if (access.single_signal_credits > 0) {
    return `🎟️ 1 dəfəlik test aktivdir (${access.single_signal_credits} kredit)`;
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
      text: buildSignalCardMessage(false),
      reply_markup: SIGNAL_INLINE_KEYBOARD,
    });
    return;
  }

  // 2. 1 dəfəlik test krediti (single_signal_credits > 0)
  if (access.single_signal_credits > 0) {
    // Dərhal qalıcı bazada 0-a endir ki, bot restart olunsa belə təkrar istifadə edilməsin
    const consumed = consumeSingleSignalCredit(cleanId);
    if (!consumed.ok) {
      await signalTgApi('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: buildAccessDeniedMessage(cleanId),
        reply_markup: MAIN_REPLY_KEYBOARD,
      });
      return;
    }

    await signalTgApi('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: buildSignalCardMessage(true),
      reply_markup: MAIN_REPLY_KEYBOARD,
    });
    return;
  }

  // 3. Heç bir aktiv haqqı yoxdur -> 55 AZN giriş məlumatı
  await signalTgApi('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: buildAccessDeniedMessage(cleanId),
    reply_markup: MAIN_REPLY_KEYBOARD,
  });
}

export async function handleSignalBotUpdate(update) {
  // 1. Inline button callbacks
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

  // 2. Text messages & Reply Keyboard buttons
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
      if (access.unlimited || access.single_signal_credits > 0) {
        await signalTgApi('sendMessage', {
          chat_id: chatId,
          parse_mode: 'HTML',
          text: [
            `<b>${formatStatusLabel(access)}</b>`,
            `🆔 Telegram ID: <code>${escapeHtml(fromId)}</code>`,
            access.unlimited
              ? 'İstədiyiniz vaxt <b>🚀 Siqnal Al</b> düyməsi ilə canlı raund siqnalı ala bilərsiniz.'
              : '<b>1 dəfəlik test</b> siqnalınızı almaq üçün <b>🚀 Siqnal Al</b> düyməsinə basın.',
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

export async function startSignalBot() {
  const { token, adminToken, mode } = getSignalBotConfig();
  if (!token) {
    console.warn('[SignalBot] TELEGRAM_SIGNAL_BOT_TOKEN tapılmadı — Siqnal Botu deaktivdir.');
    return;
  }

  if (adminToken && token === adminToken) {
    console.error(
      '[SignalBot] XƏTA: TELEGRAM_SIGNAL_BOT_TOKEN və TELEGRAM_ADMIN_BOT_TOKEN eyni ola bilməz! Siqnal botu dayandırıldı.'
    );
    return;
  }

  console.log(`[SignalBot] Aktivdir (Rejim: ${mode})`);

  if (mode === 'webhook') {
    console.log('[SignalBot] Webhook rejimi: POST /api/telegram/signal-webhook');
    return;
  }

  if (signalPollingActive) return;
  signalPollingActive = true;

  try {
    await signalTgApi('deleteWebhook', { drop_pending_updates: false });
  } catch (err) {
    console.warn('[SignalBot] deleteWebhook xəbərdarlığı:', err.message);
  }

  let offset = 0;
  const poll = async () => {
    while (signalPollingActive) {
      try {
        const res = await signalTgApi('getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        if (res.ok && Array.isArray(res.result)) {
          for (const upd of res.result) {
            offset = upd.update_id + 1;
            await handleSignalBotUpdate(upd);
          }
        } else if (!res.ok) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch {
        await new Promise((r) => setTimeout(r, 3500));
      }
    }
  };

  poll();
}
