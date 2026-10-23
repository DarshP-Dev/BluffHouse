export interface Account {
  balance: number;
  reservations: Record<string, number>;
  escrows: Record<string, number>;
  settlements: Record<string, number>;
}

function integer(value: number, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error('INVALID_CHIP_AMOUNT');
}

function identifier(id: string): void {
  if (typeof id !== 'string' || !id.length || id.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(id)) {
    throw new Error('INVALID_WAGER_ID');
  }
}

function sum(values: Record<string, number>): number {
  let total = 0;
  for (const value of Object.values(values)) {
    integer(value);
    total += value;
    integer(total);
  }
  return total;
}

export function account(start = 1000): Account {
  integer(start);
  return { balance: start, reservations: {}, escrows: {}, settlements: {} };
}

export function assertAccount(a: Account): void {
  integer(a.balance);
  const records = { reservations: a.reservations, escrows: a.escrows, settlements: a.settlements };
  for (const entries of Object.values(records)) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('INVALID_LEDGER');
  }
  for (const [kind, entries] of Object.entries(records)) {
    for (const [id, amount] of Object.entries(entries)) {
      identifier(id);
      integer(amount, kind === 'settlements' ? 0 : 1);
      const statuses = [a.reservations, a.escrows, a.settlements].filter((record) => Object.hasOwn(record, id));
      if (statuses.length !== 1) throw new Error('WAGER_STATUS_CONFLICT');
    }
  }
  if (sum(a.reservations) > a.balance) throw new Error('INSUFFICIENT_AVAILABLE_CHIPS');
  integer(a.balance + sum(a.escrows));
}

export function reserved(a: Account): number {
  assertAccount(a);
  return sum(a.reservations);
}

export function available(a: Account): number {
  return a.balance - reserved(a);
}

/** Replacing a reservation releases its old amount for the affordability check. */
export function reserve(a: Account, id: string, amount: number): void {
  assertAccount(a);
  identifier(id);
  integer(amount, 1);
  if (Object.hasOwn(a.escrows, id) || Object.hasOwn(a.settlements, id)) throw new Error('WAGER_ALREADY_COMMITTED');
  const previous = Object.hasOwn(a.reservations, id) ? a.reservations[id] : 0;
  if (amount > a.balance - sum(a.reservations) + previous) throw new Error('INSUFFICIENT_AVAILABLE_CHIPS');
  a.reservations[id] = amount;
}

/** Withdrawal can be retried without adding chips to the balance. */
export function release(a: Account, id: string): boolean {
  assertAccount(a);
  identifier(id);
  if (Object.hasOwn(a.escrows, id) || Object.hasOwn(a.settlements, id)) throw new Error('WAGER_ALREADY_COMMITTED');
  if (!Object.hasOwn(a.reservations, id)) return false;
  delete a.reservations[id];
  return true;
}

export function commit(a: Account, id: string): number {
  assertAccount(a);
  identifier(id);
  if (!Object.hasOwn(a.reservations, id)) throw new Error('RESERVATION_NOT_FOUND');
  const amount = a.reservations[id];
  a.balance -= amount;
  delete a.reservations[id];
  a.escrows[id] = amount;
  return amount;
}

/** The returned amount includes any returned principal and is credited once. */
export function settle(a: Account, id: string, returned: number): boolean {
  assertAccount(a);
  identifier(id);
  integer(returned);
  if (Object.hasOwn(a.settlements, id)) return false;
  if (!Object.hasOwn(a.escrows, id)) throw new Error('ESCROW_NOT_FOUND');
  const balance = a.balance + returned;
  integer(balance);
  integer(balance + (sum(a.escrows) - a.escrows[id]));
  a.balance = balance;
  delete a.escrows[id];
  a.settlements[id] = returned;
  return true;
}
