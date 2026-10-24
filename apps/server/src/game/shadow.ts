import type {Command,ShadowClaim,ShadowView} from '@bluff-house/shared';
import {evaluate} from './cards.js';
import {shadowScoring,shadowWinners,settleShadowVault,shadowVaultThieves} from './vault.js';
import {requireRule,type Room,type Player,type EngineOptions,type ShadowState} from './state.js';

const DECISION_MS=10000,CHALLENGE_MS=8000,RESULT_MS=2000;
function event(r:Room,e:EngineOptions,text:string,at:number,playerId?:string){r.events.push({id:e.id(),kind:'shadow',text,at,playerId,revision:r.revision+1});r.events=r.events.slice(-60);}
function entry(r:Room,id:string){const p=r.party!.shadow!.entries.find(p=>p.playerId===id);requireRule(p,'NOT_SHADOW_ENTRANT','Only the frozen Shadow Draw entrants can act.');return p;}
function name(r:Room,id:string){return r.players.find(p=>p.id===id)!.name;}
function draw(shadow:ShadowState){const card=shadow.shoe[shadow.cursor];requireRule(card,'SHADOW_SHOE_EXHAUSTED');shadow.cursor++;return card;}
function nextClaim(r:Room,e:EngineOptions,now:number){
  const shadow=r.party!.shadow!,next=shadow.entries.find(p=>!p.claimDone);
  if(!next){settleShadowVault(r,e,now);r.phase='SHADOW_RESULT';shadow.deadline=now+RESULT_MS;r.deadline=shadow.deadline;return;}
  shadow.status='claiming';shadow.activePlayerId=next.playerId;shadow.decisionId=e.id();shadow.deadline=now+DECISION_MS;
  r.phase='SHADOW_CLAIM';r.deadline=shadow.deadline;
}
function nextDraw(r:Room,e:EngineOptions,now:number){
  const shadow=r.party!.shadow!,next=shadow.entries.find(p=>!p.locked);
  if(!next){nextClaim(r,e,now);return;}
  shadow.status='drawing';shadow.activePlayerId=next.playerId;shadow.decisionId=e.id();shadow.deadline=now+DECISION_MS;
  r.phase='SHADOW_DRAW';r.deadline=shadow.deadline;
}

/** Entry freezes participants and hands; later presence changes only affect actions. */
export function startShadow(r:Room,e:EngineOptions,now:number):boolean{
  const party=r.party;
  if(r.mode!=='PARTY'||r.phase!=='ROUND_RESULT'||!r.finaleEnabled||!party||party.shadow||party.vaultDistributed||party.vault<=0||r.terminationConfirmed||r.round<r.roundLimit)return false;
  const entrants=r.players.filter(p=>p.participating&&p.connected&&!p.departed).sort((a,b)=>a.seat-b.seat);
  if(entrants.length<2)return false;
  requireRule(!party.social&&!r.players.some(p=>Object.keys(p.account.escrows).length||Object.keys(p.account.reservations).length),'LIVE_SHADOW_ENTRY_OBLIGATION');
  const shadow:ShadowState={id:e.id(),status:'drawing',pot:party.vault,entries:entrants.map(p=>({playerId:p.id,seat:p.seat,hand:[],locked:false,drew:false,revealed:false,claimDone:false})),shoe:e.shoe(),cursor:0,activePlayerId:null,decisionId:null,deadline:null,claim:null,claims:[],winnerIds:[],awards:[],fallback:false,vaultThiefIds:[]};
  for(let pass=0;pass<2;pass++)for(const p of shadow.entries)p.hand.push(draw(shadow));
  party.shadow=shadow;r.activePlayerId=undefined;r.decisionId=undefined;r.bettingId=undefined;
  nextDraw(r,e,now);event(r,e,`Shadow Draw begins for ${entrants.map(p=>p.name).join(', ')}. The funded ${shadow.pot}-chip Vault requires no buy-in. Each frozen entrant may Stand or draw one hidden card.`,now);return true;
}

