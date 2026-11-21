import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  FileImage,
  Info,
  Landmark,
  RefreshCw,
  Smartphone,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  CURRENCY,
  DEPOSIT_METHOD_LIST,
  DEPOSIT_METHODS,
  type DepositMethodId,
  WALLET_LIMITS,
} from '../config/limits';
import { formatMoney } from '../engine/walletRules';
import type {
  UserProfile,
  WalletRequest,
  WalletRequestStatus,
  WalletTransaction,
} from '../types/game';

interface WalletModalProps {
  isOpen: boolean;
  initialTab: 'deposit' | 'withdraw';
  user: UserProfile;
  requests: WalletRequest[];
  transactions: WalletTransaction[];
  onClose: () => void;
  onOpenAuth: () => void;
  onSubmitRequest: (params: {
    type: 'DEPOSIT' | 'WITHDRAW';
    amount: number;
    paymentMethod?: DepositMethodId;
    paymentDetails: string;
    receiptDataUrl?: string | null;
    receiptFileName?: string | null;
  }) => Promise<{
    ok: boolean;
    error?: string;
    request?: WalletRequest;
    telegramNotified?: boolean;
  }>;
  onRefresh: () => Promise<void>;
}

const WITHDRAW_PRESETS = [10, 20, 30, 40];

function getStatusMeta(status: WalletRequestStatus) {
  switch (status) {
    case 'APPROVED':
      return { label: 'Təsdiqləndi', cls: 'is-approved', icon: CheckCircle2 };
    case 'REJECTED':
      return { label: 'Ləğv edildi', cls: 'is-rejected', icon: XCircle };
    default:
      return { label: 'Gözləmədə', cls: 'is-pending', icon: Clock };
  }
}

function getMethodIcon(methodId: DepositMethodId) {
  if (methodId === 'TERMINAL') return Landmark;
  if (methodId === 'M10') return Smartphone;
  return CreditCard;
}

