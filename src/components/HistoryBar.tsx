import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { useState } from 'react';
import { formatMultiplier } from '../engine/crashMath';
import type { HistoryEntry } from '../types/game';

interface HistoryBarProps {
  history: HistoryEntry[];
}

export function HistoryBar({ history }: HistoryBarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="lj-history-wrap" aria-label="Son raundların əmsal tarixçəsi">
      <div className="lj-history-bar">
        <div className="lj-history-scroll">
          {history.map((item, idx) => (
            <span
              key={item.id}
              className={`lj-history-chip tier-${item.tier} ${idx === 0 ? 'is-newest' : ''}`}
              title={`Raund #${item.roundNumber} — ${formatMultiplier(item.crashPoint)}`}
            >
              {formatMultiplier(item.crashPoint)}
            </span>
          ))}
        </div>

        <button
          type="button"
          className={`lj-history-toggle ${expanded ? 'is-open' : ''}`}
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          title="Bütün son əmsallar"
        >
          <History size={15} />
          <span className="lj-history-toggle-label">Tarixçə</span>
          {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {expanded && (
        <div className="lj-history-drawer">
          <div className="lj-history-drawer-head">
            <span>Son {history.length} raund</span>
            <div className="lj-history-legend">
              <span className="legend-dot tier-low">1.00x–1.99x</span>
              <span className="legend-dot tier-mid">2.00x–9.99x</span>
              <span className="legend-dot tier-high">10.00x+</span>
            </div>
          </div>
          <div className="lj-history-grid">
            {history.map((item) => (
              <div key={item.id} className={`lj-history-chip tier-${item.tier}`}>
                {formatMultiplier(item.crashPoint)}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
