import { RULES,validBetAmount,type Card } from '@bluff-house/shared';
import { evaluate } from './cards.js';
import {maximumBackedBet} from './house-bank.js';
import {available} from './ledger.js';
import type {Room,Player} from './state.js';

export interface Payout {
  returned: number;
  profit: number;
  outcome: 'blackjack' | 'win' | 'push' | 'loss';
}

export function payout(hand: Card[], dealer: Card[], stake: number, maximum:number=RULES.maxBet): Payout {
  if (!validBetAmount(stake)||stake>maximum||!validBetAmount(maximum)) throw new Error('INVALID_WAGER_AMOUNT');
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
  // Chip balances are whole numbers; an odd-chip 3:2 natural rounds down.
  const returned = outcome === 'blackjack' ? Math.floor(stake * 5 / 2) : outcome === 'win' ? stake * 2 : outcome === 'push' ? stake : 0;
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
  if(!p.wagerId||!validBetAmount(p.wager)||p.account.escrows[p.wagerId]!==p.wager)return 'Double requires your funded original Blackjack wager.';
  if(available(p.account)<p.wager)return 'You need one equal extra stake available to double.';
  if(r.party&&p.wager*2>maximumBackedBet(r,p,true))return 'The finite Table Bank cannot back your doubled wager.';
  return null;
}
