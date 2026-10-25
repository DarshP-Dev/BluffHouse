import {validAmount,validBetAmount,type BluffView,type ClaimType,type ClaimRule,type ClaimEvidence} from '@bluff-house/shared';
import {evaluate} from './cards.js';
import {payout} from './blackjack.js';
import {settle} from './ledger.js';
import {requireRule,type Room,type BluffState,type EngineOptions} from './state.js';

export const CLAIM_RULES:readonly ClaimRule[]=[
  {type:'NEXT_HIT_SAFE',label:'My next hit will not bust.',timing:'IMMEDIATE',help:'Acceptance forces exactly one draw. Non-bust wins the matched pot immediately.'},
  {type:'NEXT_HIT_EXACT_21',label:'My next card gives me exactly 21',timing:'IMMEDIATE',help:'Acceptance forces exactly one draw. Only a resulting total of exactly 21 wins.'},
  {type:'BEAT_DEALER',label:"I'll beat the dealer",timing:'ROUND_RESULT',help:'Acceptance holds both stakes until the actual round settles. A Blackjack win wins; a push or loss fails. No card is forced.'},
  {type:'THREE_CARD_WIN',label:"I'll win with at least three cards",timing:'ROUND_RESULT',help:'At actual round settlement, win Blackjack with at least three cards. Pushes fail. No card is forced.'},
  {type:'DEALER_BUST',label:'The dealer will bust',timing:'ROUND_RESULT',help:'At actual round settlement, the dealer must bust. Your own Blackjack outcome does not change this predicate. No card is forced.'},
];
export function isDeferredClaim(type:ClaimType):boolean {return CLAIM_RULES.find(rule=>rule.type===type)?.timing==='ROUND_RESULT';}
export const claimWagerId=(r:Room,offer:BluffView)=>`${r.matchId}:${offer.id}:bluff`;
export function claimWins(type:ClaimType,hand:Parameters<typeof evaluate>[0],dealer:Parameters<typeof evaluate>[0]=[]):boolean {
  if(type==='NEXT_HIT_SAFE')return !evaluate(hand).bust;
  if(type==='NEXT_HIT_EXACT_21')return evaluate(hand).total===21;
  if(type==='DEALER_BUST')return evaluate(dealer).bust;
  const result=payout(hand,dealer,50),win=result.outcome==='win'||result.outcome==='blackjack';
  return type==='BEAT_DEALER'?win:type==='THREE_CARD_WIN'&&hand.length>=3&&win;
}
function evidence(offer:BluffView,proof:NonNullable<BluffState['proof']>):ClaimEvidence {
  const type=offer.claimType??'NEXT_HIT_SAFE',v=evaluate(proof.hand);
  const result:ClaimEvidence={playerTotal:v.total,playerCardCount:proof.hand.length,playerNatural:v.natural,playerBust:v.bust,claimTrue:claimWins(type,proof.hand,proof.dealer)};
  if(isDeferredClaim(type)){
    const dealer=evaluate(proof.dealer!);
    Object.assign(result,{dealerTotal:dealer.total,dealerNatural:dealer.natural,dealerBust:dealer.bust,playerOutcome:payout(proof.hand,proof.dealer!,50).outcome});
  }
  return result;
}

