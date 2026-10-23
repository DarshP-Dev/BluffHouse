import { randomInt as secureRandomInt } from 'node:crypto';
import type { Card, HandValue, Rank, Suit } from '@bluff-house/shared';

const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const suits: Suit[] = ['S', 'H', 'D', 'C'];

/** Aces start low; one may count as eleven if it does not bust the hand. */
export function evaluate(cards: Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (!ranks.includes(card.rank)) throw new Error('INVALID_CARD');
    if (card.rank === 'A') {
      aces += 1;
      total += 1;
    } else {
      total += ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank);
    }
  }
  const soft = aces > 0 && total + 10 <= 21;
  if (soft) total += 10;
  return { total, soft, bust: total > 21, natural: cards.length === 2 && total === 21 };
}

/** Six decks. The injectable random boundary is server-side test support only. */
export function makeShoe(randomInt: (max: number) => number = secureRandomInt): Card[] {
  const cards: Card[] = [];
  for (let deck = 0; deck < 6; deck += 1) {
    for (const suit of suits) {
      for (const rank of ranks) cards.push({ id: `${deck}:${suit}:${rank}`, rank, suit });
    }
  }
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('INVALID_RANDOM_INDEX');
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
