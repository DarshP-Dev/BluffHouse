import { type Card } from '@bluff-house/shared';
import { evaluate } from './cards.js';
import {available} from './ledger.js';
import type {Room,Player} from './state.js';

export interface Payout {
  returned: number;
  profit: number;
  outcome: 'blackjack' | 'win' | 'push' | 'loss';
}

export function payout(hand: Card[], dealer: Card[], stake: number, maximum=250): Payout {
  if (!Number.isSafeInteger(stake)||stake<50||stake>maximum||stake%50!==0||!Number.isSafeInteger(maximum)||maximum<50||maximum>750) throw new Error('INVALID_WAGER_AMOUNT');
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

export function doubleReason(r:Room,p:Player):string|null {
  if(r.mode!=='PARTY'||!r.settings.doubleDown)return 'Ordinary Double Down is enabled only by the Party lobby setting.';
  if(r.phase!=='PLAYER_TURN'||r.activePlayerId!==p.id||!p.participating||!p.connected||p.departed)return 'Wait for your ordinary Blackjack decision.';
  if(p.doubled)return 'This hand has already doubled.';
  if(p.hand.length!==2||evaluate(p.hand).natural||p.status!=='playing')return 'Double only an initial non-natural two-card hand before hitting.';
  if(p.bluffUsed)return 'Double before making any Call My Bluff offer.';
  if(p.chaosAffected||r.party?.chaos.multipliers[p.id])return 'Double before any Chaos involvement; multipliers cannot stack.';
  if(!p.wagerId||p.wager<50||p.wager>250||p.account.escrows[p.wagerId]!==p.wager)return 'Double requires your funded original Blackjack wager.';
  if(available(p.account)<p.wager)return 'You need one equal extra stake available to double.';
  return null;
}