/** Never clone private proofs or hand-lock metadata into any browser payload. */
export function projectClaim(o:BluffView):BluffView {
  const result:BluffView={id:o.id,claimantId:o.claimantId,amount:o.amount,deadline:o.deadline,status:o.status};
  if(o.challengerId!==undefined)result.challengerId=o.challengerId;
  if(o.card)result.card={id:o.card.id,rank:o.card.rank,suit:o.card.suit};
  if(o.winnerId!==undefined)result.winnerId=o.winnerId;
  if(o.pot!==undefined)result.pot=o.pot;
  if(o.claimType!==undefined)result.claimType=o.claimType;
  if(o.timing!==undefined)result.timing=o.timing;
  if(o.settlement!==undefined)result.settlement=o.settlement;
  if(o.roundId!==undefined)result.roundId=o.roundId;
  if(o.settlement==='settled'&&o.evidence){
    const v=o.evidence;
    result.evidence={playerTotal:v.playerTotal,playerCardCount:v.playerCardCount,playerNatural:v.playerNatural,playerBust:v.playerBust,claimTrue:v.claimTrue};
    if(isDeferredClaim(o.claimType??'NEXT_HIT_SAFE'))Object.assign(result.evidence,{dealerTotal:v.dealerTotal,dealerNatural:v.dealerNatural,dealerBust:v.dealerBust,playerOutcome:v.playerOutcome});
  }
  return result;
}
export function completeClaim(r:Room,offer:BluffState,proof:NonNullable<BluffState['proof']>){
  const claimant=r.players.find(p=>p.id===offer.claimantId)!,challenger=r.players.find(p=>p.id===offer.challengerId)!;
  requireRule(claimant&&challenger&&claimant!==challenger,'BLUFF_PARTICIPANTS_INVARIANT');
  const truth=claimWins(offer.claimType??'NEXT_HIT_SAFE',proof.hand,proof.dealer),winner=truth?claimant:challenger,loser=truth?challenger:claimant,id=claimWagerId(r,offer);
  requireRule(claimant.account.escrows[id]===offer.amount&&challenger.account.escrows[id]===offer.amount,'BLUFF_ESCROW_INVARIANT');
  requireRule(settle(winner.account,id,offer.amount*2)&&settle(loser.account,id,0),'BLUFF_ALREADY_SETTLED');
  winner.bluffWins++;loser.bluffLosses++;
  Object.assign(offer,{status:'accepted',settlement:'settled',winnerId:winner.id,pot:offer.amount*2,proof:structuredClone(proof)});
  offer.evidence=evidence(offer,proof);
  r.bluffOutcomes.push(structuredClone(offer));
  const best=[...r.bluffOutcomes].sort((a,b)=>(b.pot??0)-(a.pot??0)||(a.acceptedOrder??r.bluffOutcomes.indexOf(a)+1)-(b.acceptedOrder??r.bluffOutcomes.indexOf(b)+1))[0]!;
  r.biggestBluff=projectClaim(best);
  return winner;
}
export function settlePendingClaims(r:Room,e:EngineOptions,now:number){
  for(const pending of r.pendingClaims){
    requireRule(pending.roundId===r.roundId,'STALE_PENDING_CLAIM');
    const claimant=r.players.find(p=>p.id===pending.claimantId)!;
    const winner=completeClaim(r,pending,{hand:structuredClone(claimant.hand),dealer:structuredClone(r.dealer)});
    if(r.bluff?.id===pending.id)r.bluff=structuredClone(pending);
    r.events.push({id:e.id(),kind:'bluff',text:`${winner.name} wins the ${pending.pot}-chip end-of-round claim pot (+${pending.amount} net).`,playerId:winner.id,at:now,revision:r.revision+1});
  }
  r.events=r.events.slice(-60);r.pendingClaims=[];
}
export function handProtected(r:Room,playerId:string):boolean{return r.pendingClaims.some(o=>o.claimantId===playerId||o.challengerId===playerId);}
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
export function assertClaims(r:Room){
  const histories=r.bluffOutcomes,pending=r.pendingClaims,all=[...histories,...pending],ids=all.map(o=>o.id);
  requireRule(new Set(ids).size===ids.length,'DUPLICATE_BLUFF');
  const ordered=all.filter(o=>o.acceptedOrder!==undefined);
  requireRule(ordered.every(o=>Number.isSafeInteger(o.acceptedOrder)&&o.acceptedOrder!>0)&&new Set(ordered.map(o=>o.acceptedOrder)).size===ordered.length,'BLUFF_ACCEPTANCE_ORDER_INVARIANT');
  requireRule(new Set(pending.map(o=>`${o.roundId}:${o.claimantId}`)).size===pending.length,'DUPLICATE_PENDING_CLAIM');
  for(const o of pending){
    requireRule(r.mode==='PARTY'&&r.settings.extraClaims&&o.status==='accepted'&&o.settlement==='pending'&&isDeferredClaim(o.claimType!)&&o.timing==='ROUND_RESULT'&&o.roundId===r.roundId&&!o.card&&!o.winnerId&&!o.evidence&&!o.proof&&o.pot===o.amount*2,'PENDING_CLAIM_INVARIANT');
    requireRule(o.challengerId!==o.claimantId&&validAmount(o.amount),'PENDING_CLAIM_INVARIANT');
    requireRule(Object.keys(o.lockedHands).length===2&&Object.keys(o.lockedHands).every(id=>id===o.claimantId||id===o.challengerId),'CLAIM_HAND_LOCK_INVARIANT');
    for(const playerId of [o.claimantId,o.challengerId!]){
      const p=r.players.find(p=>p.id===playerId),lock=o.lockedHands[playerId];
      requireRule(p?.participating&&lock&&same(p.hand.slice(0,lock.length),lock)&&p.account.escrows[claimWagerId(r,o)]===o.amount&&!Object.hasOwn(p.account.settlements,claimWagerId(r,o)),'PENDING_CLAIM_FUNDING_INVARIANT');
    }
  }
  for(const o of histories){
    const claimant=r.players.find(p=>p.id===o.claimantId),challenger=r.players.find(p=>p.id===o.challengerId),id=claimWagerId(r,o);
    requireRule(o.status==='accepted'&&o.winnerId&&o.challengerId&&o.claimantId!==o.challengerId&&o.pot===o.amount*2&&validAmount(o.amount)&&claimant&&challenger,'BLUFF_SETTLEMENT_INVARIANT');
    requireRule(o.winnerId===claimant.id||o.winnerId===challenger.id,'BLUFF_SETTLEMENT_INVARIANT');
    requireRule(claimant.account.settlements[id]===(o.winnerId===claimant.id?o.pot:0)&&challenger.account.settlements[id]===(o.winnerId===challenger.id?o.pot:0),'BLUFF_PAYMENT_INVARIANT');
    if(o.claimType){
      requireRule(CLAIM_RULES.some(rule=>rule.type===o.claimType)&&o.settlement==='settled'&&o.proof&&o.roundId&&same(o.evidence,evidence(o,o.proof)),'CLAIM_PROOF_INVARIANT');
      const deferred=isDeferredClaim(o.claimType);
      requireRule(o.timing===(deferred?'ROUND_RESULT':'IMMEDIATE')&&(deferred?!!o.proof.dealer&&!o.card:!o.proof.dealer&&!!o.card&&o.proof.hand.at(-1)?.id===o.card.id),'CLAIM_TIMING_INVARIANT');
      requireRule(o.winnerId===(o.evidence!.claimTrue?o.claimantId:o.challengerId),'CLAIM_TRUTH_INVARIANT');
      if(o.roundId===r.roundId){
        requireRule(same(claimant.hand.slice(0,o.proof.hand.length),o.proof.hand),'CLAIM_HAND_PROOF_INVARIANT');
        if(deferred)requireRule(same(claimant.hand,o.proof.hand)&&same(r.dealer,o.proof.dealer),'CLAIM_DEALER_PROOF_INVARIANT');
      }
    }else requireRule(o.card,'BLUFF_SETTLEMENT_INVARIANT');
  }
  for(const p of r.players){
    for(const id of Object.keys(p.account.escrows).filter(id=>id.startsWith(`${r.matchId}:`)&&id.endsWith(':bluff')))requireRule(pending.some(o=>claimWagerId(r,o)===id&&(o.claimantId===p.id||o.challengerId===p.id)),'ORPHAN_CLAIM_ESCROW');
    requireRule(typeof p.doubled==='boolean'&&typeof p.chaosAffected==='boolean','DOUBLE_STATE_INVARIANT');
    if(p.doubled)requireRule(r.mode==='PARTY'&&r.settings.doubleDown&&!p.chaosAffected&&!p.bluffUsed&&!r.party?.chaos.multipliers[p.id]&&validBetAmount(p.wager/2)&&p.hand.length===3&&p.status!=='playing','DOUBLE_STATE_INVARIANT');
  }
  requireRule(!pending.length||!['LOBBY','BETTING','POT_TWIST','DEALING','HAND_CHAOS','ROUND_RESULT','SOCIAL','RESULTS','WAITING_FOR_PLAYERS'].includes(r.phase),'UNSETTLED_ROUND_CLAIM');
}
