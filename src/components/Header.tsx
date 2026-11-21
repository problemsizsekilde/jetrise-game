import {
  ArrowDownLeft,
  ArrowUpRight,
  Columns2,
  LogIn,
  LogOut,
  Square,
  User,
  UserPlus,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { VISUAL_ASSETS } from '../config/assets';
import { CURRENCY, WALLET_LIMITS } from '../config/limits';
import { formatMoney } from '../engine/walletRules';
import type { UserProfile } from '../types/game';

interface HeaderProps {
  user: UserProfile | null;
  soundEnabled: boolean;
  panelCount: 1 | 2;
  onToggleSound: () => void;
  onTogglePanels: () => void;
  onOpenWallet: (tab: 'deposit' | 'withdraw') => void;
  onOpenAuth: (mode: 'register' | 'login') => void;
  onLogout: () => void;
}

export function Header({
  user,
  soundEnabled,
  panelCount,
  onToggleSound,
  onTogglePanels,
  onOpenWallet,
  onOpenAuth,
  onLogout,
}: HeaderProps) {
  return (
    <header className="lj-header">
      <div className="lj-header-left">
        <div className="lj-brand">
          {VISUAL_ASSETS.logoPng ? (
            <img src={VISUAL_ASSETS.logoPng} alt="Lucky Jet" className="lj-brand-img" />
          ) : (
            <div className="lj-brand-badge" aria-hidden="true">
              <svg viewBox="0 0 36 36" fill="none" className="lj-brand-svg">
                <defs>
                  <linearGradient id="ljLogoGrad" x1="0" y1="0" x2="36" y2="36">
                    <stop offset="0%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#38bdf8" />
                  </linearGradient>
                </defs>
                <rect width="36" height="36" rx="10" fill="url(#ljLogoGrad)" />
                <path
                  d="M24.5 9.5C21 10 17 12.2 14.5 15.2L10 16.5L13.2 19.7L11 24L15.3 21.8L18.5 25L19.8 20.5C22.8 18 25 14 25.5 10.5C25.6 9.9 25.1 9.4 24.5 9.5Z"
                  fill="#ffffff"
                />
                <path d="M9 26.5L12.5 23" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </div>
          )}
          <div className="lj-brand-text">
            <span className="lj-brand-title">LUCKY JET</span>
            <span className="lj-brand-sub">CRASH ARENA</span>
          </div>
        </div>

        {/* Limit indicators visible only for authenticated users */}
        {user && (
          <div className="lj-limit-pills" aria-label="Limit qaydaları">
            <span className="lj-limit-pill">
              Min Depozit: <strong>7 / 10 {CURRENCY}</strong>
            </span>
            <span className="lj-limit-pill">
              Maks Çıxarış: <strong>{WALLET_LIMITS.MAX_WITHDRAW} {CURRENCY}</strong>
            </span>
          </div>
        )}
      </div>

      <div className="lj-header-right">
        {user ? (
          <>
            <div className="lj-user-chip" title={user.gmail || user.userId}>
              <User size={14} />
              <span className="lj-user-chip-nick">{user.nick}</span>
              <button
                type="button"
                className="lj-user-logout"
                onClick={onLogout}
                title="Çıxış"
                aria-label="Çıxış"
              >
                <LogOut size={14} />
              </button>
            </div>

            <div className="lj-balance-box">
              <div className="lj-balance-info">
                <span className="lj-balance-label">Balans</span>
                <span className="lj-balance-value">{formatMoney(user.balance)}</span>
              </div>
              <div className="lj-wallet-actions">
                <button
                  type="button"
                  className="lj-wallet-btn is-deposit"
                  onClick={() => onOpenWallet('deposit')}
                  title="Depozit"
                >
                  <ArrowDownLeft size={15} />
                  <span>Depozit</span>
                </button>
                <button
                  type="button"
                  className="lj-wallet-btn is-withdraw"
                  onClick={() => onOpenWallet('withdraw')}
                  title="Çıxarış"
                >
                  <ArrowUpRight size={15} />
                  <span>Çıxarış</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="lj-guest-auth-group">
            <button
              type="button"
              className="lj-login-btn"
              onClick={() => onOpenAuth('login')}
            >
              <LogIn size={15} />
              <span>Giriş</span>
            </button>
            <button
              type="button"
              className="lj-register-btn"
              onClick={() => onOpenAuth('register')}
            >
              <UserPlus size={15} />
              <span>Qeydiyyat</span>
            </button>
          </div>
        )}

        <button
          type="button"
          className="lj-icon-btn"
          onClick={onTogglePanels}
          title={panelCount === 2 ? '1 mərc panelinə keç' : '2 mərc panelinə keç'}
          aria-label="Mərc paneli sayını dəyiş"
        >
          {panelCount === 2 ? <Columns2 size={18} /> : <Square size={18} />}
        </button>

        <button
          type="button"
          className={`lj-icon-btn ${soundEnabled ? 'is-active' : ''}`}
          onClick={onToggleSound}
          title={soundEnabled ? 'Səsi bağla' : 'Səsi aç'}
          aria-label={soundEnabled ? 'Səsi bağla' : 'Səsi aç'}
        >
          {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
      </div>
    </header>
  );
}
