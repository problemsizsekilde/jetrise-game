import { Eye, EyeOff, Lock, LogIn, Mail, User, UserPlus, X } from 'lucide-react';
import { useState } from 'react';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'register' | 'login';
  onClose: () => void;
  onRegister: (payload: {
    gmail: string;
    nick: string;
    password: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onLogin: (payload: {
    identifier: string;
    password: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export function AuthModal({
  isOpen,
  initialMode = 'register',
  onClose,
  onRegister,
  onLogin,
}: AuthModalProps) {
  const [mode, setMode] = useState<'register' | 'login'>(initialMode);
  const [gmail, setGmail] = useState('');
  const [nick, setNick] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const switchMode = (next: 'register' | 'login') => {
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'register') {
      const cleanGmail = gmail.trim();
      const cleanNick = nick.trim();

      if (!/^[^\s@]+@gmail\.com$/i.test(cleanGmail)) {
        setError('Zəhmət olmasa düzgün Gmail ünvanı daxil edin (məs: ad@gmail.com).');
        return;
      }
      if (cleanNick.length < 2 || cleanNick.length > 24) {
        setError('Şəxsi nick 2 ilə 24 simvol arasında olmalıdır.');
        return;
      }
      if (password.length < 6) {
        setError('Şifrə minimum 6 simvoldan ibarət olmalıdır.');
        return;
      }

      setLoading(true);
      const res = await onRegister({ gmail: cleanGmail, nick: cleanNick, password });
      setLoading(false);

      if (!res.ok) {
        setError(res.error || 'Qeydiyyat zamanı xəta baş verdi.');
        return;
      }
      onClose();
    } else {
      if (!identifier.trim() || !password) {
        setError('Gmail/Nick və şifrə daxil edin.');
        return;
      }
      setLoading(true);
      const res = await onLogin({ identifier: identifier.trim(), password });
      setLoading(false);

      if (!res.ok) {
        setError(res.error || 'Giriş məlumatları yanlışdır.');
        return;
      }
      onClose();
    }
  };

  return (
    <div className="lj-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lj-modal lj-auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lj-modal-head">
          <div>
            <h2>{mode === 'register' ? 'Hesab Yaradın' : 'Hesaba Giriş'}</h2>
            <p className="lj-modal-balance">
              {mode === 'register'
                ? 'Gmail, unikal nick və şifrə ilə dərhal qoşulun'
                : 'Mövcud Gmail və ya nick ilə daxil olun'}
            </p>
          </div>
          <button type="button" className="lj-icon-btn" onClick={onClose} aria-label="Bağla">
            <X size={18} />
          </button>
        </div>

        <div className="lj-modal-tabs">
          <button
            type="button"
            className={`lj-modal-tab ${mode === 'register' ? 'is-active' : ''}`}
            onClick={() => switchMode('register')}
          >
            <UserPlus size={16} />
            Qeydiyyat
          </button>
          <button
            type="button"
            className={`lj-modal-tab ${mode === 'login' ? 'is-active' : ''}`}
            onClick={() => switchMode('login')}
          >
            <LogIn size={16} />
            Giriş
          </button>
        </div>

        <form onSubmit={handleSubmit} className="lj-wallet-form">
          {mode === 'register' ? (
            <>
              <label className="lj-field-label" htmlFor="auth-gmail">
                Gmail ünvanı
              </label>
              <div className="lj-input-icon-wrap">
                <Mail size={16} className="lj-input-icon" />
                <input
                  id="auth-gmail"
                  type="email"
                  autoComplete="email"
                  value={gmail}
                  onChange={(e) => {
                    setGmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="istifadeci@gmail.com"
                  className="lj-auth-input"
                  required
                />
              </div>

              <label className="lj-field-label" htmlFor="auth-nick">
                Şəxsi Nick (təkrarlanmayan)
              </label>
              <div className="lj-input-icon-wrap">
                <User size={16} className="lj-input-icon" />
                <input
                  id="auth-nick"
                  type="text"
                  autoComplete="username"
                  value={nick}
                  onChange={(e) => {
                    setNick(e.target.value);
                    setError(null);
                  }}
                  placeholder="Məs: LuckyPlayer"
                  maxLength={24}
                  className="lj-auth-input"
                  required
                />
              </div>
            </>
          ) : (
            <>
              <label className="lj-field-label" htmlFor="auth-identifier">
                Gmail və ya Nick
              </label>
              <div className="lj-input-icon-wrap">
                <User size={16} className="lj-input-icon" />
                <input
                  id="auth-identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    setError(null);
                  }}
                  placeholder="Gmail ünvanı və ya şəxsi nick"
                  className="lj-auth-input"
                  required
                />
              </div>
            </>
          )}

          <label className="lj-field-label" htmlFor="auth-password">
            Şifrə {mode === 'register' && <span className="lj-hint-inline">(min. 6 simvol)</span>}
          </label>
          <div className="lj-input-icon-wrap">
            <Lock size={16} className="lj-input-icon" />
            <input
              id="auth-password"
              type={showPass ? 'text' : 'password'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder="Minimum 6 simvol (istənilən kombinasiya)"
              className="lj-auth-input"
              required
            />
            <button
              type="button"
              className="lj-pass-toggle"
              onClick={() => setShowPass((p) => !p)}
              aria-label={showPass ? 'Şifrəni gizlət' : 'Şifrəni göstər'}
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && <div className="lj-form-feedback is-error">{error}</div>}

          <button type="submit" disabled={loading} className="lj-submit-btn is-withdraw">
            {loading
              ? 'Gözləyin...'
              : mode === 'register'
                ? 'Qeydiyyatdan Keç'
                : 'Hesaba Daxil Ol'}
          </button>
        </form>
      </div>
    </div>
  );
}
