import { describe, expect, it } from 'vitest';
import { available, commit, credit, reserve, settle } from '../../apps/server/src/game/ledger.js';
import { assertHouseBank, bankAvailable, bankCommitted, beginDealerBet, commitDealerBet, commitLiability, ensureDealerBet, releaseHouseBond, reserveLiability, settleBankRound, submitDealerBet } from '../../apps/server/src/game/house-bank.js';
import { fixture } from '../fixtures/core.js';

function crowned(bid = 50) {
  const f = fixture({ mode: 'PARTY' }); f.start();
  expect(f.send(f.host, 'house:bid', { amount: bid }).status).toBe('ok');
  f.advance(22000); return f;
}

function stakeFor(f: ReturnType<typeof crowned>, amount: number) {
  const r = f.room(); submitDealerBet(r, r.players[0]!, f.command(f.host, 'dealer:bet', { amount }), f.view().serverTime);
}

/** Real bettor escrows supply every synthetic aggregate; the arithmetic never creates funding. */
function fundedNet(f: ReturnType<typeof crowned>, net: number, stake = 100) {
  const r = f.room(), house = r.players[0]!, bettor = r.players[1]!;
  stakeFor(f, stake);
  const bettorStake = Math.max(1, Math.abs(net));
  bettor.wagerId = `${r.roundId}:${bettor.id}:blackjack`; bettor.wager = bettorStake;
  reserve(bettor.account, bettor.wagerId, bettorStake); reserveLiability(r, bettor, bettorStake);
  commitDealerBet(r);
  commit(bettor.account, bettor.wagerId!); commitLiability(r, bettor);
  expect(settle(bettor.account, bettor.wagerId!, bettorStake - net)).toBe(true);
  const initial = r.initialChips + r.party!.bank.initial + r.party!.initialBonusReserve;
  const record = settleBankRound(r, Math.max(0, net), Math.max(0, -net))!;
  expect(r.players.reduce((sum, p) => sum + p.account.balance + Object.values(p.account.escrows).reduce((n, v) => n + v, 0), 0) + r.party!.bank.balance + r.party!.vault + r.party!.bonusReserve).toBe(initial);
  expect(house.account.escrows).toEqual({}); assertHouseBank(r); return record;
}