export function shadowCommand(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  const shadow=r.party?.shadow;requireRule(shadow&&shadow.status!=='settled','SHADOW_CLOSED');requireRule(c.shadowId===shadow.id,'STALE_SHADOW');
  requireRule(p.participating&&p.connected&&!p.departed,'NOT_PARTICIPATING');const own=entry(r,p.id);
  if(c.type==='shadow:reveal'){
    requireRule(own.locked,'SHADOW_HAND_UNLOCKED','Finish your draw decision before revealing.');
    const wasRevealed=own.revealed;own.revealed=true;
    if(!shadow.claims.some(claim=>claim.claimantId===p.id))own.claimDone=true;
    if(!wasRevealed)event(r,e,`${p.name} voluntarily reveals their locked Shadow hand. An existing declaration keeps its published resolution rules.`,now,p.id);
    if(r.phase==='SHADOW_CLAIM'&&shadow.activePlayerId===p.id)nextClaim(r,e,now);return;
  }
  if(c.type==='shadow:challenge'){
    const claim=shadow.claim;requireRule(r.phase==='SHADOW_CHALLENGE'&&claim?.status==='open','SHADOW_CLAIM_CLOSED');
    requireRule(c.shadowClaimId===claim.id&&now<claim.deadline,'STALE_SHADOW_CLAIM');requireRule(claim.claimantId!==p.id,'SELF_SHADOW_CHALLENGE');
    requireRule(!shadow.claims.some(claim=>claim.claimantId===p.id&&claim.status==='caught'),'SHADOW_DISQUALIFIED','A disqualified entrant cannot call another claim.');
    const claimant=entry(r,claim.claimantId),truth=evaluate(claimant.hand).total===claim.declaredTotal;
    claim.challengerId=p.id;claim.status=truth?'truthful':'caught';claimant.revealed=true;if(truth)own.revealed=true;
    event(r,e,truth?`${p.name} calls ${name(r,claim.claimantId)}'s exact ${claim.declaredTotal}. The truthful claimant earns two claim points; ${p.name} loses two challenge points and reveals.`:`${p.name} catches ${name(r,claim.claimantId)}'s false ${claim.declaredTotal} declaration. The claimant is disqualified; ${p.name} earns two challenge points.`,now,p.id);
    nextClaim(r,e,now);return;
  }
  requireRule(r.phase==='SHADOW_DRAW'||r.phase==='SHADOW_CLAIM','SHADOW_DECISION_CLOSED');
  requireRule(shadow.activePlayerId===p.id,'NOT_SHADOW_TURN');requireRule(c.decisionId===shadow.decisionId&&shadow.deadline!==null&&now<shadow.deadline,'STALE_SHADOW_DECISION');
  if(r.phase==='SHADOW_DRAW'){
    requireRule(c.type==='shadow:draw'||c.type==='shadow:stand','UNAVAILABLE_ACTION');requireRule(!own.locked,'SHADOW_HAND_LOCKED');
    if(c.type==='shadow:draw'){own.hand.push(draw(shadow));own.drew=true;}
    own.locked=true;event(r,e,`${p.name} ${own.drew?'takes one hidden Shadow Draw':'stands'} and locks their hand.`,now,p.id);nextDraw(r,e,now);return;
  }
  requireRule(c.type==='shadow:claim'||c.type==='shadow:pass','UNAVAILABLE_ACTION');requireRule(!own.claimDone&&own.locked,'SHADOW_CLAIM_USED');
  if(c.type==='shadow:pass'){own.claimDone=true;event(r,e,`${p.name} passes their declaration; the actual hand will score at settlement.`,now,p.id);nextClaim(r,e,now);return;}
  const declaredTotal=c.payload?.declaredTotal;requireRule(typeof declaredTotal==='number'&&Number.isInteger(declaredTotal)&&declaredTotal>=17&&declaredTotal<=21,'INVALID_SHADOW_TOTAL','Declare one exact total from 17 through 21, even if your actual hand busts.');
  const claim:ShadowClaim={id:e.id(),claimantId:p.id,declaredTotal:declaredTotal as ShadowClaim['declaredTotal'],status:'open',deadline:now+CHALLENGE_MS};
  own.claimDone=true;shadow.claim=claim;shadow.claims.push(claim);shadow.status='challenging';shadow.decisionId=null;shadow.deadline=claim.deadline;r.phase='SHADOW_CHALLENGE';r.deadline=claim.deadline;
  event(r,e,`${p.name} declares an exact ${declaredTotal}. The first valid caller has eight seconds; an uncalled declaration becomes the effective base plus one point.`,now,p.id);
}

