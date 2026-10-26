import { describe, expect, it } from 'vitest';
import { RULES, type ChaosKind, type Rank } from '@bluff-house/shared';
import { assertRoom } from '../../apps/server/src/game/engine.js';
import { available } from '../../apps/server/src/game/ledger.js';
import { validBondReservation } from '../../apps/server/src/game/house-bank.js';
import { fixture, shoe } from '../fixtures/core.js';

type F = ReturnType<typeof fixture>;
function crowned(ranks?: Rank[], bid = 900, players = 4) {
  const f = fixture({ mode: 'PARTY', players, ranks }); f.start();
  expect(f.send(f.host, 'house:bid', { amount: bid }).status).toBe('ok'); f.advance(22000); conserved(f); return f;
}
function conserved(f: F) {
  const r = f.room(), bank = r.party!.bank;
  const players = r.players.reduce((total, p) => total + p.account.balance + Object.values(p.account.escrows).reduce((sum, n) => sum + n, 0), 0);
  expect(players + bank.balance + r.party!.vault + r.party!.bonusReserve).toBe(r.initialChips + bank.initial + r.party!.initialBonusReserve);
  assertRoom(r);
}
function unchanged(f: F, actor: string, type: Parameters<F['send']>[1], payload?: Record<string, unknown>, extra?: Parameters<F['send']>[3]) {
  const before = structuredClone(f.room()); expect(f.send(actor, type, payload, extra).status).toBe('rejected'); expect(f.room()).toEqual(before); conserved(f);
}
function settleRound(f: F, manualStand = true) {
  for (let i = 0; i < 40 && !['ROUND_RESULT', 'RESULTS'].includes(f.view().phase); i++) {
    const v = f.view();
    if (v.phase === 'PLAYER_TURN') expect(f.send(v.activePlayerId!, 'turn:stand').status).toBe('ok');
    else if (v.phase === 'DEALER_TURN' && manualStand && v.dealerControls?.ownerId && v.dealerControls.canStand) expect(f.send(v.dealerControls.ownerId, 'dealer:stand').status).toBe('ok');
    else { expect(v.deadline).not.toBeNull(); f.advance(Math.max(1, v.deadline! - v.serverTime)); }
    conserved(f);
  }
  expect(['ROUND_RESULT', 'RESULTS']).toContain(f.view().phase);
}
function nextRound(f: F) {
  f.advance(RULES.resultMs); if (f.view().phase === 'SOCIAL') f.advance(20000);
  expect(f.view().phase).toBe('BETTING'); conserved(f);
}
function noUnrelatedReservations(f: F) {
  for (const p of f.room().players) {
    expect(Object.keys(p.account.escrows)).toEqual([]);
    expect(Object.keys(p.account.reservations).every(key => validBondReservation(f.room(), p, key))).toBe(true);
  }
}

