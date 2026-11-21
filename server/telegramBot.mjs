import fs from 'node:fs';
import {
  getAdminStats,
  getPendingRequests,
  grantSignalAccess,
  grantTrialAttempts,
  LIMITS,
  listSignalUsers,
  resolveWalletRequest,
  revokeSignalAccess,
} from './db.mjs';

function getAdminBotConfig() {
  const token = (
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
    adminId,
    mode: (process.env.TELEGRAM_MODE || 'polling').toLowerCase(),
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function adminTgApi(method, payload = {}) {
  const { token } = getAdminBotConfig();
  if (!token) {
    return { ok: false, description: 'TELEGRAM_ADMIN_BOT_TOKEN təyin edilməyib' };
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function adminTgMultipart(method, formData) {
  const { token } = getAdminBotConfig();
  if (!token) {
    return { ok: false, description: 'TELEGRAM_ADMIN_BOT_TOKEN təyin edilməyib' };
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

function formatRequestMessage(request, user, statusLine = null) {
  const isDeposit = request.type === 'DEPOSIT';
  const header = isDeposit
    ? '<b>🟢 YENİ DEPOZİT SORĞUSU</b>'
    : '<b>🟠 YENİ ÇIXARIŞ SORĞUSU</b>';

  const nick = user.nick || user.username || request.username;
  const gmail = user.gmail || request.gmail;

  const lines = [
    header,
    '',
    `<b>Sorğu ID:</b> <code>${escapeHtml(request.id)}</code>`,
    `<b>Nick:</b> ${escapeHtml(nick)}`,
  ];

  if (gmail) {
    lines.push(`<b>Gmail:</b> <code>${escapeHtml(gmail)}</code>`);
  }

  lines.push(`<b>İstifadəçi ID:</b> <code>${escapeHtml(user.userId || request.userId)}</code>`);

  if (isDeposit && request.paymentMethodLabel) {
    lines.push(`<b>Ödəniş üsulu:</b> <b>${escapeHtml(request.paymentMethodLabel)}</b>`);
  }

  lines.push(
    `<b>Məbləğ:</b> <b>${request.amount.toFixed(2)} ${LIMITS.CURRENCY}</b>`,
    `<b>Cari Balans:</b> ${Number(user.balance ?? 0).toFixed(2)} ${LIMITS.CURRENCY}`
  );

  if (request.paymentDetails) {
    lines.push(`<b>Ödəniş/Qeyd:</b> ${escapeHtml(request.paymentDetails)}`);
  }

  if (request.receiptFileName) {
    lines.push(`<b>Qəbz faylı:</b> <code>${escapeHtml(request.receiptFileName)}</code>`);
  }

  lines.push(`<b>Vaxt:</b> ${new Date(request.createdAt).toLocaleString('az-AZ')}`);

  if (statusLine) {
    lines.push('', statusLine);
  } else {
    lines.push('', '⏳ <i>Status: Gözləmədə</i>');
  }

  return lines.join('\n');
}

function buildRequestKeyboard(requestId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Təsdiq Et', callback_data: `approve:${requestId}` },
        { text: '❌ Ləğv Et', callback_data: `reject:${requestId}` },
      ],
    ],
  };
}

export async function notifyAdminNewRequest(request, user) {
  const { token, adminId } = getAdminBotConfig();
  if (!token || !adminId) {
    const missing = [!token && 'TELEGRAM_ADMIN_BOT_TOKEN', !adminId && 'TELEGRAM_ADMIN_ID']
      .filter(Boolean)
      .join(', ');
    const reason = `Render mühit dəyişənləri çatışmır: ${missing}`;
    console.error(`[AdminBot] ${reason}`);
    return { ok: false, skipped: true, error: reason };
  }

  const caption = formatRequestMessage(request, user);
  const replyMarkup = buildRequestKeyboard(request.id);
  let lastError = null;

  try {
    // Send photo or document if receipt file exists on disk
    if (request.receiptPath && fs.existsSync(request.receiptPath)) {
      const fileBuf = fs.readFileSync(request.receiptPath);
      const mime = request.receiptMimeType || 'application/octet-stream';
      const isImage = mime.startsWith('image/');
      const blob = new Blob([fileBuf], { type: mime });
      const fileName = request.receiptFileName || `${request.id}.jpg`;

      if (isImage) {
        const form = new FormData();
        form.append('chat_id', adminId);
        form.append('caption', caption);
        form.append('parse_mode', 'HTML');
        form.append('reply_markup', JSON.stringify(replyMarkup));
        form.append('photo', blob, fileName);

        const res = await adminTgMultipart('sendPhoto', form);
        if (res.ok) {
          console.log(`[AdminBot] Depozit/qəbz (photo) göndərildi: ${request.id}`);
          return res;
        }
        lastError = `sendPhoto: ${res.description || JSON.stringify(res)}`;
        console.error('[AdminBot] sendPhoto xətası:', lastError);
      }

      const docForm = new FormData();
      docForm.append('chat_id', adminId);
      docForm.append('caption', caption);
      docForm.append('parse_mode', 'HTML');
      docForm.append('reply_markup', JSON.stringify(replyMarkup));
      docForm.append('document', blob, fileName);

      const docRes = await adminTgMultipart('sendDocument', docForm);
      if (docRes.ok) {
        console.log(`[AdminBot] Depozit/qəbz (document) göndərildi: ${request.id}`);
        return docRes;
      }
      lastError = `sendDocument: ${docRes.description || JSON.stringify(docRes)}`;
      console.error('[AdminBot] sendDocument xətası:', lastError);
    }

    const res = await adminTgApi('sendMessage', {
      chat_id: adminId,
      text: caption,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
    if (!res.ok) {
      const errMsg = res.description || JSON.stringify(res);
      console.error('[AdminBot] sendMessage xətası:', errMsg, '| chat_id:', adminId);
      return { ok: false, error: errMsg };
    }
    console.log(`[AdminBot] Bildiriş (text) göndərildi: ${request.id}`);
    return res;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[AdminBot] Telegram API şəbəkə/istisna xətası:', errMsg, '| prev:', lastError);
    return { ok: false, error: errMsg || lastError || 'Unknown Telegram error' };
  }
}

export async function handleTelegramUpdate(update) {
  const { adminId } = getAdminBotConfig();

  // 1. Handle Inline Keyboard Callback (Deposit / Withdraw Approve / Reject)
  if (update.callback_query) {
    const cq = update.callback_query;
    const fromId = String(cq.from?.id || '');
    if (adminId && fromId !== adminId) {
      await adminTgApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '⛔ Bu əməliyyat yalnız admin üçündür.',
        show_alert: true,
      });
      return;
    }

    const data = String(cq.data || '');
    const [action, requestId] = data.split(':');
    if ((action === 'approve' || action === 'reject') && requestId) {
      const decision = action === 'approve' ? 'APPROVED' : 'REJECTED';
      const result = resolveWalletRequest(requestId, decision, `tg:${fromId}`);

      if (!result.ok) {
        await adminTgApi('answerCallbackQuery', {
          callback_query_id: cq.id,
          text: `⚠️ ${result.error}`,
          show_alert: true,
        });
        return;
      }

      const statusText =
        decision === 'APPROVED'
          ? `✅ <b>TƏSDİQ EDİLDİ</b>\n💰 <b>Yeni Balans:</b> ${result.user.balance.toFixed(2)} ${LIMITS.CURRENCY}`
          : '❌ <b>LƏĞV EDİLDİ</b>';

      await adminTgApi('answerCallbackQuery', {
        callback_query_id: cq.id,
        text:
          decision === 'APPROVED'
            ? `✅ ${requestId} təsdiq edildi! Yeni balans: ${result.user.balance.toFixed(2)} ${LIMITS.CURRENCY}`
            : `❌ ${requestId} ləğv edildi.`,
      });

      if (cq.message) {
        const updatedText = formatRequestMessage(result.request, result.user, statusText);
        const hasMedia = Boolean(cq.message.photo || cq.message.document);
        if (hasMedia) {
          await adminTgApi('editMessageCaption', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            caption: updatedText,
            parse_mode: 'HTML',
          });
        } else {
          await adminTgApi('editMessageText', {
            chat_id: cq.message.chat.id,
            message_id: cq.message.message_id,
            text: updatedText,
            parse_mode: 'HTML',
          });
        }
      }
    }
    return;
  }

  // 2. Handle Admin Text Commands
  if (update.message && update.message.text) {
    const msg = update.message;
    const fromId = String(msg.from?.id || '');
    if (adminId && fromId !== adminId) {
      await adminTgApi('sendMessage', {
        chat_id: msg.chat.id,
        text: '⛔ Bu bot yalnız admin idarəetməsi üçündür.',
      });
      return;
    }

    const rawText = msg.text.trim();
    const parts = rawText.split(/\s+/);
    const cmd = parts[0].toLowerCase().split('@')[0];
    const arg = parts[1] || '';
    const arg2 = parts[2] || '';

    if (cmd === '/start' || cmd === '/help') {
      await adminTgApi('sendMessage', {
        chat_id: msg.chat.id,
        parse_mode: 'HTML',
        text: [
          '<b>🛡️ Lucky Jet Admin Bot Aktivdir</b>',
          '',
          '<b>Kassa idarəetməsi:</b>',
          '/pending — Gözləyən depozit/çıxarış sorğuları',
          '/stats — Ümumi statistika',
          '',
          '<b>Siqnal Botu icazə idarəetməsi:</b>',
          '<code>/test &lt;telegram_id&gt; [say]</code> — Sınaq siqnal cəhdi ver (məs: <code>/test 123456789 10</code>, say yazılmazsa 1)',
          '<code>/ver &lt;telegram_id&gt;</code> — Tam / limitsiz siqnal girişi ver',
          '<code>/al &lt;telegram_id&gt;</code> — Həm sınaq cəhdlərini, həm tam girişi ləğv et',
          '/istifadeciler — Aktiv icazəli istifadəçilərin siyahısı',
        ].join('\n'),
      });
      return;
    }

    if (cmd === '/test' || cmd === '/1defelik') {
      if (!arg) {
        await adminTgApi('sendMessage', {
          chat_id: msg.chat.id,
          parse_mode: 'HTML',
          text: '⚠️ İstifadə qaydası: <code>/test 123456789 10</code> (say yazılmazsa default 1 cəhd verilir)',
        });
        return;
      }
      const count = arg2 ? Number(arg2) : 1;
      const res = grantTrialAttempts(arg, count, `admin:${fromId}`);
      if (!res.ok) {
        await adminTgApi('sendMessage', {
          chat_id: msg.chat.id,
          text: `❌ ${res.error}`,
        });
        return;
      }
      await adminTgApi('sendMessage', {
        chat_id: msg.chat.id,
        parse_mode: 'HTML',
        text: `🎟️ <code>${escapeHtml(arg)}</code> ID-li istifadəçiyə <b>${res.entry.trial_attempts} ədəd sınaq siqnal cəhdi</b> (<code>trial_attempts = ${res.entry.trial_attempts}</code>) verildi!`,
      });
      return;
    }

    if (cmd === '/ver') {
      if (!arg) {
        await adminTgApi('sendMessage', {
          chat_id: msg.chat.id,
          parse_mode: 'HTML',
          text: '⚠️ İstifadə qaydası: <code>/ver 123456789</code>',
        });
        return;
      }
      const res = grantSignalAccess(arg, `admin:${fromId}`);
      if (!res.ok) {
        await adminTgApi('sendMessage', {
          chat_id: msg.chat.id,
          text: `❌ ${res.error}`,
        });
        return;
      }
      await adminTgApi('sendMessage', {
        chat_id: msg.chat.id,
        parse_mode: 'HTML',
        text: res.alreadyExists
          ? `✅ <code>${escapeHtml(arg)}</code> artıq tam giriş siyahısında idi (yeniləndi).`
          : `✅ <code>${escapeHtml(arg)}</code> ID-li istifadəçiyə <b>Tam / Limitsiz Siqnal Botu</b> girişi verildi!`,
      });
      return;
    }

    if (cmd === '/al') {
      if (!arg) {
        await adminTgApi('sendMessage', {
          chat_id: msg.chat.id,
          parse_mode: 'HTML',
          text: '⚠️ İstifadə qaydası: <code>/al 123456789</code>',
        });
        return;
      }
      const res = revokeSignalAccess(arg);
      if (!res.ok) {
        await adminTgApi('sendMessage', {
          chat_id: msg.chat.id,
          text: `⚠️ ${res.error}`,
        });
        return;
      }
      await adminTgApi('sendMessage', {
        chat_id: msg.chat.id,
        parse_mode: 'HTML',
        text: `🚫 <code>${escapeHtml(arg)}</code> ID-li istifadəçinin bütün siqnal icazələri (tam giriş + test krediti) ləğv edildi.`,
      });
      return;
    }

    if (cmd === '/istifadeciler') {
      const users = listSignalUsers();
      if (users.length === 0) {
        await adminTgApi('sendMessage', {
          chat_id: msg.chat.id,
          text: '📋 Hazırda aktiv siqnal icazəsi olan istifadəçi yoxdur.',
        });
        return;
      }
      const rows = users.map((u, idx) => {
        const badge = u.unlimited
          ? '♾️ Tam giriş'
          : `🎟️ Sınaq: ${u.trial_attempts} cəhd`;
        return `${idx + 1}. <code>${escapeHtml(u.telegramId)}</code> — ${badge} (${new Date(
          u.grantedAt
        ).toLocaleDateString('az-AZ')})`;
      });
      await adminTgApi('sendMessage', {
        chat_id: msg.chat.id,
        parse_mode: 'HTML',
        text: [
          `<b>📋 Aktiv Siqnal İstifadəçiləri (${users.length})</b>`,
          '',
          ...rows,
        ].join('\n'),
      });
      return;
    }

    if (cmd === '/pending') {
      const list = getPendingRequests();
      if (list.length === 0) {
        await adminTgApi('sendMessage', {
          chat_id: msg.chat.id,
          text: '✅ Hazırda gözləyən depozit və ya çıxarış sorğusu yoxdur.',
        });
        return;
      }
      for (const req of list.slice(0, 10)) {
        await adminTgApi('sendMessage', {
          chat_id: msg.chat.id,
          parse_mode: 'HTML',
          text: formatRequestMessage(req, {
            userId: req.userId,
            username: req.username,
            nick: req.username,
            gmail: req.gmail,
            balance: 0,
          }),
          reply_markup: buildRequestKeyboard(req.id),
        });
      }
      return;
    }

    if (cmd === '/stats') {
      const s = getAdminStats();
      await adminTgApi('sendMessage', {
        chat_id: msg.chat.id,
        parse_mode: 'HTML',
        text: [
          '<b>📊 Lucky Jet Statistika</b>',
          `👥 Ümumi hesablar: <b>${s.userCount}</b> (Qeydiyyatlı: <b>${s.registeredCount}</b>)`,
          `🔑 İcazəli siqnal istifadəçiləri: <b>${s.signalUsersCount}</b>`,
          `⏳ Gözləyən sorğular: <b>${s.pending}</b>`,
          `✅ Təsdiqlənmiş: <b>${s.approved}</b>`,
          `❌ Ləğv edilmiş: <b>${s.rejected}</b>`,
        ].join('\n'),
      });
    }
  }
}

let pollingActive = false;
const adminBotState = {
  connected: false,
  username: null,
  lastError: null,
  lastPollAt: null,
};

export function getAdminBotStatus() {
  const { token, adminId, mode } = getAdminBotConfig();
  return {
    configured: Boolean(token && adminId),
    hasToken: Boolean(token),
    hasAdminId: Boolean(adminId),
    mode,
    pollingActive,
    connected: adminBotState.connected,
    username: adminBotState.username,
    lastError: adminBotState.lastError,
    lastPollAt: adminBotState.lastPollAt,
  };
}

export async function startTelegramBot() {
  const { token, adminId, mode } = getAdminBotConfig();
  if (!token) {
    adminBotState.lastError = 'TELEGRAM_ADMIN_BOT_TOKEN təyin edilməyib';
    console.error('[AdminBot] XƏTA: TELEGRAM_ADMIN_BOT_TOKEN (və ya TELEGRAM_BOT_TOKEN) tapılmadı — Admin Bot başlamadı.');
    return;
  }
  if (!adminId) {
    adminBotState.lastError = 'TELEGRAM_ADMIN_ID təyin edilməyib';
    console.error('[AdminBot] XƏBƏRDARLIQ: TELEGRAM_ADMIN_ID tapılmadı — depozit bildirişləri göndərilə bilməyəcək.');
  }

  // Verify token via getMe so Render logs immediately show bot username or exact error
  try {
    const me = await adminTgApi('getMe');
    if (me.ok && me.result) {
      adminBotState.connected = true;
      adminBotState.username = `@${me.result.username}`;
      adminBotState.lastError = null;
      console.log(`[AdminBot] Bağlandı: @${me.result.username} (ID: ${me.result.id}) | Admin ID: ${adminId || 'YOXDUR'} | Rejim: ${mode}`);
    } else {
      adminBotState.connected = false;
      adminBotState.lastError = `getMe xətası (${me.error_code || ''}): ${me.description || JSON.stringify(me)}`;
      console.error(`[AdminBot] ${adminBotState.lastError}`);
      return;
    }
  } catch (err) {
    adminBotState.connected = false;
    adminBotState.lastError = `getMe şəbəkə xətası: ${err.message}`;
    console.error(`[AdminBot] ${adminBotState.lastError}`);
  }

  if (mode === 'webhook') {
    console.log('[AdminBot] Webhook rejimi aktivdir: POST /api/telegram/webhook');
    return;
  }

  if (pollingActive) return;
  pollingActive = true;

  try {
    const delRes = await adminTgApi('deleteWebhook', { drop_pending_updates: false });
    if (!delRes.ok) {
      console.error('[AdminBot] deleteWebhook xətası:', delRes.description || JSON.stringify(delRes));
    }
  } catch (err) {
    console.error('[AdminBot] deleteWebhook istisnası:', err.message);
  }

  let offset = 0;
  let lastLoggedErr = '';
  const poll = async () => {
    while (pollingActive) {
      try {
        const res = await adminTgApi('getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message', 'callback_query'],
        });
        adminBotState.lastPollAt = Date.now();
        if (res.ok && Array.isArray(res.result)) {
          adminBotState.connected = true;
          adminBotState.lastError = null;
          lastLoggedErr = '';
          for (const upd of res.result) {
            offset = upd.update_id + 1;
            try {
              await handleTelegramUpdate(upd);
            } catch (handlerErr) {
              console.error('[AdminBot] Update emalı xətası:', handlerErr);
            }
          }
        } else if (!res.ok) {
          const code = res.error_code || '';
          const desc = res.description || JSON.stringify(res);
          const msg =
            code === 409
              ? `409 Conflict (başqa bir server/kompüter eyni Admin Bot tokeni ilə polling edir): ${desc}`
              : `getUpdates xətası (${code}): ${desc}`;
          adminBotState.lastError = msg;
          if (msg !== lastLoggedErr) {
            console.error(`[AdminBot] ${msg}`);
            lastLoggedErr = msg;
          }
          await new Promise((r) => setTimeout(r, code === 409 ? 5000 : 3000));
        }
      } catch (err) {
        const msg = `getUpdates şəbəkə xətası: ${err.message}`;
        adminBotState.lastError = msg;
        if (msg !== lastLoggedErr) {
          console.error(`[AdminBot] ${msg}`);
          lastLoggedErr = msg;
        }
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  };

  poll();
}
