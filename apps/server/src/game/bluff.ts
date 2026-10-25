import {RULES,validAmount,type Command} from '@bluff-house/shared';
import {canOffer} from './blackjack.js';
import {reserve,release,commit} from './ledger.js';
import {CLAIM_RULES,isDeferredClaim,completeClaim} from './claims.js';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';

const wagerId=(r:Room)=>`${r.matchId}:${r.bluff!.id}:bluff`;

export function offerBluff(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  requireRule(r.phase==='PLAYER_TURN','PHASE_LOCKED');
  requireRule(r.activePlayerId===p.id,'NOT_YOUR_TURN');
  requireRule(c.decisionId===r.decisionId,'STALE_DECISION');
  const rule=CLAIM_RULES.find(rule=>rule.type===c.payload?.claimType);requireRule(rule,'INVALID_CLAIM');
  requireRule(rule.type==='NEXT_HIT_SAFE'||r.mode==='PARTY'&&r.settings.extraClaims,'EXTRA_CLAIMS_DISABLED','Additional claims require the Party extra-claims setting.');
  requireRule(!p.bluffUsed,'OFFER_ALREADY_USED','One bluff offer per hand, including expired offers.');
  requireRule(canOffer(p.hand),'INELIGIBLE_HAND','Call My Bluff needs a hard total from 12 to 20.');
  const amount=c.payload?.amount;requireRule(validAmount(amount),'INVALID_AMOUNT');
  const offerId=e.id();reserve(p.account,`${r.matchId}:${offerId}:bluff`,amount);
  r.pausedRemaining=Math.max(0,(r.deadline??now)-now);p.bluffUsed=true;
  r.bluff={id:offerId,claimantId:p.id,amount,deadline:now+RULES.offerMs,status:'open',claimType:rule.type,timing:rule.timing,roundId:r.roundId};
  r.phase='BLUFF_OFFER';r.deadline=r.bluff.deadline;r.decisionId=undefined;
}

/** Runs only on the room processor's private candidate; no observable partial state. */
export function acceptBluff(r:Room,p:Player,c:Command,_e:EngineOptions,now:number){
  const offer=r.bluff;
  requireRule(r.phase==='BLUFF_OFFER'&&offer?.status==='open','OFFER_CLOSED','This challenge is no longer open.');
  requireRule(c.offerId===offer.id,'STALE_OFFER');requireRule(now<offer.deadline,'OFFER_EXPIRED');
  requireRule(p.id!==offer.claimantId,'SELF_CHALLENGE');requireRule(p.participating&&p.connected&&!p.departed,'NOT_ELIGIBLE');
  const claimant=r.players.find(player=>player.id===offer.claimantId)!;
  requireRule(claimant.connected&&!claimant.departed,'CLAIMANT_UNAVAILABLE');
  const id=wagerId(r);requireRule(claimant.account.reservations[id]===offer.amount,'MISSING_RESERVATION');
  reserve(p.account,id,offer.amount);commit(claimant.account,id);commit(p.account,id);
  Object.assign(offer,{status:'accepted',challengerId:p.id,pot:offer.amount*2,acceptedOrder:r.bluffOutcomes.length+r.pendingClaims.length+1});
  if(isDeferredClaim(offer.claimType??'NEXT_HIT_SAFE')){
    offer.settlement='pending';
    r.pendingClaims.push({...structuredClone(offer),lockedHands:{[claimant.id]:structuredClone(claimant.hand),[p.id]:structuredClone(p.hand)}});
    r.phase='BLUFF_REVEAL';r.deadline=now+RULES.revealMs;r.decisionId=undefined;return;
  }
  const card=r.shoe[r.cursor];requireRule(card,'SHOE_EXHAUSTED');r.cursor++;claimant.hand.push(card);
  offer.card=card;completeClaim(r,offer,{hand:structuredClone(claimant.hand)});
  r.phase='BLUFF_REVEAL';r.deadline=now+RULES.revealMs;r.decisionId=undefined;
}

export function cancelBluff(r:Room,e:EngineOptions,now:number,status:'expired'|'cancelled'){
  const offer=r.bluff;requireRule(r.phase==='BLUFF_OFFER'&&offer?.status==='open','OFFER_CLOSED');
  const claimant=r.players.find(p=>p.id===offer.claimantId)!;
  release(claimant.account,wagerId(r));offer.status=status;
  r.phase='PLAYER_TURN';r.deadline=now+Math.max(5000,r.pausedRemaining);r.decisionId=e.id();
}
