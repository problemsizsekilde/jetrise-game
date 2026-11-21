export const CURRENCY = 'AZN' as const;

export type DepositMethodId = 'TERMINAL' | 'CARD' | 'M10';

export interface DepositMethodConfig {
  id: DepositMethodId;
  label: string;
  minDeposit: number;
  quickAmounts: readonly number[];
  requisiteTitle: string;
  requisiteValue: string;
  requisiteNote: string;
}

export const DEPOSIT_CARD_REQUISITE = {
  bankName: 'Kapital Bank',
  cardNumber: '4169 7388 2980 8082',
} as const;

export const DEPOSIT_METHODS: Record<DepositMethodId, DepositMethodConfig> = {
  TERMINAL: {
    id: 'TERMINAL',
    label: 'Terminal',
    minDeposit: 7,
    quickAmounts: [7, 10, 15, 20, 30, 40],
    requisiteTitle: DEPOSIT_CARD_REQUISITE.bankName,
    requisiteValue: DEPOSIT_CARD_REQUISITE.cardNumber,
    requisiteNote: 'Terminal vasitəsilə bu Kapital Bank kartına ödəniş edib qəbzin şəklini yükləyin.',
  },
  CARD: {
    id: 'CARD',
    label: 'Kartdan karta',
    minDeposit: 10,
    quickAmounts: [10, 15, 20, 30, 40, 50],
    requisiteTitle: DEPOSIT_CARD_REQUISITE.bankName,
    requisiteValue: DEPOSIT_CARD_REQUISITE.cardNumber,
    requisiteNote: 'Kartdan karta köçürmə etdikdən sonra ödəniş qəbzini (skrinşot) əlavə edin.',
  },
  M10: {
    id: 'M10',
    label: 'M10',
    minDeposit: 10,
    quickAmounts: [10, 15, 20, 30, 40, 50],
    requisiteTitle: DEPOSIT_CARD_REQUISITE.bankName,
    requisiteValue: DEPOSIT_CARD_REQUISITE.cardNumber,
    requisiteNote: 'M10 tətbiqindən bu Kapital Bank kartına köçürmə edib qəbz şəklini yükləyin.',
  },
};

export const DEPOSIT_METHOD_LIST: DepositMethodConfig[] = [
  DEPOSIT_METHODS.TERMINAL,
  DEPOSIT_METHODS.CARD,
  DEPOSIT_METHODS.M10,
];

export const WALLET_LIMITS = {
  MIN_DEPOSIT: 7, // Terminal min 7 AZN; Kartdan karta & M10 min 10 AZN
  MIN_DEPOSIT_TERMINAL: 7,
  MIN_DEPOSIT_CARD: 10,
  MIN_DEPOSIT_M10: 10,
  MAX_WITHDRAW: 40,
  MIN_WITHDRAW: 1,
  INITIAL_DEMO_BALANCE: 0,
} as const;

export const BET_LIMITS = {
  MIN_BET: 0.5,
  MAX_BET: 500,
  DEFAULT_BET_SLOT_1: 2,
  DEFAULT_BET_SLOT_2: 5,
  MIN_AUTO_CASHOUT: 1.01,
  MAX_AUTO_CASHOUT: 1000,
  DEFAULT_AUTO_CASHOUT: 2.0,
  QUICK_AMOUNTS: [1, 2, 5, 10, 20] as readonly number[],
} as const;

export const ROUND_TIMING = {
  WAITING_DURATION_MS: 5500,
  CRASH_COOLDOWN_MS: 3200,
  MAX_HISTORY_ITEMS: 40,
} as const;