/** True only when the settled reveal has finished and overall results may begin. */
export function shadowDeadline(r:Room,e:EngineOptions,at:number):boolean{
  const shadow=r.party?.shadow;requireRule(shadow&&shadow.deadline!==null&&at>=shadow.deadline,'SHADOW_DEADLINE');
  if(r.phase==='SHADOW_RESULT'){requireRule(shadow.status==='settled','SHADOW_UNSETTLED');return true;}
  if(r.phase==='SHADOW_DRAW'){entry(r,shadow.activePlayerId!).locked=true;event(r,e,`${name(r,shadow.activePlayerId!)} automatically stands in Shadow Draw.`,at,shadow.activePlayerId!);nextDraw(r,e,at);return false;}
  if(r.phase==='SHADOW_CLAIM'){entry(r,shadow.activePlayerId!).claimDone=true;event(r,e,`${name(r,shadow.activePlayerId!)} automatically passes their declaration.`,at,shadow.activePlayerId!);nextClaim(r,e,at);return false;}
  requireRule(r.phase==='SHADOW_CHALLENGE'&&shadow.claim?.status==='open','SHADOW_CLAIM_CLOSED');shadow.claim.status='unchallenged';
  event(r,e,`${name(r,shadow.claim.claimantId)}'s ${shadow.claim.declaredTotal} declaration goes uncalled: that declared base plus one point is locked, regardless of the actual hand.`,at,shadow.claim.claimantId);nextClaim(r,e,at);return false;
}

export function projectShadow(r:Room,viewerId:string):ShadowView|null{
  const shadow=r.party?.shadow;if(!shadow)return null;const scores=shadow.status==='settled'?shadowScoring(shadow):[];
  return {id:shadow.id,status:shadow.status,pot:shadow.pot,entrantIds:shadow.entries.map(entry=>entry.playerId),entrants:shadow.entries.map(entry=>{
    const visible=entry.playerId===viewerId||entry.revealed||shadow.status==='settled',score=scores.find(score=>score.playerId===entry.playerId);
    return {playerId:entry.playerId,seat:entry.seat,hand:entry.hand.map(card=>visible?{...card}:null),value:visible?evaluate(entry.hand):null,locked:entry.locked,drew:entry.drew,revealed:entry.revealed,claimDone:entry.claimDone,...(score?{disqualified:score.disqualified,baseTotal:score.baseTotal,claimBonus:score.claimBonus,challengePoints:score.challengePoints,score:score.score}:{})};
  }),activePlayerId:shadow.activePlayerId,decisionId:shadow.activePlayerId===viewerId?shadow.decisionId:null,deadline:shadow.deadline,claim:shadow.claim?{...shadow.claim}:null,claims:shadow.claims.map(claim=>({...claim})),winnerIds:[...shadow.winnerIds],awards:shadow.awards.map(award=>({...award})),fallback:shadow.fallback,vaultThiefIds:[...shadow.vaultThiefIds]};
}

