import { describe, expect, it } from 'vitest';
import type { Card, Rank } from '@bluff-house/shared';
import { canOffer, dealerShouldHit, payout } from '../../apps/server/src/game/blackjack.js';

const hand = (...ranks: Rank[]): Card[] => ranks.map((rank, index) => ({ id: `test:${index}`, rank, suit: 'H' }));

describe('Blackjack payouts', () => {
  it.each([10,20,50,100,250,500,1000,1730])('settles all advertised outcomes for a %i-chip wager', (stake) => {
    expect(payout(hand('A', 'K'), hand('10', '8'), stake)).toEqual({ outcome: 'blackjack', returned: stake * 2.5, profit: stake * 1.5 });
    expect(payout(hand('10', '9'), hand('10', '8'), stake)).toEqual({ outcome: 'win', returned: stake * 2, profit: stake });
    expect(payout(hand('10', '8'), hand('10', '8'), stake)).toEqual({ outcome: 'push', returned: stake, profit: 0 });
    expect(payout(hand('10', '7'), hand('10', '8'), stake)).toEqual({ outcome: 'loss', returned: 0, profit: -stake });
  });

  it('retains exact 25-chip natural payouts', () => {
    expect(payout(hand('A', 'Q'), hand('10', '8'), 50).returned).toBe(125);
    expect(payout(hand('A', 'Q'), hand('10', '8'), 250).returned).toBe(625);
  });

  it('pushes both naturals and gives dealer natural precedence over later 21', () => {
    expect(payout(hand('A', 'K'), hand('A', 'Q'), 100).outcome).toBe('push');
    expect(payout(hand('7', '7', '7'), hand('A', 'Q'), 100).outcome).toBe('loss');
  });

  it('pays a player natural against dealer later 21 or bust', () => {
    expect(payout(hand('A', 'K'), hand('7', '7', '7'), 100)).toEqual({ outcome: 'blackjack', returned: 250, profit: 150 });
    expect(payout(hand('A', 'K'), hand('10', '7', '8'), 100).outcome).toBe('blackjack');
  });

  it('pays later 21 as an ordinary win, and equal non-natural totals push', () => {
    expect(payout(hand('7', '7', '7'), hand('10', '9'), 100).returned).toBe(200);
    expect(payout(hand('7', '7', '7'), hand('10', '5', '6'), 100).outcome).toBe('push');
  });

  it('loses a player bust even if dealer also busts; surviving hands win', () => {
    const dealer = hand('10', '7', '8');
    expect(payout(hand('10', '9', '5'), dealer, 100).outcome).toBe('loss');
    expect(payout(hand('10', '2'), dealer, 100).outcome).toBe('win');
  });

  it.each([0, -50, 50.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects illegal stake %s', (stake) => {
    expect(() => payout(hand('A', 'K'), hand('10', '8'), stake)).toThrow('INVALID_WAGER_AMOUNT');
  });

  it('rejects settlement before both hands are dealt', () => {
    expect(() => payout(hand('A'), hand('10', '8'), 100)).toThrow('INCOMPLETE_HAND');
    expect(() => payout(hand('A', 'K'), [], 100)).toThrow('INCOMPLETE_HAND');
  });
});

describe('dealer and offer rules', () => {
  it.each([
    [['10', '6'], true], [['A', '5'], true], [['A', '6'], false],
    [['10', '7'], false], [['A', '6', '10'], false], [['10', '10', '5'], false],
  ] as [Rank[], boolean][])('dealer %j hit is %s', (ranks, hits) => {
    expect(dealerShouldHit(hand(...ranks))).toBe(hits);
  });

  it.each([
    [['10', '2'], true], [['10', '10'], true], [['A', 'A', '10'], true],
    [['10', 'A', '7'], true], [['5', '6'], false], [['A', 'A'], false],
    [['A', '9'], false], [['A', 'K'], false], [['7', '7', '7'], false],
    [['10', '10', '2'], false], [[], false],
  ] as [Rank[], boolean][])('hand %j bluff eligibility is %s', (ranks, eligible) => {
    expect(canOffer(hand(...ranks))).toBe(eligible);
  });
});
