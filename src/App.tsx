import { useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { BetPanel } from './components/BetPanel';
import { FlightStage } from './components/FlightStage';
import { Header } from './components/Header';
import { HistoryBar } from './components/HistoryBar';
import { WalletModal } from './components/WalletModal';
import { CURRENCY, WALLET_LIMITS } from './config/limits';
import { useLuckyJetGame } from './store/useLuckyJetGame';

export default function App() {
  const game = useLuckyJetGame();
  const [panelCount, setPanelCount] = useState<1 | 2>(2);
  const [walletModal, setWalletModal] = useState<{
    open: boolean;
    tab: 'deposit' | 'withdraw';
  }>({ open: false, tab: 'deposit' });
  const [authModal, setAuthModal] = useState<{
    open: boolean;
    mode: 'register' | 'login';
  }>({ open: false, mode: 'login' });

  const visibleSlots = panelCount === 2 ? game.slots : [game.slots[0]];

  return (
    <div className="lj-app">
      <div className="lj-shell">
        <Header
          user={game.user}
          soundEnabled={game.soundEnabled}
          panelCount={panelCount}
          onToggleSound={game.toggleSound}
          onTogglePanels={() => setPanelCount((prev) => (prev === 2 ? 1 : 2))}
          onOpenWallet={(tab) => setWalletModal({ open: true, tab })}
          onOpenAuth={(mode) => setAuthModal({ open: true, mode })}
          onLogout={() => {
            setWalletModal((prev) => ({ ...prev, open: false }));
            game.logoutAccount();
          }}
        />

        {/* Mobile-visible compact limits strip — shown only when logged in */}
        {game.isAuthenticated && (
          <div className="lj-mobile-limits">
            <span>
              Min Depozit: <strong>7 / 10 {CURRENCY}</strong>
            </span>
            <span className="lj-dot-sep">•</span>
            <span>
              Maks Çıxarış: <strong>{WALLET_LIMITS.MAX_WITHDRAW} {CURRENCY}</strong>
            </span>
          </div>
        )}

        <HistoryBar history={game.history} />

        <main className="lj-main">
          <FlightStage round={game.round} />

          <section
            className={`lj-bets-grid ${panelCount === 1 ? 'is-single' : 'is-double'}`}
            aria-label="Mərc panelləri"
          >
            {visibleSlots.map((slot) => (
              <BetPanel
                key={slot.slotId}
                slot={slot}
                round={game.round}
                balance={game.balance}
                isAuthenticated={game.isAuthenticated}
                onRequireAuth={() => setAuthModal({ open: true, mode: 'login' })}
                onAmountChange={game.updateSlotAmount}
                onAutoCashoutChange={game.updateSlotAutoCashout}
                onPlaceOrQueue={game.placeOrQueueBet}
                onCancel={game.cancelBet}
                onCashout={game.manualCashout}
              />
            ))}
          </section>
        </main>
      </div>

      {game.user && (
        <WalletModal
          key={walletModal.open ? `wallet-${walletModal.tab}` : 'wallet-closed'}
          isOpen={walletModal.open}
          initialTab={walletModal.tab}
          user={game.user}
          requests={game.requests}
          transactions={game.transactions}
          onClose={() => setWalletModal((prev) => ({ ...prev, open: false }))}
          onOpenAuth={() => {
            setWalletModal((prev) => ({ ...prev, open: false }));
            setAuthModal({ open: true, mode: 'register' });
          }}
          onSubmitRequest={game.submitWalletRequest}
          onRefresh={game.refreshWallet}
        />
      )}

      <AuthModal
        key={authModal.open ? `auth-${authModal.mode}` : 'auth-closed'}
        isOpen={authModal.open}
        initialMode={authModal.mode}
        onClose={() => setAuthModal((prev) => ({ ...prev, open: false }))}
        onRegister={game.registerAccount}
        onLogin={game.loginAccount}
      />
    </div>
  );
}
