import { describe, expect, it } from 'vitest';
import { account, available, commit, reserve } from '../../apps/server/src/game/ledger.js';
import { assertHouseBank, bankAvailable, bankCommitted, beginDealerBet, commitDealerBet, commitLiability, initialBank, maximumBackedBet, releaseHouseBond, releaseLiability, reserveLiability, settleBankRound, takeHouseBond, validBondReservation } from '../../apps/server/src/game/house-bank.js';
import { fixture } from '../fixtures/core.js';

function crowned(bid = 50, players = 2) {
  const f = fixture({ mode: 'PARTY', players }); f.start();
  expect(f.send(f.host, 'house:bid', { amount: bid }).status).toBe('ok');
  f.advance(22000); return f;
}

describe('finite Table Bank and personal bond arithmetic', () => {
  it('declares exactly twice the participant starting capital and keeps a capped personal bond inside player wealth', () => {
    const f = crowned(900, 4), r = f.room(), bank = r.party!.bank, house = r.players[0]!;
    expect(initialBank(r)).toMatchObject({ initial: 8000, balance: 8000, liabilities: {}, rounds: [] });
    expect(bank).toMatchObject({ initial: 8000, balance: 8000, bond: { ownerId: f.host, amount: 100 } });
    expect(house.account.balance).toBe(100); expect(available(house.account)).toBe(0);
    expect(bankAvailable(r)).toBe(8100); expect(bankCommitted(r)).toBe(0);
    expect(validBondReservation(r, house, bank.bond.reservationId!)).toBe(true);
    expect(validBondReservation(r, r.players[1]!, bank.bond.reservationId!)).toBe(false);
    assertHouseBank(r);
  });

  it('spends the round stake then bond before Bank losses, recovers the Bank before profit sharing, and rebuilds the bond', () => {
    const f = crowned(), r = f.room(), bank = r.party!.bank, house = r.players[0]!;
    commitDealerBet(r);
    expect(settleBankRound(r, 0, 500)).toMatchObject({ net: -500, dealerStake: 10, stakeLoss: 10, bondLoss: 250, bankLoss: 240, houseEarnings: 0 });
    expect(bank.balance).toBe(3760); expect(house.account.balance).toBe(690); expect(bank.bond.amount).toBe(0);
    r.roundId = 'bank-recovery-round'; beginDealerBet(r); commitDealerBet(r);
    expect(settleBankRound(r, 300, 0)).toMatchObject({ net: 300, dealerStake: 10, dealerReturned: 10, recovery: 240, houseEarnings: 35, bankEarnings: 25 });
    expect(bank.balance).toBe(4025); expect(bank.bond.amount).toBe(35); expect(house.account.balance).toBe(725); expect(available(house.account)).toBe(690);
    r.roundId = 'bond-restoration-round'; beginDealerBet(r); commitDealerBet(r);
    expect(settleBankRound(r, 451, 0)).toMatchObject({ recovery: 0, houseEarnings: 230, bankEarnings: 221 });
    expect(bank.bond.amount).toBe(250); expect(available(house.account)).toBe(705);
    r.roundId = 'spendable-profit-round'; beginDealerBet(r); commitDealerBet(r);
    expect(settleBankRound(r, 11, 0)).toMatchObject({ houseEarnings: 10, bankEarnings: 1 });
    expect(bank.bond.amount).toBe(250); expect(available(house.account)).toBe(715); assertHouseBank(r);
  });

  it('settles the net once and gives identical results irrespective of gross winner/loser order', () => {
    const f = crowned(), r = f.room(); commitDealerBet(r); const before = structuredClone(r);
    const first = settleBankRound(r, 901, 500)!;
    expect(first).toMatchObject({ net: 401, dealerStake: 10, dealerReturned: 10, houseEarnings: 205, bankEarnings: 196 });
    const settled = structuredClone(r);
    expect(settleBankRound(r, 901, 500)).toEqual(first); expect(r).toEqual(settled);
    const reordered = structuredClone(before); reordered.players.reverse();
    expect(settleBankRound(reordered, 901, 500)).toEqual(first);
    expect(reordered.party!.bank).toEqual(r.party!.bank);
    expect(reordered.players.find(p => p.id === f.host)!.account).toEqual(r.players.find(p => p.id === f.host)!.account);
  });

  it('keeps every no-bid dealer profit/loss in the finite Bank and never invents a bond or owner credit', () => {
    const f = fixture({ mode: 'PARTY' }); f.start(); f.advance(22000); const r = f.room(), before = r.players.map(p => structuredClone(p.account));
    expect(settleBankRound(r, 101, 0)).toMatchObject({ houseId: null, houseEarnings: 0, bankEarnings: 101 });
    expect(r.party!.bank.balance).toBe(4101);
    r.roundId = 'casino-loss-round'; expect(settleBankRound(r, 0, 201)).toMatchObject({ bondLoss: 0, bankLoss: 201 });
    expect(r.party!.bank.balance).toBe(3900); expect(r.players.map(p => p.account)).toEqual(before); assertHouseBank(r);
  });

  it('releases a bond once, permits a penniless new House, and locks its first earnings into the new bond', () => {
    const f = crowned(), r = f.room(), oldHouse = r.players[0]!, incoming = r.players[1]!, bank = r.party!.bank;
    const bankBalance = bank.balance; commitDealerBet(r); settleBankRound(r, 0, 0); releaseHouseBond(r, 'crown-release'); const released = structuredClone(r);
    releaseHouseBond(r, 'crown-release'); expect(r).toEqual(released); expect(available(oldHouse.account)).toBe(950);
    incoming.account = account(0); r.party!.houseId = incoming.id;
    takeHouseBond(r, incoming.id, 'crown-entry'); expect(bank.bond).toMatchObject({ ownerId: incoming.id, amount: 0 });
    expect(bank.balance).toBe(bankBalance);
    r.roundId = 'penniless-house-round'; beginDealerBet(r); commitDealerBet(r);
    expect(settleBankRound(r, 100, 0)).toMatchObject({ dealerStake: 0, houseEarnings: 50, bankEarnings: 50 });
    expect(incoming.account.balance).toBe(50); expect(available(incoming.account)).toBe(0); expect(bank.bond.amount).toBe(50); assertHouseBank(r);
  });

  it.each([[-1, 0], [0, -1], [.5, 0], [0, NaN], [Infinity, 0], [Number.MAX_SAFE_INTEGER + 1, 0]])('rejects invalid net inputs %s / %s before mutation', (losing, winning) => {
    const f = crowned(), r = f.room(), before = structuredClone(r);
    expect(() => settleBankRound(r, losing, winning)).toThrow(); expect(r).toEqual(before);
  });

  it('rejects a replayed bond-entry identity after release without reserving new personal money', () => {
    const f = crowned(), r = f.room(), id = r.party!.bank.bondHistory[0]!.id;
    commitDealerBet(r); settleBankRound(r, 0, 0); releaseHouseBond(r, 'release-original'); const before = structuredClone(r);
    expect(() => takeHouseBond(r, f.host, id)).toThrow(); expect(r).toEqual(before);
  });
});

