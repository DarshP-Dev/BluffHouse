import { validAmount, type Card } from '@bluff-house/shared';
import { evaluate } from './cards.js';

export interface Payout {
  returned: number;
  profit: number;
  outcome: 'blackjack' | 'win' | 'push' | 'loss';
}

export function payout(hand: Card[], dealer: Card[], stake: number): Payout {
  if (!validAmount(stake)) throw new Error('INVALID_WAGER_AMOUNT');
  if (hand.length < 2 || dealer.length < 2) throw new Error('INCOMPLETE_HAND');
  const playerValue = evaluate(hand);
  const dealerValue = evaluate(dealer);
  let outcome: Payout['outcome'];
  if (playerValue.bust) outcome = 'loss';
  else if (dealerValue.natural) outcome = playerValue.natural ? 'push' : 'loss';
  else if (playerValue.natural) outcome = 'blackjack';
  else if (dealerValue.bust || playerValue.total > dealerValue.total) outcome = 'win';
  else if (playerValue.total === dealerValue.total) outcome = 'push';
  else outcome = 'loss';
  const returned = outcome === 'blackjack' ? stake * 5 / 2 : outcome === 'win' ? stake * 2 : outcome === 'push' ? stake : 0;
  return { returned, profit: returned - stake, outcome };
}

export function dealerShouldHit(cards: Card[]): boolean {
  return evaluate(cards).total < 17;
}

/** Phase, active seat and one-offer-per-hand checks belong to the room engine. */
export function canOffer(hand: Card[]): boolean {
  const value = evaluate(hand);
  return hand.length >= 2 && !value.soft && value.total >= 12 && value.total <= 20;
}
