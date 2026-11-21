const DAY_MS = 86_400_000;
const GLOBAL_SEED_SALT = 0x51a7c9e3;
const GROWTH_RATE = 0.07;
const WAITING_DURATION_MS = 5500;
const CRASH_COOLDOWN_MS = 3200;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getTimeForMultiplier(multiplier) {
  if (multiplier <= 1.0) return 0;
  return (Math.log(multiplier) / GROWTH_RATE) * 1000;
}

export function getMultiplierAtTime(elapsedMs) {
  if (elapsedMs <= 0) return 1.0;
  const raw = Math.exp(GROWTH_RATE * (elapsedMs / 1000));
  return Math.max(1.0, Math.floor(raw * 100) / 100);
}

export function getDeterministicCrashPoint(roundNumber) {
  const mixedSeed = Math.imul(roundNumber ^ GLOBAL_SEED_SALT, 0x45d9f3b) >>> 0;
  const rand = mulberry32(mixedSeed);
  const r = rand();
  const r2 = rand();

  if (r < 0.035) {
    return Math.floor((1.0 + r2 * 0.05) * 100) / 100;
  }

  const houseEdge = 0.96;
  const raw = houseEdge / (1 - r);
  const clamped = Math.min(150.0, Math.max(1.01, raw));
  return Math.floor(clamped * 100) / 100;
}

function buildRoundWindow(dayIndex, roundNumber, startMs) {
  const crashPoint = getDeterministicCrashPoint(roundNumber);
  const flightMs = Math.max(120, Math.round(getTimeForMultiplier(crashPoint)));
  const flyingStartMs = startMs + WAITING_DURATION_MS;
  const crashMs = flyingStartMs + flightMs;
  const endMs = crashMs + CRASH_COOLDOWN_MS;

  return {
    dayIndex,
    roundNumber,
    crashPoint,
    startMs,
    flyingStartMs,
    crashMs,
    endMs,
  };
}

export function getCurrentAndNextRound(nowMs = Date.now()) {
  const dayIndex = Math.floor(nowMs / DAY_MS);
  const dayStartMs = dayIndex * DAY_MS;
  const baseRound = (dayIndex - 19000) * 10000 + 1;

  let cursor = dayStartMs;
  let roundNumber = baseRound;
  let win = buildRoundWindow(dayIndex, roundNumber, cursor);

  while (win.endMs <= nowMs) {
    cursor = win.endMs;
    roundNumber += 1;
    win = buildRoundWindow(dayIndex, roundNumber, cursor);
  }

  let phase = 'WAITING';
  let liveMultiplier = 1.0;
  if (nowMs < win.flyingStartMs) {
    phase = 'WAITING';
  } else if (nowMs < win.crashMs) {
    phase = 'FLYING';
    liveMultiplier = Math.min(win.crashPoint, getMultiplierAtTime(nowMs - win.flyingStartMs));
  } else {
    phase = 'CRASHED';
    liveMultiplier = win.crashPoint;
  }

  const nextWin = buildRoundWindow(dayIndex, win.roundNumber + 1, win.endMs);
  return { current: win, phase, liveMultiplier, next: nextWin };
}

/**
 * Saytın cari/növbəti raund məntiqi ilə tam sinxron siqnal hesablama.
 */
export function buildSignalForNow(nowMs = Date.now()) {
  const { current, phase, next } = getCurrentAndNextRound(nowMs);

  // Əgər cari raundda hələ ən azı 2.2 saniyə mərc vaxtı varsa cari raundu, əks halda növbəti raundu hədəflə
  const useCurrent = phase === 'WAITING' && current.flyingStartMs - nowMs >= 2200;
  const target = useCurrent ? current : next;
  const startsInSec = Math.max(1, Math.ceil((target.flyingStartMs - nowMs) / 1000));
  const cp = target.crashPoint;

  let recommendedMultiplier = null;
  let riskLabel = '🔴 Yüksək risk (Buraxın)';
  let riskNote = 'Bu raund erkən dayana bilər — mərc etmədən növbəti raundu gözləmək tövsiyə olunur.';

  if (cp >= 1.25 && cp < 2.0) {
    // Təhlükəsiz kiçik hədəf (crashPoint-dən ~12-18% aşağı)
    recommendedMultiplier = Math.max(1.15, Math.floor((cp * 0.84) * 100) / 100);
    riskLabel = '🟡 Orta risk';
    riskNote = 'Auto Cashout istifadə edərək vaxtında çıxış etmək tövsiyə olunur.';
  } else if (cp >= 2.0 && cp < 5.0) {
    recommendedMultiplier = Math.floor((cp * 0.78) * 100) / 100;
    riskLabel = '🟢 Aşağı risk (Təhlükəsiz)';
    riskNote = 'Sabit uçuş proqnozu — tövsiyə olunan əmsalda Auto Cashout aktiv edin.';
  } else if (cp >= 5.0) {
    // Yüksək raundlarda təhlükəsiz və cəlbedici hədəf
    const cappedTarget = Math.min(cp * 0.72, 12.5);
    recommendedMultiplier = Math.floor(cappedTarget * 100) / 100;
    riskLabel = '🟢 Güclü siqnal';
    riskNote = 'Yüksək əmsal potensialı — əsas mərci tövsiyə olunan əmsalda bağlayın.';
  }

  return {
    targetRoundNumber: target.roundNumber,
    isCurrentRound: useCurrent,
    startsInSec,
    takeoffAt: target.flyingStartMs,
    recommendedMultiplier,
    riskLabel,
    riskNote,
    currentRoundNumber: current.roundNumber,
    currentPhase: phase,
  };
}
