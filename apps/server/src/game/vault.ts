import {evaluate} from './cards.js';
import {credit} from './ledger.js';
import {requireRule,type Room,type EngineOptions,type ShadowState} from './state.js';

export interface ShadowScore {playerId:string;baseTotal:number;claimBonus:number;challengePoints:number;disqualified:boolean;eligible:boolean;score:number|null}

/** An uncalled declaration is authoritative even when the actual hand busts. */
export function shadowScoring(shadow:ShadowState,replaceLiePlayerId?:string):ShadowScore[]{
  return shadow.entries.map(entry=>{
    const value=evaluate(entry.hand),claim=shadow.claims.find(claim=>claim.claimantId===entry.playerId&&claim.status!=='open');
    const ignored=entry.playerId===replaceLiePlayerId&&claim?.status==='unchallenged'&&claim.declaredTotal!==value.total;
    const disqualified=claim?.status==='caught';
    const accepted=!ignored&&claim?.status==='unchallenged';
    const baseTotal=accepted?claim.declaredTotal:value.total;
    const claimBonus=accepted?1:claim?.status==='truthful'?2:0;
    const challengePoints=shadow.claims.reduce((points,c)=>c.challengerId!==entry.playerId?points:c.status==='truthful'?points-2:c.status==='caught'?points+2:points,0);
    const eligible=!disqualified&&(accepted||!value.bust);
    return {playerId:entry.playerId,baseTotal,claimBonus,challengePoints,disqualified,eligible,score:eligible?baseTotal+claimBonus+challengePoints:null};
  });
}

export function shadowWinners(r:Room,replaceLiePlayerId?:string):string[]{
  const shadow=r.party!.shadow!,scores=shadowScoring(shadow,replaceLiePlayerId),eligible=scores.filter(score=>score.eligible);
  if(!eligible.length)return r.players.filter(p=>p.participating).sort((a,b)=>a.seat-b.seat).map(p=>p.id);
  const highest=Math.max(...eligible.map(score=>score.score!));
  return shadow.entries.filter(entry=>eligible.some(score=>score.playerId===entry.playerId&&score.score===highest)).map(entry=>entry.playerId);
}

function awardFor(r:Room,playerId:string,winnerIds:string[]){
  const ordered=r.players.filter(p=>winnerIds.includes(p.id)).sort((a,b)=>a.seat-b.seat),index=ordered.findIndex(p=>p.id===playerId);
  return index<0?0:Math.floor(r.party!.shadow!.pot/ordered.length)+(index<r.party!.shadow!.pot%ordered.length?1:0);
}
export function shadowVaultThieves(r:Room):string[]{
  const shadow=r.party!.shadow!,actual=shadowWinners(r);
  return shadow.entries.filter(entry=>{
    const claim=shadow.claims.find(c=>c.claimantId===entry.playerId&&c.status==='unchallenged');
    if(!claim||claim.declaredTotal===evaluate(entry.hand).total||!actual.includes(entry.playerId))return false;
    const counterfactual=shadowWinners(r,entry.playerId),changed=actual.length!==counterfactual.length||actual.some(id=>!counterfactual.includes(id));
    return changed&&awardFor(r,entry.playerId,actual)>awardFor(r,entry.playerId,counterfactual);
  }).map(entry=>entry.playerId);
}

/** The only money movement in Shadow Draw; funded entirely by the existing Vault. */
export function settleShadowVault(r:Room,e:EngineOptions,now:number){
  const party=r.party,shadow=party?.shadow;requireRule(party&&shadow,'SHADOW_CLOSED');if(shadow.status==='settled')return;
  requireRule(!party.vaultDistributed&&party.vault===shadow.pot,'SHADOW_VAULT_INVARIANT');
  requireRule(shadow.entries.every(entry=>entry.locked&&entry.claimDone)&&!shadow.claims.some(claim=>claim.status==='open'),'SHADOW_OBLIGATION_OPEN');
  const scores=shadowScoring(shadow),winnerIds=shadowWinners(r);
  shadow.fallback=!scores.some(score=>score.eligible);shadow.winnerIds=winnerIds;
  shadow.vaultThiefIds=shadowVaultThieves(r);
  const winners=r.players.filter(p=>winnerIds.includes(p.id)).sort((a,b)=>a.seat-b.seat);
  requireRule(winners.length>0,'NO_SHADOW_WINNERS');
  const each=Math.floor(shadow.pot/winners.length),remainder=shadow.pot%winners.length;
  for(const [index,p] of winners.entries()){
    const amount=each+(index<remainder?1:0),id=`${r.matchId}:${shadow.id}:${p.id}:shadow-vault`;
    requireRule(credit(p.account,id,amount),'SHADOW_ALREADY_SETTLED');party.vault-=amount;
    party.transfers.push({id,kind:'shadow_award',amount,from:'VAULT',to:p.id});shadow.awards.push({playerId:p.id,amount});
  }
  party.vaultDistributed=true;shadow.status='settled';shadow.activePlayerId=null;shadow.decisionId=null;
  for(const entry of shadow.entries)entry.revealed=true;
  r.events.push({id:e.id(),kind:'vault',text:shadow.fallback?`Every Shadow Draw entry is ineligible. The ${shadow.pot}-chip Vault is shared among all original participants.`:`Shadow Draw settles: ${winners.map(p=>p.name).join(', ')} ${winners.length===1?'wins':'share'} the funded ${shadow.pot}-chip Vault. Accepted uncalled declarations keep their scores.`,at:now,revision:r.revision+1});r.events=r.events.slice(-60);
}
