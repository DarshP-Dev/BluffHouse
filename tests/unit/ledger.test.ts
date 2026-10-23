import { describe, expect, it } from 'vitest';
import { account, assertAccount, available, commit, release, reserve, reserved, settle, type Account } from '../../apps/server/src/game/ledger.js';

function wealth(...accounts: Account[]): number {
  accounts.forEach(assertAccount);
  return accounts.reduce((total, a) => total + a.balance + Object.values(a.escrows).reduce((sum, value) => sum + value, 0), 0);
}

function unchanged(a: Account, operation: () => unknown, error: string): void {
  const before = structuredClone(a);
  expect(operation).toThrow(error);
  expect(a).toEqual(before);
}

describe('reservations and commitments', () => {
  it('reserves, edits, withdraws and resubmits without a second debit', () => {
    const a = account(300);
    reserve(a, 'blackjack', 100);
    reserve(a, 'bluff', 50);
    expect([a.balance, reserved(a), available(a)]).toEqual([300, 150, 150]);
    reserve(a, 'blackjack', 250);
    expect([a.balance, reserved(a), available(a)]).toEqual([300, 300, 0]);
    expect(wealth(a)).toBe(300);
    unchanged(a, () => reserve(a, 'blackjack', 251), 'INSUFFICIENT_AVAILABLE_CHIPS');
    reserve(a, 'blackjack', 100);
    expect(release(a, 'blackjack')).toBe(true);
    expect(release(a, 'blackjack')).toBe(false);
    expect([a.balance, reserved(a), available(a)]).toEqual([300, 50, 250]);
    reserve(a, 'blackjack', 250);
    const beforeCommitAvailable = available(a);
    expect(commit(a, 'blackjack')).toBe(250);
    expect([a.balance, reserved(a), available(a)]).toEqual([50, 50, beforeCommitAvailable]);
    expect(a.escrows).toEqual({ blackjack: 250 });
    expect(wealth(a)).toBe(300);
    unchanged(a, () => commit(a, 'blackjack'), 'RESERVATION_NOT_FOUND');
    unchanged(a, () => release(a, 'blackjack'), 'WAGER_ALREADY_COMMITTED');
    unchanged(a, () => reserve(a, 'blackjack', 50), 'WAGER_ALREADY_COMMITTED');
  });

  it.each([0, -1, 50.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid reservation %s atomically', (amount) => {
    const a = account();
    reserve(a, 'bet', 100);
    unchanged(a, () => reserve(a, 'bet', amount), 'INVALID_CHIP_AMOUNT');
  });

  it.each(['', '__proto__', 'constructor', 'prototype', 'x'.repeat(257)])('rejects unsafe wager id %s', (id) => {
    const a = account();
    unchanged(a, () => reserve(a, id, 50), 'INVALID_WAGER_ID');
  });
});

