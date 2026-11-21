import { Minus, Plus, ShieldCheck, Zap } from 'lucide-react';
import { VISUAL_ASSETS } from '../config/assets';
import { BET_LIMITS, CURRENCY } from '../config/limits';
import { roundMoney } from '../engine/walletRules';
import type { BetSlotState, RoundSnapshot } from '../types/game';

interface BetPanelProps {
  slot: BetSlotState;
  round: RoundSnapshot;
  balance: number;
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  onAmountChange: (slotId: 1 | 2, amount: number) => void;
  onAutoCashoutChange: (slotId: 1 | 2, enabled: boolean, target?: number) => void;
  onPlaceOrQueue: (slotId: 1 | 2) => void;
  onCancel: (slotId: 1 | 2) => void;
  onCashout: (slotId: 1 | 2) => void;
}

export function BetPanel({
  slot,
  round,
  balance,
  isAuthenticated,
  onRequireAuth,
  onAmountChange,
  onAutoCashoutChange,
  onPlaceOrQueue,
  onCancel,
  onCashout,
}: BetPanelProps) {
  const isLocked = slot.status === 'PLACED' || slot.status === 'QUEUED';
  const canCashout = round.phase === 'FLYING' && slot.status === 'PLACED';
  const canCancel =
    slot.status === 'QUEUED' || (slot.status === 'PLACED' && round.phase === 'WAITING');

  const livePayout = canCashout ? roundMoney(slot.placedAmount * round.multiplier) : 0;

  const stepAmount = (delta: number) => {
    if (isLocked) return;
    const next = Math.max(BET_LIMITS.MIN_BET, roundMoney(slot.amount + delta));
    onAmountChange(slot.slotId, Math.min(BET_LIMITS.MAX_BET, next));
  };

  const scaleAmount = (factor: number) => {
    if (isLocked) return;
    const next = Math.max(BET_LIMITS.MIN_BET, roundMoney(slot.amount * factor));
    onAmountChange(slot.slotId, Math.min(BET_LIMITS.MAX_BET, Math.min(balance || BET_LIMITS.MAX_BET, next)));
  };

  const handleMainAction = () => {
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    if (canCashout) {
      onCashout(slot.slotId);
    } else if (canCancel) {
      onCancel(slot.slotId);
    } else {
      onPlaceOrQueue(slot.slotId);
    }
  };

  let ctaClass = 'is-bet';
  let ctaTitle = 'Mərc Et';
  let ctaSub = `${slot.amount.toFixed(2)} ${CURRENCY}`;

  if (canCashout) {
    ctaClass = 'is-cashout';
    ctaTitle = 'Götür (Cash Out)';
    ctaSub = `+${livePayout.toFixed(2)} ${CURRENCY}`;
  } else if (slot.status === 'PLACED' && round.phase === 'WAITING') {
    ctaClass = 'is-cancel';
    ctaTitle = 'Ləğv Et';
    ctaSub = `${slot.placedAmount.toFixed(2)} ${CURRENCY} aktivdir`;
  } else if (slot.status === 'QUEUED') {
    ctaClass = 'is-queued';
    ctaTitle = 'Növbədən Ləğv Et';
    ctaSub = `Növbəti raund • ${slot.placedAmount.toFixed(2)} ${CURRENCY}`;
  } else if (round.phase !== 'WAITING') {
    ctaClass = 'is-queue-ready';
    ctaTitle = 'Növbəti Raunda Mərc';
    ctaSub = `${slot.amount.toFixed(2)} ${CURRENCY}`;
  }

  return (
    <div
      className={`lj-bet-card status-${slot.status.toLowerCase()}`}
      style={
        VISUAL_ASSETS.cardFramePng
          ? { backgroundImage: `url(${VISUAL_ASSETS.cardFramePng})` }
          : undefined
      }
    >
      {/* Top Row: Panel title + Auto Cashout controls */}
      <div className="lj-bet-top">
        <span className="lj-bet-label">Mərc Paneli #{slot.slotId}</span>

        <div className="lj-auto-row">
          <label className="lj-toggle-label">
            <input
              type="checkbox"
              checked={slot.autoCashoutEnabled}
              onChange={(e) => onAutoCashoutChange(slot.slotId, e.target.checked)}
            />
            <span className="lj-toggle-track" />
            <span className="lj-toggle-text">Auto Cashout</span>
          </label>

          <div className={`lj-auto-input-wrap ${slot.autoCashoutEnabled ? 'is-on' : ''}`}>
            <input
              type="number"
              step="0.1"
              min={BET_LIMITS.MIN_AUTO_CASHOUT}
              max={BET_LIMITS.MAX_AUTO_CASHOUT}
              value={slot.autoCashoutTarget}
              disabled={!slot.autoCashoutEnabled}
              onChange={(e) =>
                onAutoCashoutChange(
                  slot.slotId,
                  slot.autoCashoutEnabled,
                  Number(e.target.value)
                )
              }
              aria-label={`Panel ${slot.slotId} Auto Cashout əmsalı`}
            />
            <span>x</span>
          </div>
        </div>
      </div>

      {/* Main Controls */}
      <div className="lj-bet-body">
        <div className="lj-amount-col">
          <div className={`lj-stepper ${isLocked ? 'is-disabled' : ''}`}>
            <button
              type="button"
              className="lj-step-btn"
              onClick={() => stepAmount(-1)}
              disabled={isLocked}
              aria-label="Məbləği azalt"
            >
              <Minus size={15} />
            </button>

            <div className="lj-amount-input-wrap">
              <input
                type="number"
                step="0.5"
                min={BET_LIMITS.MIN_BET}
                max={BET_LIMITS.MAX_BET}
                disabled={isLocked}
                value={slot.amount}
                onChange={(e) => onAmountChange(slot.slotId, Number(e.target.value))}
                aria-label={`Panel ${slot.slotId} mərc məbləği`}
              />
              <span className="lj-amount-cur">{CURRENCY}</span>
            </div>

            <button
              type="button"
              className="lj-step-btn"
              onClick={() => stepAmount(1)}
              disabled={isLocked}
              aria-label="Məbləği artır"
            >
              <Plus size={15} />
            </button>
          </div>

          <div className="lj-quick-grid">
            {BET_LIMITS.QUICK_AMOUNTS.map((val) => (
              <button
                key={val}
                type="button"
                className="lj-quick-btn"
                disabled={isLocked}
                onClick={() => onAmountChange(slot.slotId, val)}
              >
                {val}
              </button>
            ))}
            <button
              type="button"
              className="lj-quick-btn is-mod"
              disabled={isLocked}
              onClick={() => scaleAmount(0.5)}
              title="Yarıya böl"
            >
              ½
            </button>
            <button
              type="button"
              className="lj-quick-btn is-mod"
              disabled={isLocked}
              onClick={() => scaleAmount(2)}
              title="İkiqat artır"
            >
              2×
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`lj-cta-btn ${ctaClass}`}
          onClick={handleMainAction}
        >
          <span className="lj-cta-title">
            {canCashout && <Zap size={18} className="lj-cta-icon" />}
            {ctaTitle}
          </span>
          <span className="lj-cta-sub">{ctaSub}</span>
        </button>
      </div>

      {/* Feedback bar */}
      {slot.lastFeedback && (
        <div
          className={`lj-slot-feedback ${
            slot.status === 'CASHED_OUT'
              ? 'is-win'
              : slot.status === 'LOST'
                ? 'is-loss'
                : 'is-info'
          }`}
        >
          {slot.status === 'CASHED_OUT' && <ShieldCheck size={15} />}
          <span>{slot.lastFeedback}</span>
        </div>
      )}
    </div>
  );
}
