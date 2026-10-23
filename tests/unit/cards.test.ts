import { describe, expect, it } from 'vitest';
import type { Card, Rank } from '@bluff-house/shared';
import { evaluate, makeShoe } from '../../apps/server/src/game/cards.js';

const hand = (...ranks: Rank[]): Card[] => ranks.map((rank, index) => ({ id: `test:${index}`, rank, suit: 'S' }));

describe('hand evaluation', () => {
  it.each([
    [[], 0, false, false, false],
    [['A'], 11, true, false, false],
    [['A', 'A'], 12, true, false, false],
    [['A', 'A', '9'], 21, true, false, false],
    [['A', 'A', '9', '9'], 20, false, false, false],
    [['A', '6'], 17, true, false, false],
    [['A', '6', '10'], 17, false, false, false],
    [['K', 'Q', 'A'], 21, false, false, false],
    [['10', '7', '5'], 22, false, true, false],
    [['A', 'K'], 21, true, false, true],
    [['10', 'A'], 21, true, false, true],
    [['7', '7', '7'], 21, false, false, false],
  ] as [Rank[], number, boolean, boolean, boolean][])(
    '%j gives total %i, soft %s, bust %s, natural %s',
    (ranks, total, soft, bust, natural) => expect(evaluate(hand(...ranks))).toEqual({ total, soft, bust, natural }),
  );

  it('does not mutate the cards', () => {
    const cards = hand('A', 'A', '9', '10');
    const before = structuredClone(cards);
    evaluate(cards);
    expect(cards).toEqual(before);
  });
});

describe('six-deck shoe', () => {
  it('contains every rank/suit six times with 312 distinct card IDs', () => {
    const shoe = makeShoe();
    expect(shoe).toHaveLength(312);
    expect(new Set(shoe.map((card) => card.id)).size).toBe(312);
    const counts = new Map<string, number>();
    for (const card of shoe) {
      const key = `${card.rank}:${card.suit}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      expect(Object.keys(card).sort()).toEqual(['id', 'rank', 'suit']);
    }
    expect(counts.size).toBe(52);
    expect([...counts.values()]).toEqual(Array(52).fill(6));
  });

  it('uses each Fisher–Yates bound once and supports a deterministic server fixture', () => {
    const bounds: number[] = [];
    const shoe = makeShoe((max) => { bounds.push(max); return max - 1; });
    expect(bounds).toEqual(Array.from({ length: 311 }, (_, index) => 312 - index));
    expect(shoe[0]).toEqual({ id: '0:S:A', rank: 'A', suit: 'S' });
    expect(shoe.at(-1)).toEqual({ id: '5:C:K', rank: 'K', suit: 'C' });
    const shuffled = makeShoe(() => 0);
    expect(shuffled.map((card) => card.id).sort()).toEqual(shoe.map((card) => card.id).sort());
    expect(shuffled).not.toEqual(shoe);
  });

  it('refreshes with independent card objects and no missing cards after a prior round', () => {
    const first = makeShoe((max) => max - 1);
    const firstCard = first[0];
    first.splice(0, 100);
    const next = makeShoe((max) => max - 1);
    expect(next).toHaveLength(312);
    expect(next[0]).toEqual(firstCard);
    expect(next[0]).not.toBe(firstCard);
  });

  it.each([-1, 312, 0.5, NaN, Infinity])('rejects invalid injected random index %s', (value) => {
    expect(() => makeShoe(() => value)).toThrow('INVALID_RANDOM_INDEX');
  });
});
