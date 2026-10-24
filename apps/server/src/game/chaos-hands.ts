import type {ChaosKind,Command} from '@bluff-house/shared';
import {evaluate} from './cards.js';
import {addEvent,draw,finishHit} from './engine.js';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';

export function eligibleHands(r:Room):Player[]{
  return r.players.filter(p=>p.participating&&p.connected&&!p.departed&&p.status==='playing'&&p.hand.length===2&&!evaluate(p.hand).natural&&!!p.wagerId&&p.wager>0&&p.account.escrows[p.wagerId]===p.wager).sort((a,b)=>a.seat-b.seat);
}

export function openHandWindow(r:Room,e:EngineOptions,now:number):boolean{
  if(!r.party||r.mode!=='PARTY'||r.phase!=='DEALING'||r.party.chaos.handWindow||r.terminationConfirmed||evaluate(r.dealer).natural||eligibleHands(r).length<2)return false;
  const window={id:e.id(),deadline:now+5000,resolved:false};
  r.party.chaos.handWindow=window;r.phase='HAND_CHAOS';r.deadline=window.deadline;
  r.activePlayerId=undefined;r.decisionId=undefined;
  addEvent(r,e,'chaos','Five seconds for Hand Swap or Table Turn before ordinary decisions. Wagers and seats stay with their owners.',now);
  return true;
}

export function clearOrdinaryHit(r:Room,playerId:string){if(r.party)delete r.party.chaos.ordinaryHits[playerId];}

/** Record the resulting decision, never the one consumed by the ordinary Hit. */
export function markOrdinaryHit(r:Room,p:Player){
  clearOrdinaryHit(r,p.id);
  if(!r.party||r.phase!=='PLAYER_TURN'||r.activePlayerId!==p.id||!r.decisionId||p.status!=='playing'||p.hand.length<3||evaluate(p.hand).total>=21)return;
  const card=p.hand.at(-1);if(card)r.party.chaos.ordinaryHits[p.id]={cardId:card.id,decisionId:r.decisionId};
}

export function handCardReason(r:Room,p:Player,kind:ChaosKind):string|null{
  if(kind==='SECOND_CHANCE'){
    if(r.phase!=='PLAYER_TURN'||r.activePlayerId!==p.id)return 'Second Chance requires your next decision after an ordinary Hit.';
    if(p.status!=='playing'||evaluate(p.hand).total>=21||evaluate(p.hand).natural)return 'Second Chance cannot replace a bust, 21, natural, or settled hand.';
    const marker=r.party?.chaos.ordinaryHits[p.id],last=p.hand.at(-1);
    if(p.hand.length<3||!marker||marker.decisionId!==r.decisionId||marker.cardId!==last?.id)return 'Only your most recent ordinary Hit can be replaced; challenged draws are protected.';
    if(r.bluff?.status==='accepted'&&r.bluff.card?.id===marker.cardId)return 'An accepted challenge card is protected and cannot be replaced.';
    return null;
  }
  const window=r.party?.chaos.handWindow;
  if(r.phase!=='HAND_CHAOS'||!window)return 'Play hand movement during the five-second window before ordinary decisions.';
  if(window.resolved)return 'A hand movement has already resolved in this window.';
  const eligible=eligibleHands(r);
  if(!eligible.some(player=>player.id===p.id))return 'Your hand must be funded, connected, unacted, and non-natural to move.';
  if(eligible.length<2)return 'At least two eligible hands are needed.';
  return null;
}

/** The caller validates ownership and consumes the card only after success. */
export function applyHandCard(r:Room,p:Player,kind:ChaosKind,c:Command,e:EngineOptions,now:number){
  const reason=handCardReason(r,p,kind);requireRule(!reason,'CHAOS_UNAVAILABLE',reason??undefined);
  if(kind==='SECOND_CHANCE'){
    requireRule(c.decisionId===r.decisionId&&r.deadline!==null&&now<r.deadline,'STALE_DECISION','This Blackjack decision has changed.');
    const replacement=draw(r),discard=p.hand.pop()!;r.discarded.push(discard);p.hand.push(replacement);
    clearOrdinaryHit(r,p.id);finishHit(r,e,now);
    addEvent(r,e,'chaos',`${p.name} plays Second Chance: the most recent ordinary Hit is discarded and replaced from the shoe.`,now,p.id);
    return;
  }
  const window=r.party!.chaos.handWindow!;
  requireRule(c.chaosWindowId===window.id&&now<window.deadline,'STALE_CHAOS_WINDOW','This hand movement window has closed or changed.');
  const eligible=eligibleHands(r);
  if(kind==='HAND_SWAP'){
    const target=eligible.find(player=>player.id===c.payload?.targetId&&player.id!==p.id);
    requireRule(target,'INVALID_HAND_TARGET','Choose a different connected player with a funded, unacted, non-natural two-card hand.');
    [p.hand,target.hand]=[target.hand,p.hand];
    addEvent(r,e,'chaos',`${p.name} swaps hands with ${target.name}. Wagers and seats stay with their owners.`,now,p.id);
  }else{
    requireRule(kind==='TABLE_TURN','INVALID_CHAOS_KIND');
    const hands=eligible.map(player=>player.hand);
    for(let i=0;i<eligible.length;i++)eligible[i]!.hand=hands[(i+1)%hands.length]!;
    addEvent(r,e,'chaos',`${p.name} plays Table Turn. Eligible hands move one seat left; wagers and seats stay with their owners.`,now,p.id);
  }
  window.resolved=true;
}
