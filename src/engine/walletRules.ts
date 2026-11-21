import {
  BET_LIMITS,
  CURRENCY,
  DEPOSIT_METHODS,
  type DepositMethodId,
  WALLET_LIMITS,
} from '../config/limits';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatMoney(value: number): string {
  return `${roundMoney(value).toFixed(2)} ${CURRENCY}`;
}

export function validateDeposit(
  amount: number,
  methodId: DepositMethodId = 'CARD'
): ValidationResult {
  const method = DEPOSIT_METHODS[methodId];
  if (!Number.isFinite(amount) || amount <= 0) {
    return { valid: false, error: 'Düzgün depozit məbləği daxil edin.' };
  }
  if (amount < method.minDeposit) {
    return {
      valid: false,
      error: `${method.label} üsulu üçün minimum depozit məbləği ${method.minDeposit} ${CURRENCY}-dir.`,
    };
  }
  return { valid: true };
}

export function validateWithdraw(amount: number, currentBalance: number): ValidationResult {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { valid: false, error: 'Düzgün çıxarış məbləği daxil edin.' };
  }
  if (amount < WALLET_LIMITS.MIN_WITHDRAW) {
    return {
      valid: false,
      error: `Minimum çıxarış məbləği ${WALLET_LIMITS.MIN_WITHDRAW} ${CURRENCY}-dir.`,
    };
  }
  if (amount > WALLET_LIMITS.MAX_WITHDRAW) {
    return {
      valid: false,
      error: `Maksimum birdəfəlik çıxarış limiti ${WALLET_LIMITS.MAX_WITHDRAW} ${CURRENCY}-dir.`,
    };
  }
  if (amount > currentBalance) {
    return {
      valid: false,
      error: `Balansınızda kifayət qədər vəsait yoxdur (Mövcud: ${formatMoney(currentBalance)}).`,
    };
  }
  return { valid: true };
}

export function validateBet(amount: number, currentBalance: number): ValidationResult {
  if (!Number.isFinite(amount) || amount < BET_LIMITS.MIN_BET) {
    return {
      valid: false,
      error: `Minimum mərc ${BET_LIMITS.MIN_BET.toFixed(2)} ${CURRENCY}-dir.`,
    };
  }
  if (amount > BET_LIMITS.MAX_BET) {
    return {
      valid: false,
      error: `Maksimum mərc ${BET_LIMITS.MAX_BET} ${CURRENCY}-dir.`,
    };
  }
  if (amount > currentBalance) {
    return {
      valid: false,
      error: 'Balans kifayət etmir. Depozit əlavə edin.',
    };
  }
  return { valid: true };
}