describe('gross worst-case collateral reservations', () => {
  it('holds odd natural profit exactly, replaces only its own capacity and releases without funding from another player escrow', () => {
    const f = crowned(), r = f.room(), p = r.players[1]!;
    p.wagerId = `${r.roundId}:odd-wager`; p.wager = 11; reserve(p.account, p.wagerId, 11); reserveLiability(r, p, 11);
    expect(bankCommitted(r)).toBe(16); expect(bankAvailable(r)).toBe(4234);
    p.wager = 31; reserve(p.account, p.wagerId, 31); reserveLiability(r, p, 31);
    expect(bankCommitted(r)).toBe(46); expect(maximumBackedBet(r, p)).toBe(1000);
    commit(p.account, p.wagerId); commitLiability(r, p);
    expect(r.party!.bank.liabilities[p.wagerId]).toMatchObject({ amount: 46, committed: true });
    assertHouseBank(r); releaseLiability(r, p); expect(bankCommitted(r)).toBe(0);
  });

  it('rejects an over-capacity reservation atomically and never pledges the Vault, bonus reserve or unrelated personal chips', () => {
    const f = crowned(), r = f.room(), p = r.players[1]!;
    r.party!.bank.balance = 0; r.dealerNet = r.party!.bank.initial;
    p.wagerId = `${r.roundId}:backing-test`; p.wager = 100; reserveLiability(r, p, 100);
    expect(bankAvailable(r)).toBe(100); expect(bankCommitted(r)).toBe(150);
    const before = structuredClone(r);
    expect(() => reserveLiability(r, p, 200)).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_BANK_BACKING' })); expect(r).toEqual(before);
    expect(maximumBackedBet(r, p)).toBe(167);
    expect(() => reserveLiability(r, r.players[0]!, 10)).toThrow(expect.objectContaining({ code: 'HOUSE_CANNOT_BET' })); expect(r).toEqual(before);
  });
});