export function assertShadow(r:Room){
  const party=r.party,shadow=party?.shadow;if(!party||!shadow)return;
  requireRule(r.mode==='PARTY'&&Number.isSafeInteger(shadow.pot)&&shadow.pot>0&&shadow.entries.length>=2&&shadow.entries.length<=6,'SHADOW_ENTRY_INVARIANT');
  const entrantIds=shadow.entries.map(entry=>entry.playerId),cards=shadow.entries.flatMap(entry=>entry.hand);
  requireRule(new Set(entrantIds).size===entrantIds.length&&shadow.entries.every((entry,i)=>r.players.some(p=>p.id===entry.playerId&&p.participating&&p.seat===entry.seat)&&(i===0||shadow.entries[i-1]!.seat<entry.seat)),'SHADOW_FROZEN_ENTRANTS_INVARIANT');
  requireRule(new Set(cards.map(card=>card.id)).size===cards.length&&shadow.cursor===cards.length&&new Set(shadow.shoe.map(card=>card.id)).size===shadow.shoe.length&&cards.every(card=>shadow.shoe.slice(0,shadow.cursor).some(dealt=>dealt.id===card.id&&dealt.rank===card.rank&&dealt.suit===card.suit)),'SHADOW_CARD_INVARIANT');
  for(const entry of shadow.entries)requireRule(entry.hand.length===(entry.drew?3:2)&&(!entry.drew||entry.locked)&&(!entry.revealed||entry.locked)&&(!entry.claimDone||entry.locked),'SHADOW_HAND_INVARIANT');
  requireRule(new Set(shadow.claims.map(claim=>claim.id)).size===shadow.claims.length&&new Set(shadow.claims.map(claim=>claim.claimantId)).size===shadow.claims.length&&shadow.claims.filter(claim=>claim.status==='open').length<=1,'SHADOW_CLAIMS_INVARIANT');
  for(const [index,claim] of shadow.claims.entries()){
    const claimant=shadow.entries.find(entry=>entry.playerId===claim.claimantId);requireRule(claimant&&claimant.locked&&claimant.claimDone&&Number.isInteger(claim.declaredTotal)&&claim.declaredTotal>=17&&claim.declaredTotal<=21&&Number.isFinite(claim.deadline)&&(index===0||entrantIds.indexOf(shadow.claims[index-1]!.claimantId)<entrantIds.indexOf(claim.claimantId)),'SHADOW_CLAIM_INVARIANT');
    requireRule(['open','unchallenged','truthful','caught'].includes(claim.status),'SHADOW_CLAIM_STATUS_INVARIANT');
    if(claim.status==='truthful'||claim.status==='caught'){
      const challenger=shadow.entries.find(entry=>entry.playerId===claim.challengerId);requireRule(challenger&&challenger.playerId!==claim.claimantId&&claimant.revealed,'SHADOW_CHALLENGER_INVARIANT');
      requireRule((evaluate(claimant.hand).total===claim.declaredTotal)===(claim.status==='truthful')&&(claim.status!=='truthful'||challenger.revealed),'SHADOW_TRUTH_INVARIANT');
    }else requireRule(claim.challengerId===undefined,'SHADOW_UNCALLED_CHALLENGER_INVARIANT');
  }
  requireRule(shadow.claim===null?shadow.claims.length===0:JSON.stringify(shadow.claim)===JSON.stringify(shadow.claims.at(-1)),'SHADOW_CURRENT_CLAIM_INVARIANT');
  if(shadow.status==='settled'){
    const scores=shadowScoring(shadow),winners=shadowWinners(r),ordered=r.players.filter(p=>winners.includes(p.id)).sort((a,b)=>a.seat-b.seat);
    requireRule((r.phase==='SHADOW_RESULT'||r.phase==='RESULTS')&&party.vaultDistributed&&party.vault===0&&shadow.activePlayerId===null&&shadow.decisionId===null&&shadow.entries.every(entry=>entry.locked&&entry.claimDone&&entry.revealed)&&!shadow.claims.some(claim=>claim.status==='open'),'SHADOW_SETTLEMENT_INVARIANT');
    requireRule(JSON.stringify(shadow.winnerIds)===JSON.stringify(winners)&&shadow.fallback===!scores.some(score=>score.eligible)&&JSON.stringify(shadow.vaultThiefIds)===JSON.stringify(shadowVaultThieves(r)),'SHADOW_WINNER_INVARIANT');
    requireRule(shadow.awards.length===ordered.length,'SHADOW_AWARDS_INVARIANT');
    for(const [index,p] of ordered.entries()){
      const amount=Math.floor(shadow.pot/ordered.length)+(index<shadow.pot%ordered.length?1:0),id=`${r.matchId}:${shadow.id}:${p.id}:shadow-vault`,transfer=party.transfers.filter(transfer=>transfer.id===id);
      requireRule(shadow.awards[index]?.playerId===p.id&&shadow.awards[index]?.amount===amount&&p.account.settlements[id]===amount&&transfer.length===1&&transfer[0]!.kind==='shadow_award'&&transfer[0]!.amount===amount&&transfer[0]!.from==='VAULT'&&transfer[0]!.to===p.id,'SHADOW_PAYOUT_INVARIANT');
    }
    return;
  }
  requireRule(!party.vaultDistributed&&party.vault===shadow.pot&&shadow.winnerIds.length===0&&shadow.awards.length===0&&!shadow.fallback&&shadow.vaultThiefIds.length===0&&shadow.deadline===r.deadline&&Number.isFinite(shadow.deadline)&&typeof shadow.activePlayerId==='string'&&entrantIds.includes(shadow.activePlayerId),'SHADOW_LIVE_INVARIANT');
  if(shadow.status==='drawing')requireRule(r.phase==='SHADOW_DRAW'&&typeof shadow.decisionId==='string'&&shadow.entries.find(entry=>!entry.locked)?.playerId===shadow.activePlayerId&&shadow.claims.length===0,'SHADOW_DRAW_INVARIANT');
  else if(shadow.status==='claiming')requireRule(r.phase==='SHADOW_CLAIM'&&typeof shadow.decisionId==='string'&&shadow.entries.every(entry=>entry.locked)&&shadow.entries.find(entry=>!entry.claimDone)?.playerId===shadow.activePlayerId&&!shadow.claims.some(claim=>claim.status==='open'),'SHADOW_CLAIM_STAGE_INVARIANT');
  else requireRule(shadow.status==='challenging'&&r.phase==='SHADOW_CHALLENGE'&&shadow.entries.every(entry=>entry.locked)&&shadow.decisionId===null&&shadow.claim?.status==='open'&&shadow.claim.claimantId===shadow.activePlayerId&&shadow.claim.deadline===shadow.deadline,'SHADOW_CHALLENGE_STAGE_INVARIANT');
}