export function WalletModal({
  isOpen,
  initialTab,
  user,
  requests,
  transactions,
  onClose,
  onOpenAuth,
  onSubmitRequest,
  onRefresh,
}: WalletModalProps) {
  const [tab, setTab] = useState<'deposit' | 'withdraw'>(initialTab);
  const [methodId, setMethodId] = useState<DepositMethodId>('TERMINAL');
  const [amountStr, setAmountStr] = useState<string>(
    initialTab === 'deposit' ? String(DEPOSIT_METHODS.TERMINAL.minDeposit) : '10'
  );
  const [paymentDetails, setPaymentDetails] = useState<string>('');
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);
  const [receiptIsImage, setReceiptIsImage] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const activeMethod = DEPOSIT_METHODS[methodId];

  const switchTab = (next: 'deposit' | 'withdraw') => {
    setTab(next);
    setFeedback(null);
    if (next === 'deposit') {
      setAmountStr(String(activeMethod.minDeposit));
    } else {
      setAmountStr(String(Math.min(10, Math.floor(user.balance) || 10)));
    }
  };

  const selectMethod = (nextMethod: DepositMethodId) => {
    setMethodId(nextMethod);
    setFeedback(null);
    const minVal = DEPOSIT_METHODS[nextMethod].minDeposit;
    const currentNum = Number(amountStr.replace(',', '.'));
    if (!Number.isFinite(currentNum) || currentNum < minVal) {
      setAmountStr(String(minVal));
    }
  };

  const handleCopyRequisite = async () => {
    const text = activeMethod.requisiteValue;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setFeedback({ kind: 'error', text: 'Qəbz faylı 6 MB-dan böyük ola bilməz.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReceiptDataUrl(reader.result);
        setReceiptFileName(file.name);
        setReceiptIsImage(file.type.startsWith('image/'));
        setFeedback(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const clearReceipt = () => {
    setReceiptDataUrl(null);
    setReceiptFileName(null);
    setReceiptIsImage(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const numeric = Number(amountStr.replace(',', '.'));

    if (tab === 'deposit') {
      if (!Number.isFinite(numeric) || numeric < activeMethod.minDeposit) {
        setFeedback({
          kind: 'error',
          text: `${activeMethod.label} üsulu üçün minimum depozit ${activeMethod.minDeposit} ${CURRENCY}-dir.`,
        });
        return;
      }
      if (!receiptDataUrl) {
        setFeedback({
          kind: 'error',
          text: 'Depozit sorğusunu göndərmək üçün ödəniş qəbzini (şəkil/fayl) əlavə edin.',
        });
        return;
      }
    }

    setSubmitting(true);
    const res = await onSubmitRequest({
      type: tab === 'deposit' ? 'DEPOSIT' : 'WITHDRAW',
      amount: numeric,
      paymentMethod: tab === 'deposit' ? methodId : undefined,
      paymentDetails: paymentDetails.trim(),
      receiptDataUrl: tab === 'deposit' ? receiptDataUrl : null,
      receiptFileName: tab === 'deposit' ? receiptFileName : null,
    });
    setSubmitting(false);

    if (!res.ok) {
      setFeedback({ kind: 'error', text: res.error ?? 'Sorğu göndərilə bilmədi.' });
      return;
    }

    setPaymentDetails('');
    clearReceipt();
    setFeedback({
      kind: 'success',
      text: `${res.request?.id || ''} sorğusu qeydə alındı (Gözləmədə). Admin Telegram üzərindən təsdiq etdikdə balansınız avtomatik yenilənəcək.`,
    });
  };

  const presets = tab === 'deposit' ? activeMethod.quickAmounts : WITHDRAW_PRESETS;

  return (
    <div className="lj-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lj-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lj-modal-head">
          <div>
            <h2>Kassa — Depozit və Çıxarış</h2>
            <p className="lj-modal-balance">
              Balans: <strong>{formatMoney(user.balance)}</strong> •{' '}
              <code className="lj-user-code">{user.nick}</code>
            </p>
          </div>
          <div className="lj-modal-head-actions">
            <button
              type="button"
              className={`lj-icon-btn ${refreshing ? 'is-spinning' : ''}`}
              onClick={handleManualRefresh}
              title="Statusu yenilə"
              aria-label="Statusu yenilə"
            >
              <RefreshCw size={16} />
            </button>
            <button type="button" className="lj-icon-btn" onClick={onClose} aria-label="Bağla">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Account status banner */}
        {!user.isRegistered ? (
          <div className="lj-guest-banner">
            <span>Qonaq hesabı ({user.userId}). Gmail və şəxsi nick ilə qeydiyyatdan keçin.</span>
            <button type="button" className="lj-guest-btn" onClick={onOpenAuth}>
              Qeydiyyat
            </button>
          </div>
        ) : (
          <div className="lj-account-summary">
            <span>
              <strong>{user.nick}</strong> • {user.gmail}
            </span>
            <code className="lj-user-code">{user.userId}</code>
          </div>
        )}

        <div className="lj-modal-tabs">
          <button
            type="button"
            className={`lj-modal-tab ${tab === 'deposit' ? 'is-active' : ''}`}
            onClick={() => switchTab('deposit')}
          >
            <ArrowDownLeft size={16} />
            Depozit
          </button>
          <button
            type="button"
            className={`lj-modal-tab ${tab === 'withdraw' ? 'is-active' : ''}`}
            onClick={() => switchTab('withdraw')}
          >
            <ArrowUpRight size={16} />
            Çıxarış
          </button>
        </div>

        {/* Deposit Payment Methods */}
        {tab === 'deposit' && (
          <>
            <div className="lj-method-grid">
              {DEPOSIT_METHOD_LIST.map((m) => {
                const Icon = getMethodIcon(m.id);
                const selected = methodId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`lj-method-card ${selected ? 'is-selected' : ''}`}
                    onClick={() => selectMethod(m.id)}
                  >
                    <Icon size={18} />
                    <span className="lj-method-name">{m.label}</span>
                    <span className="lj-method-min">Min {m.minDeposit} {CURRENCY}</span>
                  </button>
                );
              })}
            </div>

            {/* Requisite / Kapital Bank Card Box */}
            <div className="lj-requisite-box">
              <div className="lj-requisite-head">
                <span className="lj-requisite-title">
                  Bank: <strong>{activeMethod.requisiteTitle}</strong>
                </span>
                <button
                  type="button"
                  className={`lj-copy-btn ${copied ? 'is-copied' : ''}`}
                  onClick={handleCopyRequisite}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Kopyalandı' : 'Kopyala'}
                </button>
              </div>
              <div className="lj-requisite-value">{activeMethod.requisiteValue}</div>
              {copied && (
                <div className="lj-copy-toast" role="status" aria-live="polite">
                  <CheckCircle2 size={13} />
                  <span>Kart nömrəsi kopyalandı!</span>
                </div>
              )}
              <p className="lj-requisite-note">{activeMethod.requisiteNote}</p>
            </div>
          </>
        )}

        {tab === 'withdraw' && (
          <div className="lj-limit-banner">
            <Info size={16} />
            <span>
              Maksimum birdəfəlik çıxarış limiti: <strong>{WALLET_LIMITS.MAX_WITHDRAW} {CURRENCY}</strong>
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="lj-wallet-form">
          <label className="lj-field-label" htmlFor="wallet-amount-input">
            Məbləğ ({CURRENCY}){' '}
            {tab === 'deposit' && (
              <span className="lj-hint-inline">
                (Min: {activeMethod.minDeposit} {CURRENCY})
              </span>
            )}
          </label>
          <input
            id="wallet-amount-input"
            type="number"
            step="0.5"
            min={tab === 'deposit' ? activeMethod.minDeposit : WALLET_LIMITS.MIN_WITHDRAW}
            max={tab === 'withdraw' ? WALLET_LIMITS.MAX_WITHDRAW : undefined}
            value={amountStr}
            onChange={(e) => {
              setAmountStr(e.target.value);
              setFeedback(null);
            }}
            className="lj-wallet-input"
            placeholder="0.00"
          />

          <div className={`lj-preset-row ${presets.length === 6 ? 'cols-6' : 'cols-4'}`}>
            {presets.map((val) => (
              <button
                key={val}
                type="button"
                className={`lj-preset-btn ${Number(amountStr) === val ? 'is-active' : ''}`}
                onClick={() => {
                  setAmountStr(String(val));
                  setFeedback(null);
                }}
              >
                {val} {CURRENCY}
              </button>
            ))}
          </div>

          {/* Receipt Upload for Deposit */}
          {tab === 'deposit' && (
            <div className="lj-receipt-block">
              <span className="lj-field-label">Ödəniş qəbzi (Şəkil və ya PDF) *</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileChange}
                className="lj-file-hidden"
                id="wallet-receipt-file"
              />

              {!receiptDataUrl ? (
                <label htmlFor="wallet-receipt-file" className="lj-upload-zone">
                  <Upload size={20} />
                  <span>Qəbz şəklini və ya faylını seçin</span>
                  <small>PNG, JPG, WEBP və ya PDF (maks. 6 MB)</small>
                </label>
              ) : (
                <div className="lj-receipt-preview">
                  {receiptIsImage ? (
                    <img
                      src={receiptDataUrl}
                      alt="Ödəniş qəbzi"
                      className="lj-receipt-thumb"
                    />
                  ) : (
                    <div className="lj-receipt-icon-box">
                      <FileImage size={22} />
                    </div>
                  )}
                  <div className="lj-receipt-meta">
                    <span className="lj-receipt-name">{receiptFileName}</span>
                    <span className="lj-receipt-ready">Yüklənməyə hazırdır</span>
                  </div>
                  <button
                    type="button"
                    className="lj-icon-btn"
                    onClick={clearReceipt}
                    title="Qəbzi sil"
                    aria-label="Qəbzi sil"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
          )}

          <label className="lj-field-label" htmlFor="wallet-payment-note">
            {tab === 'deposit'
              ? 'Əlavə qeyd (istəyə bağlı)'
              : 'Çıxarış ediləcək kart nömrəsi / M10 hesabı'}
          </label>
          <input
            id="wallet-payment-note"
            type="text"
            value={paymentDetails}
            onChange={(e) => setPaymentDetails(e.target.value)}
            className="lj-note-input"
            placeholder={
              tab === 'deposit'
                ? 'Məs: Ödəniş saatı və ya göndərən adı'
                : 'Məs: 4169 7388 **** ****'
            }
            maxLength={120}
          />

          {feedback && (
            <div className={`lj-form-feedback is-${feedback.kind}`}>
              {feedback.kind === 'success' && <CheckCircle2 size={16} />}
              <span>{feedback.text}</span>
            </div>
          )}

          <button type="submit" disabled={submitting} className={`lj-submit-btn is-${tab}`}>
            {submitting
              ? 'Göndərilir...'
              : tab === 'deposit'
                ? `Depozit Sorğusu Göndər (${activeMethod.label})`
                : 'Çıxarış Sorğusu Göndər'}
          </button>
        </form>

        {/* Requests Status List */}
        {requests.length > 0 && (
          <div className="lj-tx-section">
            <h3>Sorğularım (Admin Təsdiqi)</h3>
            <div className="lj-tx-list">
              {requests.slice(0, 6).map((req) => {
                const meta = getStatusMeta(req.status);
                const Icon = meta.icon;
                return (
                  <div key={req.id} className="lj-req-row">
                    <div className="lj-tx-info">
                      <span className="lj-tx-note">
                        {req.type === 'DEPOSIT'
                          ? `Depozit (${req.paymentMethodLabel || 'Kart'})`
                          : 'Çıxarış'}{' '}
                        •{' '}
                        <strong>
                          {req.amount.toFixed(2)} {CURRENCY}
                        </strong>{' '}
                        <span className="lj-req-id">({req.id})</span>
                      </span>
                      <span className="lj-tx-time">
                        {new Date(req.createdAt).toLocaleTimeString('az-AZ', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {req.receiptFileName ? ` • 📎 ${req.receiptFileName}` : ''}
                      </span>
                    </div>
                    <span className={`lj-status-pill ${meta.cls}`}>
                      <Icon size={13} />
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Balance Transactions */}
        {transactions.length > 0 && (
          <div className="lj-tx-section">
            <h3>Son balans əməliyyatları</h3>
            <div className="lj-tx-list">
              {transactions.slice(0, 5).map((tx) => (
                <div key={tx.id} className="lj-tx-row">
                  <div className="lj-tx-info">
                    <span className="lj-tx-note">{tx.note}</span>
                    <span className="lj-tx-time">
                      {new Date(tx.timestamp).toLocaleTimeString('az-AZ', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <span className={`lj-tx-amount ${tx.amount >= 0 ? 'is-pos' : 'is-neg'}`}>
                    {tx.amount >= 0 ? '+' : ''}
                    {tx.amount.toFixed(2)} {CURRENCY}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
