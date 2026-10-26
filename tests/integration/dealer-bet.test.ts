import { describe, expect, it } from 'vitest';
import { RULES, type Command, type CommandType, type Rank } from '@bluff-house/shared';
import { assertRoom } from '../../apps/server/src/game/engine.js';
import { available } from '../../apps/server/src/game/ledger.js';
import { fixture } from '../fixtures/core.js';
import { fundedFinale, dealShadow, standRemaining, finishFinale } from '../fixtures/shadow.js';

type F = ReturnType<typeof fixture>;
function crowned(ranks: Rank[] = ['10', '10', '6', '7'], bid = 50, rounds = 3) {
  const f = fixture({ mode: 'PARTY', ranks });
  expect(f.send(f.host, 'lobby:rounds', { rounds }).status).toBe('ok'); f.start();
  expect(f.send(f.host, 'house:bid', { amount: bid }).status).toBe('ok'); f.advance(22000); conserved(f); return f;
}
function conserved(f: F) {
  const r = f.room(), p = r.party!;
  expect(r.players.reduce((sum, player) => sum + player.account.balance + Object.values(player.account.escrows).reduce((n, v) => n + v, 0), 0) + p.bank.balance + p.vault + p.bonusReserve).toBe(r.initialChips + p.bank.initial + p.initialBonusReserve);
  assertRoom(r);
}
function rejected(f: F, actor: string, type: CommandType, payload?: Record<string, unknown>, extra?: Partial<Command>) {
  const before = structuredClone(f.room()); expect(f.send(actor, type, payload, extra).status).toBe('rejected'); expect(f.room()).toEqual(before); conserved(f);
}
function finishRound(f: F) {
  for (let n = 0; n < 30 && !['ROUND_RESULT', 'RESULTS'].includes(f.view().phase); n++) {
    const v = f.view();
    if (v.phase === 'PLAYER_TURN') expect(f.send(v.activePlayerId!, 'turn:stand').status).toBe('ok');
    else if (v.phase === 'DEALER_TURN' && v.dealerControls.canStand) expect(f.send(v.dealerControls.ownerId!, 'dealer:stand').status).toBe('ok');
    else { expect(v.deadline).not.toBeNull(); f.advance(Math.max(1, v.deadline! - v.serverTime)); }
    conserved(f);
  }
  expect(['ROUND_RESULT', 'RESULTS']).toContain(f.view().phase);
}