describe('dealer personal stake: principal, net losses and earned profit', () => {
  it('reserves a mandatory ten without adding it to conservative bettor backing', () => {
    const f = crowned(), r = f.room(), house = r.players[0]!;
    expect(f.view().party!.bank.dealerBet).toMatchObject({ ownerId: f.host, amount: 10, status: 'RESERVED', minimum: 10, maximum: 700 });
    expect(available(house.account)).toBe(690); expect(bankAvailable(r)).toBe(4250); expect(bankCommitted(r)).toBe(0);
    stakeFor(f, 100);
    expect(bankAvailable(r)).toBe(4250); expect(available(house.account)).toBe(600); assertHouseBank(r);
  });

  it.each([[150, 125, 25], [151, 125, 26], [99, 99, 0], [100, 100, 0], [101, 100, 1], [1, 1, 0]])('stake100 with net%s earns House%s and Bank%s without treating principal as profit', (net, earnings, bankEarnings) => {
    const f = crowned(), record = fundedNet(f, net);
    expect(record).toMatchObject({ net, dealerStake: 100, dealerReturned: 100, stakeLoss: 0, houseEarnings: earnings, dealerProfit: earnings, bankEarnings, recovery: 0, bondLoss: 0, bankLoss: 0 });
    expect(f.room().players[0]!.account.balance).toBe(950 + earnings);
    expect(f.room().party!.bank.balance).toBe(4000 + bankEarnings);
  });

  it.each([[60, 40, 60, 0, 0], [100, 0, 100, 0, 0], [200, 0, 100, 100, 0], [350, 0, 100, 250, 0], [400, 0, 100, 250, 50]])('net loss%s returns%s stake and uses stake/bond/Bank in that order', (loss, returned, stakeLoss, bondLoss, bankLoss) => {
    const f = crowned(), record = fundedNet(f, -loss);
    expect(record).toMatchObject({ net: -loss, dealerStake: 100, dealerReturned: returned, stakeLoss, bondLoss, bankLoss, houseEarnings: 0, dealerProfit: -stakeLoss });
    expect(f.room().players[0]!.account.balance).toBe(950 - stakeLoss - bondLoss);
    expect(f.room().party!.bank.balance).toBe(4000 - bankLoss);
  });

  it('returns the full stake on net zero, even with offsetting gross wins and losses', () => {
    const f = crowned(), r = f.room();
    stakeFor(f, 100); commitDealerBet(r);
    const record = settleBankRound(r, 150, 150)!;
    expect(record).toMatchObject({ net: 0, dealerStake: 100, dealerReturned: 100, stakeLoss: 0, houseEarnings: 0, dealerProfit: 0, recovery: 0, bankEarnings: 0 });
    expect(r.players[0]!.account.balance).toBe(950); expect(r.party!.bank.balance).toBe(4000); assertHouseBank(r);
  });

  it('restores a Bank shortfall before the stake-priority profit, then restores the bond from earnings only', () => {
    const f = crowned(), r = f.room(); fundedNet(f, -600);
    expect(r.party!.bank).toMatchObject({ balance: 3750, bond: { amount: 0 } });
    r.roundId = 'dealer-recovery-round'; r.bettingId = 'dealer-recovery-betting'; r.players[1]!.wager = 0; r.players[1]!.wagerId = undefined; beginDealerBet(r);
    const record = fundedNet(f, 300);
    expect(record).toMatchObject({ net: 300, recovery: 250, dealerStake: 100, dealerReturned: 100, houseEarnings: 50, bankEarnings: 0, dealerProfit: 50 });
    expect(r.party!.bank).toMatchObject({ balance: 4000, bond: { amount: 50 } });
    expect(r.players[0]!.account.balance).toBe(650); expect(available(r.players[0]!.account)).toBe(600);
  });

  it('never uses returned stake principal to refill a depleted standing bond', () => {
    const f = crowned(), r = f.room(); fundedNet(f, -350);
    expect(r.party!.bank.bond.amount).toBe(0);
    r.roundId = 'dealer-principal-round'; r.bettingId = 'dealer-principal-betting'; r.players[1]!.wager = 0; r.players[1]!.wagerId = undefined; beginDealerBet(r);
    const record = fundedNet(f, -60);
    expect(record).toMatchObject({ dealerReturned: 40, stakeLoss: 60, houseEarnings: 0, dealerProfit: -60, bondLoss: 0 });
    expect(r.party!.bank.bond.amount).toBe(0); expect(available(r.players[0]!.account)).toBe(540);
  });

  it('rejects a reserved but uncommitted stake before any settlement mutation', () => {
    const f = crowned(), r = f.room(), before = structuredClone(r);
    expect(() => settleBankRound(r, 150, 0)).toThrow(); expect(r).toEqual(before);
  });

  it('settles principal and profit once, rejects conflicting aggregates, and makes storage order irrelevant', () => {
    const f = crowned(), r = f.room();
    stakeFor(f, 100); commitDealerBet(r);
    const before = structuredClone(r), reversed = structuredClone(r); reversed.players.reverse();
    const first = settleBankRound(r, 150, 0)!;
    expect(settleBankRound(reversed, 150, 0)).toEqual(first);
    expect(reversed.party!.bank).toEqual(r.party!.bank);
    expect(reversed.players.find(p => p.id === f.host)!.account).toEqual(r.players[0]!.account);
    const after = structuredClone(r); expect(settleBankRound(r, 150, 0)).toEqual(first); expect(r).toEqual(after);
    expect(() => settleBankRound(r, 151, 0)).toThrow(); expect(r).toEqual(after); expect(r).not.toEqual(before);
  });

  it('does not let a reserved dealer stake be reused by unrelated personal funding', () => {
    const f = crowned(), r = f.room(), owner = r.players[0]!;
    stakeFor(f, 700);
    const before = structuredClone(owner.account); expect(() => reserve(owner.account, 'unrelated-reservation', 1)).toThrow(); expect(owner.account).toEqual(before);
  });

  it('skips nine spendable chips but automatically reserves the minimum at exactly ten without another hold on retry', () => {
    const f = crowned(900), r = f.room(), owner = r.players[0]!, bank = r.party!.bank;
    expect(bank.dealerBet.status).toBe('NONE');
    // Separate ledger-level test funding comes only from the existing finite reserve.
    expect(credit(owner.account, 'finite-nine-chip-credit', 9)).toBe(true); r.party!.bonusReserve -= 9;
    ensureDealerBet(r); expect(bank.dealerBet).toMatchObject({ amount: 0, status: 'NONE' });
    expect(credit(owner.account, 'finite-one-chip-credit', 1)).toBe(true); r.party!.bonusReserve -= 1;
    ensureDealerBet(r); expect(bank.dealerBet).toMatchObject({ amount: 10, status: 'RESERVED' }); expect(available(owner.account)).toBe(0);
    const after = structuredClone(r); ensureDealerBet(r); beginDealerBet(r); expect(r).toEqual(after);
    expect(bankAvailable(r)).toBe(4100); assertHouseBank(r);
  });

  it('rejects an unfunded aggregate loss before returning principal or changing any ledger', () => {
    const f = crowned(), r = f.room(); stakeFor(f, 100); commitDealerBet(r);
    const before = structuredClone(r);
    expect(() => settleBankRound(r, 0, 4351)).toThrow(expect.objectContaining({ code: 'BANK_INSOLVENT' }));
    expect(r).toEqual(before); expect(r.players[0]!.account.escrows[r.party!.bank.dealerBet.id!]).toBe(100); assertHouseBank(r);
  });

  it.each(['RESERVED', 'COMMITTED'] as const)('blocks release of the standing bond while the dealer stake is %s', status => {
    const f = crowned(), r = f.room(); if (status === 'COMMITTED') commitDealerBet(r);
    const before = structuredClone(r); expect(() => releaseHouseBond(r, 'premature-crown-transfer')).toThrow(expect.objectContaining({ code: 'DEALER_BET_UNSETTLED' }));
    expect(r).toEqual(before); expect(r.party!.houseId).toBe(f.host); assertHouseBank(r);
  });
});