describe('settlements and conservation', () => {
  it('conserves a matched challenge pot while Blackjack settlement changes only dealer funding', () => {
    const claimant = account();
    const challenger = account();
    for (const a of [claimant, challenger]) {
      reserve(a, 'round-1:blackjack', 100);
      commit(a, 'round-1:blackjack');
      reserve(a, 'offer-1', 250);
      commit(a, 'offer-1');
    }
    expect(wealth(claimant, challenger)).toBe(2000);
    expect(settle(claimant, 'offer-1', 500)).toBe(true);
    expect(settle(challenger, 'offer-1', 0)).toBe(true);
    expect(wealth(claimant, challenger)).toBe(2000);
    expect([claimant.balance, challenger.balance]).toEqual([1150, 650]);
    expect(claimant.escrows).toEqual({ 'round-1:blackjack': 100 });
    expect(challenger.escrows).toEqual({ 'round-1:blackjack': 100 });
    settle(claimant, 'round-1:blackjack', 250);
    settle(challenger, 'round-1:blackjack', 0);
    const dealerNet = 150 - 100;
    expect(wealth(claimant, challenger)).toBe(2000 + dealerNet);
    expect([claimant.balance, challenger.balance]).toEqual([1400, 650]);
    expect(settle(claimant, 'offer-1', 500)).toBe(false);
    expect(settle(challenger, 'round-1:blackjack', 200)).toBe(false);
    expect(wealth(claimant, challenger)).toBe(2050);
  });

  it('applies loss, push, win and natural across rounds with exact 25-chip balances', () => {
    const a = account();
    let dealerNet = 0;
    for (const [id, stake, returned] of [['loss', 50, 0], ['push', 100, 100], ['win', 250, 500], ['natural', 50, 125]] as const) {
      reserve(a, id, stake);
      expect(wealth(a)).toBe(1000 + dealerNet);
      commit(a, id);
      expect(wealth(a)).toBe(1000 + dealerNet);
      settle(a, id, returned);
      dealerNet += returned - stake;
      expect(wealth(a)).toBe(1000 + dealerNet);
      expect(reserved(a)).toBe(0);
      expect(available(a)).toBe(a.balance);
      expect(a.escrows).toEqual({});
      expect(settle(a, id, returned)).toBe(false);
      expect(wealth(a)).toBe(1000 + dealerNet);
    }
    expect(a.balance).toBe(1275);
    expect(a.settlements).toEqual({ loss: 0, push: 100, win: 500, natural: 125 });
  });

  it('releasing an expired offer draws no chips from the original Blackjack escrow', () => {
    const a = account();
    reserve(a, 'blackjack', 100);
    commit(a, 'blackjack');
    reserve(a, 'offer', 250);
    release(a, 'offer');
    expect([a.balance, available(a)]).toEqual([900, 900]);
    expect(a.escrows).toEqual({ blackjack: 100 });
    expect(wealth(a)).toBe(1000);
  });

  it('rejects absent/uncommitted settlement and invalid returned values without mutation', () => {
    const a = account();
    reserve(a, 'bet', 50);
    unchanged(a, () => settle(a, 'bet', 125), 'ESCROW_NOT_FOUND');
    unchanged(a, () => settle(a, 'missing', 0), 'ESCROW_NOT_FOUND');
    commit(a, 'bet');
    for (const returned of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      unchanged(a, () => settle(a, 'bet', returned), 'INVALID_CHIP_AMOUNT');
    }
    expect(settle(a, 'bet', 0)).toBe(true);
    expect(settle(a, 'bet', 0)).toBe(false);
    unchanged(a, () => reserve(a, 'bet', 50), 'WAGER_ALREADY_COMMITTED');
  });

  it('rejects safe integer overflow before touching balance, escrow or history', () => {
    const a = account(Number.MAX_SAFE_INTEGER);
    reserve(a, 'bet', 50);
    commit(a, 'bet');
    unchanged(a, () => settle(a, 'bet', 100), 'INVALID_CHIP_AMOUNT');
    settle(a, 'bet', 50);
    expect(a.balance).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('account invariants', () => {
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid initial balance %s', (start) => {
    expect(() => account(start)).toThrow('INVALID_CHIP_AMOUNT');
  });

  it('allows zero balance and rejects negative, over-reserved and overlapping states', () => {
    expect(available(account(0))).toBe(0);
    expect(() => assertAccount({ ...account(), balance: -1 })).toThrow('INVALID_CHIP_AMOUNT');
    expect(() => assertAccount({ ...account(50), reservations: { bet: 100 } })).toThrow('INSUFFICIENT_AVAILABLE_CHIPS');
    expect(() => assertAccount({ ...account(), reservations: { bet: 50 }, escrows: { bet: 50 } })).toThrow('WAGER_STATUS_CONFLICT');
    expect(() => assertAccount({ ...account(), escrows: { bet: 50 }, settlements: { bet: 0 } })).toThrow('WAGER_STATUS_CONFLICT');
    expect(() => assertAccount({ ...account(), escrows: { bet: 0 } })).toThrow('INVALID_CHIP_AMOUNT');
  });
});