describe('the auction winner is the funded dealer', () => {
  it('backs the approved 900-bid example and pays three maximum naturals from bond first, then the Bank', () => {
    const f = crowned(['A', 'A', 'A', '10', 'K', 'K', 'K', '7']);
    expect(f.view().party!.bank).toMatchObject({ initial: 8000, balance: 8000, available: 8100, committed: 0, bond: { ownerId: f.host, amount: 100 } });
    expect(f.view().players[0]).toMatchObject({ balance: 100, reserved: 100, available: 0 });
    unchanged(f, f.host, 'bet:submit', { amount: 1 });
    for (const actor of f.actors.slice(1)) expect(f.send(actor, 'bet:submit', { amount: 1000 }).status).toBe('ok');
    expect(f.view().party!.bank).toMatchObject({ committed: 4500, available: 3600 }); conserved(f);
    f.deal(); settleRound(f);
    expect(f.view().players[0]!.hand).toEqual([]);
    expect(f.view().roundPayouts.map(p => [p.stake, p.returned, p.profit])).toEqual([[1000, 2500, 1500], [1000, 2500, 1500], [1000, 2500, 1500]]);
    expect(f.view().players.map(p => p.balance)).toEqual([0, 2500, 2500, 2500]);
    expect(f.view().party!.bank).toMatchObject({ balance: 3600, committed: 0, bond: { ownerId: f.host, amount: 0 } });
    expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({ losingStakes: 0, winningProfits: 4500, net: -4500, bondLoss: 100, bankLoss: 4400, houseEarnings: 0 });
    expect(f.view().party!.vault).toBe(900); noUnrelatedReservations(f); conserved(f);
  });

  it('splits a 3,000-chip dealer win 50/50, restores the bond and exposes only the excess as spendable chips', () => {
    const f = crowned(['10', '10', '10', '10', '6', '6', '6', '7']); f.bet(1000); f.deal(); settleRound(f);
    expect(f.view().players.map(p => p.balance)).toEqual([1600, 0, 0, 0]);
    expect(f.view().players[0]).toMatchObject({ reserved: 250, available: 1350 });
    expect(f.view().party!.bank).toMatchObject({ balance: 9500, bond: { ownerId: f.host, amount: 250 } });
    expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({ net: 3000, recovery: 0, houseEarnings: 1500, bankEarnings: 1500 });
    expect(f.view().party!.transfers.some(t => t.kind === 'commission')).toBe(false); conserved(f);
  });

  it('reserves competing gross liability atomically, exposes the backed maximum, and releases exactly the edited or withdrawn wager', () => {
    const f = crowned(['A', 'A', 'A', '10', 'K', 'K', 'K', '7']); f.bet(1000); f.deal(); settleRound(f); nextRound(f);
    expect(f.view(f.actors[1]).backedMaxBet).toBe(2400);
    unchanged(f, f.actors[1]!, 'bet:submit', { amount: 2500 });
    expect(f.send(f.actors[1]!, 'bet:submit', { amount: 2400 }).status).toBe('ok');
    expect(f.view(f.actors[2]).backedMaxBet).toBe(0); unchanged(f, f.actors[2]!, 'bet:submit', { amount: 10 });
    expect(f.send(f.actors[1]!, 'bet:submit', { amount: 2000 }).status).toBe('ok');
    expect(f.view().party!.bank).toMatchObject({ committed: 3000, available: 600 });
    expect(f.view(f.actors[1]).backedMaxBet).toBe(2400);
    expect(f.send(f.actors[2]!, 'bet:submit', { amount: 400 }).status).toBe('ok');
    expect(f.view().party!.bank.available).toBe(0);
    expect(f.send(f.actors[1]!, 'bet:withdraw').status).toBe('ok');
    expect(f.view().party!.bank).toMatchObject({ committed: 600, available: 3000 });
    expect(f.send(f.actors[1]!, 'bet:submit', { amount: 1000 }).status).toBe('ok'); conserved(f);
  });

  it('exhausts only real finite backing, then closes safely and distributes the funded Vault once instead of refilling', () => {
    const f = crowned(['A', 'A', 'A', '10', 'K', 'K', 'K', '7']); f.bet(1000); f.deal(); settleRound(f); nextRound(f);
    f.manager.e.shoe = () => shoe(['A', '10', 'K', '7']);
    expect(f.send(f.actors[1]!, 'bet:submit', { amount: 2400 }).status).toBe('ok'); f.deal(); settleRound(f);
    expect(f.view().party!.bank).toMatchObject({ balance: 0, committed: 0, available: 0, bond: { amount: 0 } });
    expect(f.view().party!.vault).toBe(900); f.advance(RULES.resultMs);
    expect(f.view().phase).toBe('RESULTS'); expect(f.view().results!.reason).toContain('finite Table Bank');
    expect(f.view().players.map(p => p.balance)).toEqual([225, 6325, 2725, 2725]);
    expect(f.view().party!.bank.balance).toBe(0); expect(f.view().party!.vault).toBe(0); noUnrelatedReservations(f); conserved(f);
    const closed = structuredClone(f.room()); f.advance(10000); expect(f.room()).toEqual(closed);
  });

  it('nets mixed odd-natural profits and losses before distributing and is independent of player storage order', () => {
    const run = (reverse: boolean) => {
      const f = crowned(['A', '10', '10', '10', 'K', '8', '6', '7'], 50);
      [101, 100, 100].forEach((amount, index) => expect(f.send(f.actors[index + 1]!, 'bet:submit', { amount }).status).toBe('ok'));
      f.deal(); if (reverse) f.room().players.reverse(); settleRound(f);
      return { bank: f.view().party!.bank, balances: [...f.room().players].sort((a, b) => a.seat - b.seat).map(p => p.account.balance), payouts: f.view().roundPayouts };
    };
    const first = run(false), second = run(true);
    expect(first.bank.rounds.at(-1)).toMatchObject({ losingStakes: 100, winningProfits: 251, net: -151, bondLoss: 151, bankLoss: 0, houseEarnings: 0 });
    expect(first.balances).toEqual([799, 1151, 1100, 900]); expect(second).toEqual(first);
  });

  it.each(['DOUBLE_DOWN', 'TRIPLE_DOWN'] as const)('rejects %s without consuming its card when another wager holds all remaining Bank backing', kind => {
    const f = crowned(['A', 'A', 'A', '10', 'K', 'K', 'K', '7']); f.bet(1000); f.deal(); settleRound(f); nextRound(f);
    expect(f.send(f.actors[1]!, 'bet:submit', { amount: 100 }).status).toBe('ok');
    expect(f.send(f.actors[2]!, 'bet:submit', { amount: 2300 }).status).toBe('ok');
    const id = `collateral-${kind}`; f.room().party!.chaos.inventories[f.actors[1]!] = [{ id, kind }];
    expect(f.view().party!.bank.available).toBe(0); unchanged(f, f.actors[1]!, 'chaos:activate', { cardId: id });
    expect(f.room().party!.chaos.inventories[f.actors[1]!]).toEqual([{ id, kind }]);
  });

  it('rejects an ordinary Double Down atomically when its extra dealer liability is not backed', () => {
    const f = crowned(['A', 'A', 'A', '10', 'K', 'K', 'K', '7']); f.bet(1000); f.deal(); settleRound(f); nextRound(f);
    f.manager.e.shoe = () => shoe(['5', '6', '10', '5', '6', '7', '2']);
    f.send(f.actors[1]!, 'bet:submit', { amount: 100 }); f.send(f.actors[2]!, 'bet:submit', { amount: 2300 }); f.deal();
    expect(f.view().phase).toBe('PLAYER_TURN'); const cursor = f.room().cursor;
    unchanged(f, f.actors[1]!, 'turn:double'); expect(f.room().cursor).toBe(cursor);
    expect(f.view().players[1]).toMatchObject({ wager: 100, doubled: false, committed: 100 });
  });

  it('requires new Bank collateral for Pot Twist opt-in and never uses Emergency Fund or the Vault as dealer backing', () => {
    const f = crowned(['A', 'A', 'A', '10', 'K', 'K', 'K', '7']); f.bet(1000); f.deal(); settleRound(f); nextRound(f);
    f.send(f.actors[1]!, 'bet:submit', { amount: 100 }); f.send(f.actors[2]!, 'bet:submit', { amount: 2300 });
    const id = 'backed-pot-twist'; f.room().party!.chaos.inventories[f.actors[1]!] = [{ id, kind: 'POT_TWIST' }];
    expect(f.send(f.actors[1]!, 'chaos:activate', { cardId: id }).status).toBe('ok');
    f.advance(RULES.bettingMs); expect(f.view().phase).toBe('POT_TWIST'); unchanged(f, f.actors[1]!, 'chaos:optin');
    expect(f.view().party!.vault).toBe(900); expect(f.view().party!.bonusReserve).toBe(400);
    expect(f.view().players[1]!.wager).toBe(100); expect(f.view().party!.bank.committed).toBe(3600);
  });

  it.each(['HAND_SWAP', 'TABLE_TURN'] as const)('%s moves bettor hands while the House dealer cards and collateral stay fixed', kind => {
    const f = crowned(['5', '6', '7', '10', '5', '6', '7', '7', '2'], 50); f.bet(100);
    const id = `dealer-safe-${kind}`; f.room().party!.chaos.inventories[f.actors[1]!] = [{ id, kind }];
    f.advance(RULES.bettingMs + RULES.dealingMs); expect(f.view().phase).toBe('HAND_CHAOS');
    const dealer = structuredClone(f.room().dealer), liabilities = structuredClone(f.room().party!.bank.liabilities);
    expect(f.send(f.actors[1]!, 'chaos:activate', { cardId: id, ...(kind === 'HAND_SWAP' ? { targetId: f.actors[2] } : {}) }).status).toBe('ok');
    expect(f.room().dealer).toEqual(dealer); expect(f.room().players[0]!.hand).toEqual([]); expect(f.room().party!.bank.liabilities).toEqual(liabilities); conserved(f);
  });

  it('Second Chance redraws only a bettor hit and Emergency Fund credits only its own finite bonus reserve', () => {
    const f = crowned(['5', '6', '7', '10', '5', '6', '7', '7', '2', '3'], 50), actor = f.actors[1]!;
    const emergency = 'bank-independent-emergency'; f.room().party!.chaos.inventories[actor] = [{ id: emergency, kind: 'EMERGENCY_FUND' }];
    const beforeBank = structuredClone(f.view().party!.bank);
    expect(f.send(actor, 'chaos:activate', { cardId: emergency }).status).toBe('ok');
    expect(f.view().players[1]!.balance).toBe(1100); expect(f.view().party!.bonusReserve).toBe(300); expect(f.view().party!.bank).toEqual(beforeBank); conserved(f);
    // A new round supplies a fresh per-round activation allowance.
    f.advance(RULES.bettingMs + RULES.resultMs); f.advance(20000);
    f.bet(100); f.room().party!.chaos.inventories[actor] = [{ id: 'bettor-redraw', kind: 'SECOND_CHANCE' }]; f.deal();
    const dealer = structuredClone(f.room().dealer), capacity = structuredClone(f.room().party!.bank.liabilities);
    expect(f.send(actor, 'turn:hit').status).toBe('ok'); const oldHit = f.room().players[1]!.hand.at(-1)!;
    expect(f.send(actor, 'chaos:activate', { cardId: 'bettor-redraw' }).status).toBe('ok');
    expect(f.room().discarded).toContainEqual(oldHit); expect(f.room().dealer).toEqual(dealer); expect(f.room().party!.bank.liabilities).toEqual(capacity); conserved(f);
  });

  it('projects the dealer hole card only to the House until resolution and rejects wrong-owner, stale and out-of-phase commands', () => {
    const f = crowned(['5', '6', '7', '9', '5', '6', '7', '7', '2', '3'], 50); f.bet(); f.deal();
    const house = f.view(), rival = f.view(f.actors[1]);
    expect(house.dealer.every(Boolean)).toBe(true); expect(rival.dealer[0]).toEqual(house.dealer[0]); expect(rival.dealer[1]).toBeNull();
    expect(house.players[0]!.hand).toEqual([]); expect(rival.dealerValue).toBeNull();
    unchanged(f, f.host, 'dealer:hit');
    for (const actor of f.actors.slice(1)) expect(f.send(actor, 'turn:stand').status).toBe('ok');
    expect(f.view().phase).toBe('DEALER_TURN'); expect(f.view().dealerControls).toMatchObject({ ownerId: f.host, canHit: true, canStand: true, automated: false });
    unchanged(f, f.actors[1]!, 'dealer:hit'); unchanged(f, f.host, 'dealer:hit', undefined, { decisionId: 'stale-dealer-decision' });
    unchanged(f, f.host, 'dealer:hit', { rank: 'A', suit: 'S', total: 21 });
    const old = f.command(f.host, 'dealer:hit'), ack = f.manager.command(f.host, old); expect(ack.status).toBe('ok');
    const after = structuredClone(f.room()); expect(f.manager.command(f.host, old)).toEqual(ack); expect(f.room()).toEqual(after);
    expect(f.view().dealer).toHaveLength(3);
    expect(f.send(f.host, 'dealer:stand').status).toBe('ok'); expect(f.view().phase).toBe('ROUND_RESULT');
    for (const actor of f.actors) expect(f.view(actor).dealer.every(Boolean)).toBe(true);
    noUnrelatedReservations(f); conserved(f);
  });

  it('allows a House stand below 17, while timeout and disconnection follow automatic stand-on-all-17s without resetting time', () => {
    const manual = crowned(['10', '10', '10', '5', '8', '8', '8', '5', '7'], 50); manual.bet(); manual.deal();
    for (const actor of manual.actors.slice(1)) manual.send(actor, 'turn:stand');
    expect(manual.view().dealerValue?.total).toBe(10); expect(manual.send(manual.host, 'dealer:stand').status).toBe('ok');
    expect(manual.view().dealer).toHaveLength(2); conserved(manual);
    for (const disconnect of [false, true]) {
      const f = crowned(['10', '10', '10', '5', '8', '8', '8', '5', '7'], 50); f.bet(); f.deal();
      for (const actor of f.actors.slice(1)) f.send(actor, 'turn:stand');
      const deadline = f.view().deadline, cursor = f.room().cursor;
      if (disconnect) { f.manager.presence(f.host, false); expect(f.room().cursor).toBeGreaterThanOrEqual(cursor); f.manager.presence(f.host, true); }
      else { f.advance(9000); expect(f.view().deadline).toBe(deadline); f.manager.presence(f.host, false); f.manager.presence(f.host, true); expect(f.view().deadline).toBeLessThanOrEqual(deadline!); }
      settleRound(f, false); expect(f.view().dealer.map(c => c!.rank)).toEqual(['5', '5', '7']); conserved(f);
    }
  });

  it('never extends an automated dealer deadline across repeated reconnects or explicit departure', () => {
    const f = crowned(['10', '10', '10', '5', '8', '8', '8', '5', '7'], 50);
    f.bet(); f.deal(); for (const actor of f.actors.slice(1)) expect(f.send(actor, 'turn:stand').status).toBe('ok');
    expect(f.view().phase).toBe('DEALER_TURN');
    f.manager.presence(f.host, false); const automatedDeadline = f.view().deadline!, cursor = f.room().cursor;
    expect(automatedDeadline - f.view().serverTime).toBe(RULES.dealerMs);
    for (let attempt = 0; attempt < 2; attempt++) {
      f.manager.presence(f.host, true); f.advance(100); f.manager.presence(f.host, false);
      expect(f.view().deadline).toBe(automatedDeadline); expect(f.view().dealerControls.automated).toBe(true);
    }
    f.manager.presence(f.host, true); expect(f.send(f.host, 'room:leave').status).toBe('ok');
    const view = () => f.manager.snapshot(f.actors[1]!)!, room = () => f.manager.roomFor(f.actors[1]!)!;
    expect(view().deadline).toBe(automatedDeadline); f.advance(149); expect(room().cursor).toBe(cursor);
    f.advance(1); expect(room().cursor).toBe(cursor + 1); expect(view().dealerValue?.total).toBe(17);
    f.advance(RULES.dealerMs); expect(view().phase).toBe('ROUND_RESULT'); expect(room().party!.bank.liabilities).toEqual({}); assertRoom(room());
  });

  it('retains the same liabilities on temporary absence and automates explicit departure before releasing the bond once', () => {
    const f = crowned(['10', '10', '10', '10', '6', '6', '6', '7'], 50); f.bet(100); f.deal();
    const before = f.view().party!.bank.committed; f.manager.presence(f.host, false);
    expect(f.view(f.actors[1]).party!.bank.committed).toBe(before); f.manager.presence(f.host, true);
    expect(f.send(f.host, 'room:leave').status).toBe('ok');
    // The original dealer ledger remains in this room even after membership is gone.
    const retained = () => f.manager.roomFor(f.actors[1])!;
    for (const actor of f.actors.slice(1)) if (f.manager.snapshot(actor)!.activePlayerId === actor) f.send(actor, 'turn:stand');
    for (let i = 0; i < 30 && retained().phase !== 'ROUND_RESULT'; i++) {
      const v = f.manager.snapshot(f.actors[1])!;
      if (v.phase === 'PLAYER_TURN') f.send(v.activePlayerId!, 'turn:stand'); else f.advance(Math.max(1, v.deadline! - v.serverTime));
    }
    expect(retained().players.find(p => p.id === f.host)!.departed).toBe(true);
    expect(retained().party!.bank.liabilities).toEqual({});
    f.advance(RULES.resultMs);
    expect(retained().party!.houseId).toBeNull(); expect(retained().party!.bank.bond.ownerId).toBeNull();
    expect(retained().party!.bank.bondHistory.filter(item => item.kind === 'release')).toHaveLength(1);
    assertRoom(retained());
  });

  it('backs the no-bid casino dealer from the same Bank, preserves Classic automatic dealing, and never creates passive commission', () => {
    const f = fixture({ mode: 'PARTY', ranks: ['10', '10', '10', '8', '9', '7'] }); f.start(); f.advance(22000); f.bet(); f.deal(); settleRound(f);
    expect(f.view().players.map(p => p.balance)).toEqual([1100, 1100]); expect(f.view().party!.bank.balance).toBe(3800);
    expect(f.view().party!.bank.bond).toEqual({ ownerId: null, amount: 0 }); conserved(f);
    const classic = fixture({ ranks: ['10', '10', '10', '8', '9', '7'] }); classic.start(); classic.bet(); classic.deal();
    for (let i = 0; i < 20 && classic.view().phase !== 'ROUND_RESULT'; i++) { const v = classic.view(); if (v.phase === 'PLAYER_TURN') classic.send(v.activePlayerId!, 'turn:stand'); else classic.advance(v.deadline! - v.serverTime); }
    expect(classic.view().players.map(p => p.balance)).toEqual([1100, 1100]); expect(classic.view().party).toBeNull();
  });

  it('closes and replays once, releases only the owned bond, and declares fresh Bank funding only for a new match', () => {
    const f = crowned(undefined, 50, 3), firstId = f.view().matchId, initial = f.view().party!.bank.initial;
    for (let i = 0; i < 80 && f.view().phase !== 'RESULTS'; i++) { const v = f.view(); f.advance(Math.max(1, v.deadline! - v.serverTime)); conserved(f); }
    expect(f.view().phase).toBe('RESULTS'); expect(f.view().party!.bank.balance).toBe(initial);
    expect(f.view().party!.bank.bond.ownerId).toBeNull(); noUnrelatedReservations(f);
    const settled = structuredClone(f.room()); f.advance(2000); expect(f.room()).toEqual(settled);
    const command = f.command(f.host, 'results:return'), ack = f.manager.command(f.host, command); expect(ack.status).toBe('ok');
    expect(f.view().phase).toBe('LOBBY'); expect(f.view().party).toBeNull();
    f.start(); expect(f.view().matchId).not.toBe(firstId); expect(f.view().party!.bank).toMatchObject({ initial, balance: initial, rounds: [], committed: 0 });
    const restarted = structuredClone(f.room()); expect(f.manager.command(f.host, command)).toEqual(ack); expect(f.room()).toEqual(restarted); conserved(f);
  });
});