describe('mandatory player-controlled dealer personal betting', () => {
  it('auto-reserves ten, edits both directions, includes only its own reservation in the maximum, and preserves exact odd All-In', () => {
    const f = crowned();
    expect(f.view().party!.bank.dealerBet).toMatchObject({ ownerId: f.host, amount: 10, status: 'RESERVED', minimum: 10, maximum: 700 });
    expect(f.view().players[0]).toMatchObject({ balance: 950, available: 690, reserved: 260 });
    expect(f.send(f.host, 'dealer:bet', { amount: 301 }).status).toBe('ok');
    expect(f.view().party!.bank.dealerBet).toMatchObject({ amount: 301, maximum: 700 }); expect(available(f.room().players[0]!.account)).toBe(399);
    expect(f.send(f.host, 'dealer:bet', { amount: 10 }).status).toBe('ok');
    // A funded odd wager produces real odd spendable wealth for the next All-In.
    expect(f.send(f.actors[1]!, 'bet:submit', { amount: 101 }).status).toBe('ok'); f.deal(); finishRound(f);
    expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({ net: 101, dealerStake: 10, houseEarnings: 55, bankEarnings: 46 });
    f.advance(RULES.resultMs + 20000); expect(f.view().phase).toBe('BETTING');
    expect(f.view().party!.bank.dealerBet.maximum).toBe(755);
    expect(f.send(f.host, 'dealer:bet', { amount: 755 }).status).toBe('ok');
    expect(f.view().party!.bank.dealerBet.amount).toBe(755); expect(available(f.room().players[0]!.account)).toBe(0); conserved(f);
  });

  it.each([0, 1, 9, -1, 10.5, '100', null, NaN, Infinity, Number.MAX_SAFE_INTEGER, 701])('rejects dealer amount %s without changing either reservation or backed capacity', amount => {
    const f = crowned(); rejected(f, f.host, 'dealer:bet', { amount });
  });

  it('rejects a rival, stale round/betting contexts, malicious payloads and bettor withdrawal, with idempotent request retries', () => {
    const f = crowned(); rejected(f, f.actors[1]!, 'dealer:bet', { amount: 100 });
    rejected(f, f.host, 'dealer:bet', { amount: 100 }, { bettingId: 'old-betting' });
    rejected(f, f.host, 'dealer:bet', { amount: 100 }, { roundId: 'old-round' });
    rejected(f, f.host, 'dealer:bet', { amount: 100, ownerId: f.actors[1] });
    rejected(f, f.host, 'bet:withdraw'); rejected(f, f.host, 'bet:submit', { amount: 100 });
    const command = f.command(f.host, 'dealer:bet', { amount: 100 }), ack = f.manager.command(f.host, command);
    expect(ack.status).toBe('ok'); const after = structuredClone(f.room());
    expect(f.manager.command(f.host, command)).toEqual(ack); expect(f.room()).toEqual(after);
    expect(f.manager.command(f.host, { ...command, payload: { amount: 101 } }).code).toBe('REQUEST_CONFLICT'); expect(f.room()).toEqual(after);
  });

  it('commits before dealing the one House hand and pays the approved stake100/net150 example', () => {
    const f = crowned(); expect(f.send(f.host, 'dealer:bet', { amount: 100 }).status).toBe('ok');
    expect(f.send(f.actors[1]!, 'bet:submit', { amount: 150 }).status).toBe('ok');
    const id = f.view().party!.bank.dealerBet.id!; f.deal();
    expect(f.view().party!.bank.dealerBet.status).toBe('COMMITTED'); expect(f.room().players[0]!.account.escrows[id]).toBe(100);
    expect(f.view().players[0]!.hand).toEqual([]); expect(f.view().dealer).toHaveLength(2);
    rejected(f, f.host, 'dealer:bet', { amount: 10 }); finishRound(f);
    expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({ net: 150, dealerStake: 100, dealerReturned: 100, stakeLoss: 0, houseEarnings: 125, dealerProfit: 125, bankEarnings: 25 });
    expect(f.view().players.map(p => p.balance)).toEqual([1075, 850]); expect(f.view().party!.bank.balance).toBe(4025); conserved(f);
  });

  it('returns40 on a60 net loss without touching the bond or Table Bank', () => {
    const f = crowned(['10', '10', '8', '7']);
    f.send(f.host, 'dealer:bet', { amount: 100 }); f.send(f.actors[1]!, 'bet:submit', { amount: 60 }); f.deal(); finishRound(f);
    expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({ net: -60, dealerStake: 100, dealerReturned: 40, stakeLoss: 60, bondLoss: 0, bankLoss: 0, dealerProfit: -60 });
    expect(f.view().players.map(p => p.balance)).toEqual([890, 1060]); expect(f.view().party!.bank).toMatchObject({ balance: 4000, bond: { amount: 250 } }); conserved(f);
  });

  it('returns a mandatory stake once when nobody wagers and no cards are dealt, then starts the next minimum', () => {
    const f = crowned(); const id = f.view().party!.bank.dealerBet.id!; finishRound(f);
    expect(f.view().dealer).toEqual([]); expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({ net: 0, dealerStake: 10, dealerReturned: 10, houseEarnings: 0, dealerProfit: 0 });
    expect(f.room().players[0]!.account.settlements[id]).toBe(10); expect(f.room().players[0]!.account.escrows).toEqual({}); expect(f.view().players[0]!.balance).toBe(950);
    f.advance(RULES.resultMs + 20000); expect(f.view().phase).toBe('BETTING');
    expect(f.view().party!.bank.dealerBet).toMatchObject({ amount: 10, status: 'RESERVED' }); expect(f.view().party!.bank.dealerBet.id).not.toBe(id); conserved(f);
  });

  it('skips without debt after a900 bid leaves all remaining chips bonded', () => {
    const f = crowned(undefined, 900); expect(f.view().players[0]).toMatchObject({ balance: 100, available: 0, reserved: 100 });
    expect(f.view().party!.bank.dealerBet).toMatchObject({ amount: 0, status: 'NONE', maximum: 0 });
    rejected(f, f.host, 'dealer:bet', { amount: 10 }); f.bet(100); f.deal(); finishRound(f);
    expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({ dealerStake: 0, dealerReturned: 0, stakeLoss: 0 }); conserved(f);
  });

  it('automatically funds the minimum when a legal Emergency Fund credit removes the low-balance exception', () => {
    const f = crowned(undefined, 900); const bank = f.view().party!.bank;
    f.room().party!.chaos.inventories[f.host] = [{ id: 'dealer-emergency-credit', kind: 'EMERGENCY_FUND' }];
    expect(f.send(f.host, 'chaos:activate', { cardId: 'dealer-emergency-credit' }).status).toBe('ok');
    expect(f.view().party!.bank.dealerBet).toMatchObject({ amount: 10, status: 'RESERVED', maximum: 100 });
    expect(f.view().party!.bank.available).toBe(bank.available); expect(f.view().players[0]!.available).toBe(90);
    expect(f.view().party!.bonusReserve).toBe(100); conserved(f);
  });

  it('keeps a committed stake and backing through disconnection, then settles once by automation', () => {
    const f = crowned(['10', '5', '8', '5', '7']); f.send(f.host, 'dealer:bet', { amount: 100 }); f.bet(60); f.deal();
    const bet = structuredClone(f.view().party!.bank.dealerBet), capacity = f.view().party!.bank.committed;
    f.manager.presence(f.host, false); expect(f.view().party!.bank.dealerBet).toEqual(bet); expect(f.view().party!.bank.committed).toBe(capacity);
    f.manager.presence(f.host, true); finishRound(f); const settled = structuredClone(f.room()); f.advance(1000); expect(f.room()).toEqual(settled); conserved(f);
  });

  it('finishes all obligations and replay clears old stake identities before new declared match funding', () => {
    const f = crowned(undefined, 50, 1); f.send(f.host, 'dealer:bet', { amount: 100 }); f.bet(150); f.deal(); finishRound(f);
    const previous = f.view().party!.bank.dealerBet.id!; f.advance(RULES.resultMs); expect(f.view().phase).toBe('RESULTS');
    expect(f.room().players.every(p => !Object.keys(p.account.reservations).length && !Object.keys(p.account.escrows).length)).toBe(true); conserved(f);
    const command = f.command(f.host, 'results:return'), ack = f.manager.command(f.host, command); expect(ack.status).toBe('ok');
    f.start(); f.send(f.host, 'house:bid', { amount: 50 }); f.advance(22000);
    expect(f.view().party!.bank.dealerBet).toMatchObject({ amount: 10, status: 'RESERVED' }); expect(f.view().party!.bank.dealerBet.id).not.toBe(previous);
    const after = structuredClone(f.room()); expect(f.manager.command(f.host, command)).toEqual(ack); expect(f.room()).toEqual(after); conserved(f);
  });

  it('funds the same dealer stake during Shadow betting, preserves the hidden one-hand projection, and settles it in the final Bank record', () => {
    const f = fundedFinale({ players: 2, bidder: 0, pot: 50, betting: true, ranks: ['10', '10', '6', '7'] });
    expect(f.view().party!.bank.dealerBet).toMatchObject({ ownerId: f.host, amount: 10, status: 'RESERVED' });
    expect(f.send(f.host, 'dealer:bet', { amount: 100 }).status).toBe('ok'); dealShadow(f, [0, 150]);
    expect(f.view().party!.bank.dealerBet).toMatchObject({ amount: 100, status: 'COMMITTED' });
    const own = f.view().party!.shadow!.dealer, other = f.view(f.actors[1]).party!.shadow!.dealer;
    expect(own.hand.every(Boolean)).toBe(true); expect(other.hand[0]).toEqual(own.hand[0]); expect(other.hand[1]).toBeNull();
    expect(f.view().party!.shadow!.entrants.filter(e => e.role === 'HOUSE')).toHaveLength(1); standRemaining(f);
    expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({ roundId: f.view().party!.shadow!.id, net: 150, dealerStake: 100, dealerReturned: 100, houseEarnings: 125, bankEarnings: 25, dealerProfit: 125 });
    finishFinale(f); expect(f.room().players.every(p => !Object.keys(p.account.escrows).length && !Object.keys(p.account.reservations).length)).toBe(true); conserved(f);
  });

  it('keeps a departing House bound to its predeal stake, settles the actual net, then releases only the settled bond', () => {
    const f = fixture({ mode: 'PARTY', players: 3, ranks: ['10', '10', '10', '6', '6', '7'] }), house = f.actors[2]!;
    f.start(); expect(f.send(house, 'house:bid', { amount: 50 }).status).toBe('ok'); f.advance(22000);
    expect(f.send(house, 'dealer:bet', { amount: 100 }).status).toBe('ok'); f.bet(150);
    const stakeId = f.view().party!.bank.dealerBet.id!;
    expect(f.send(house, 'room:leave').status).toBe('ok');
    expect(f.view().party!.bank.dealerBet).toMatchObject({ ownerId: house, amount: 100, status: 'RESERVED' });
    expect(f.room().players.find(p => p.id === house)!.account.reservations[stakeId]).toBe(100);
    expect(f.view().party!.houseId).toBe(house); f.deal();
    expect(f.room().players.find(p => p.id === house)!.account.escrows[stakeId]).toBe(100); finishRound(f);
    expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({ houseId: house, net: 300, dealerStake: 100, dealerReturned: 100, houseEarnings: 200, bankEarnings: 100 });
    expect(f.room().players.find(p => p.id === house)!.account.settlements[stakeId]).toBe(100);
    f.advance(RULES.resultMs); expect(f.view().party!.houseId).toBeNull(); expect(f.view().party!.bank.bond.ownerId).toBeNull();
    expect(f.view().party!.bank.dealerBet.status).toBe('SETTLED');
    expect(f.room().party!.bank.bondHistory.filter(item => item.kind === 'release' && item.ownerId === house)).toHaveLength(1); conserved(f);
  });

  it('refunds the undealt Shadow stake and bettor reservation once when real low-player recovery ends the match', () => {
    const f = fundedFinale({ players: 2, bidder: 0, pot: 50, betting: true, bettingSeconds: 120 });
    const command = f.command(f.host, 'dealer:bet', { amount: 100 }), ack = f.manager.command(f.host, command); expect(ack.status).toBe('ok');
    expect(f.send(f.actors[1]!, 'bet:submit', { amount: 100 }).status).toBe('ok');
    const stakeId = f.view().party!.bank.dealerBet.id!, initialBank = f.view().party!.bank.balance;
    f.manager.presence(f.actors[1]!, false); expect(f.view().recoveryDeadline).not.toBeNull(); f.advance(60000);
    expect(f.view().phase).toBe('RESULTS'); expect(f.view().party!.shadow).toBeNull();
    expect(f.view().party!.bank.dealerBet).toMatchObject({ id: stakeId, amount: 100, status: 'SETTLED', returned: 100, profit: 0 });
    expect(f.view().party!.bank.balance).toBe(initialBank); expect(f.view().players.map(p => p.balance)).toEqual([975, 1025]);
    expect(f.room().players.every(p => !Object.keys(p.account.escrows).length && !Object.keys(p.account.reservations).length)).toBe(true);
    const after = structuredClone(f.room()); f.advance(10000); expect(f.manager.command(f.host, command)).toEqual(ack); expect(f.room()).toEqual(after); conserved(f);
  });
});
