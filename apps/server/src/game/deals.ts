import {validAmount,type Command,type DealChoice,type DealOffer,type DealView} from '@bluff-house/shared';
import {available,reserve,release,commit,settle,credit} from './ledger.js';
import {cancelSocialInvites,refreshSocialDeadline} from './duels.js';
import {failBallot} from './overthrow.js';
import {requireRule,type Room,type Player,type EngineOptions,type DealState} from './state.js';

const OFFER_MS=8000,CHOICE_MS=10000,SUMMARY_MS=2000;
const stakeKey=(id:string,playerId:string)=>`${id}:${playerId}:deal`;
const participants=(r:Room)=>r.players.filter(p=>p.participating&&p.connected&&!p.departed);
function player(r:Room,id:string){const p=r.players.find(p=>p.id===id);requireRule(p,'PLAYER_MISSING');return p;}
function event(r:Room,e:EngineOptions,text:string,at:number,playerId?:string){r.events.push({id:e.id(),kind:'deal',text,at,playerId,revision:r.revision+1});r.events=r.events.slice(-60);}
const samePair=(d:Pick<DealState,'inviterId'|'defenderId'>,a:string,b:string)=>d.inviterId===a&&d.defenderId===b||d.inviterId===b&&d.defenderId===a;
export function dealPairUsed(r:Room,a:string,b:string){return !!r.party&&(r.party.dealHistory.some(d=>samePair(d,a,b))||!!r.party.social?.deal&&samePair(r.party.social.deal,a,b));}
function cancelOffer(r:Room,offer:DealOffer,status:'expired'|'rejected'|'cancelled'){
  if(offer.status!=='pending')return false;
  release(player(r,offer.inviterId).account,stakeKey(offer.id,offer.inviterId));offer.status=status;return true;
}
export function cancelDealOffers(r:Room,exceptId?:string){for(const offer of r.party?.social?.dealInvites??[])if(offer.id!==exceptId)cancelOffer(r,offer,'cancelled');}
export function cancelPlayerDealOffers(r:Room,playerId:string):boolean{
  let cancelled=false;for(const offer of r.party?.social?.dealInvites??[])if(offer.inviterId===playerId||offer.defenderId===playerId)cancelled=cancelOffer(r,offer,'cancelled')||cancelled;return cancelled;
}
export function expireDealOffers(r:Room,at:number){for(const offer of r.party?.social?.dealInvites??[])if(offer.deadline<=at)cancelOffer(r,offer,'expired');}

function settleDeal(r:Room,d:DealState,e:EngineOptions,now:number){
  if(d.status==='settled')return;
  const ids=[d.inviterId,d.defenderId];
  for(const id of ids)if(!Object.hasOwn(d.choices,id)){d.choices[id]='STEAL';d.defaultedPlayerIds.push(id);}
  const bothSplit=ids.every(id=>d.choices[id]==='SPLIT'),bothSteal=ids.every(id=>d.choices[id]==='STEAL');
  d.bonusEach=bothSplit?Math.min(10,Math.floor(r.party!.bonusReserve/2)):0;
  d.vaultAmount=bothSteal?d.amount*2:0;
  for(const id of ids){
    const principal=bothSplit?d.amount:bothSteal?0:d.choices[id]==='STEAL'?d.amount*2:0;
    requireRule(settle(player(r,id).account,stakeKey(d.id,id),principal),'DEAL_ALREADY_SETTLED');
    if(d.bonusEach){const bonusId=`${d.id}:${id}:deal-bonus`;requireRule(credit(player(r,id).account,bonusId,d.bonusEach),'DEAL_ALREADY_SETTLED');r.party!.transfers.push({id:bonusId,kind:'deal_bonus',amount:d.bonusEach,from:'BONUS_RESERVE',to:id,roundId:r.roundId});}
    d.returns[id]=principal+d.bonusEach;
  }
  r.party!.bonusReserve-=d.bonusEach*2;
  if(d.vaultAmount){r.party!.vault+=d.vaultAmount;r.party!.transfers.push({id:`${d.id}:deal-vault`,kind:'deal_vault',amount:d.vaultAmount,from:`DEAL:${d.id}`,to:'VAULT',roundId:r.roundId});}
  d.status='settled';d.reason=bothSplit?`Both Split. Each contribution returns with an equal ${d.bonusEach}-chip cooperation bonus.`:bothSteal?`Both Steal. The full ${d.vaultAmount}-chip pot enters the Vault.`:`${player(r,ids.find(id=>d.choices[id]==='STEAL')!).name} steals the full ${d.amount*2}-chip pot.`;
  if(d.defaultedPlayerIds.length)d.reason+=' Missing decisions defaulted to Steal.';
  r.party!.dealHistory.push(structuredClone(d));r.phase='DEAL_RESULT';r.deadline=Math.min(now+SUMMARY_MS,r.party!.social!.hardDeadline);
  event(r,e,d.reason,now);
}

export function dealCommand(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  const party=r.party,social=party?.social;requireRule(r.mode==='PARTY'&&party&&social,'SOCIAL_CLOSED');
  requireRule(c.socialId===social.id,'STALE_SOCIAL');requireRule(p.participating&&p.connected&&!p.departed,'NOT_PARTICIPATING');
  if(c.type==='deal:choose'){
    const deal=social.deal;requireRule(r.phase==='DEAL'&&deal?.status==='choosing','DEAL_CLOSED');requireRule(c.dealId===deal.id,'STALE_DEAL');
    requireRule(p.id===deal.inviterId||p.id===deal.defenderId,'NOT_DEAL_PLAYER');
    requireRule(now<deal.deadline&&!Object.hasOwn(deal.choices,p.id),'DEAL_CHOICE_LOCKED','Your decision is locked or its deadline has passed.');
    const choice=c.payload?.choice;requireRule(choice==='SPLIT'||choice==='STEAL','INVALID_DEAL_CHOICE');deal.choices[p.id]=choice;
    if(Object.hasOwn(deal.choices,deal.inviterId)&&Object.hasOwn(deal.choices,deal.defenderId))settleDeal(r,deal,e,now);return;
  }
  requireRule(c.socialSlotId===social.slotId,'STALE_SOCIAL_SLOT','This social admission slot has changed.');
  requireRule(r.phase==='SOCIAL'&&!social.duel&&!social.deal&&now<social.admissionDeadline,'ADMISSION_CLOSED');
  if(c.type==='deal:offer'){
    requireRule(!r.terminationConfirmed&&participants(r).length>=2,'NOT_ENOUGH_PLAYERS');
    requireRule(!social.dealInvites.some(o=>o.inviterId===p.id&&o.status==='pending')&&!social.invites.some(o=>o.inviterId===p.id&&o.status==='pending'),'DEAL_OFFER_PENDING','Your outgoing social offer is still pending.');requireRule(social.dealInvites.length<64,'DEAL_OFFER_LIMIT');
    const defenderId=c.payload?.defenderId,amount=c.payload?.amount;
    requireRule(typeof defenderId==='string'&&defenderId!==p.id,'INVALID_DEFENDER');requireRule(participants(r).some(p=>p.id===defenderId),'DEFENDER_UNAVAILABLE');
    requireRule(validAmount(amount),'INVALID_AMOUNT','Contribute 50–250 chips in steps of 50.');requireRule(!dealPairUsed(r,p.id,defenderId),'DEAL_PAIR_USED','This pair has already accepted a contract this match.');
    requireRule(available(p.account)>=amount,'INSUFFICIENT_AVAILABLE_CHIPS');const id=e.id();reserve(p.account,stakeKey(id,p.id),amount);
    social.dealInvites.push({id,inviterId:p.id,defenderId,amount,deadline:Math.min(now+OFFER_MS,social.admissionDeadline),status:'pending',slot:social.slot});
    event(r,e,`${p.name} offers ${player(r,defenderId).name} a matched ${amount}-chip Split or Steal contract. Both decisions lock privately for ten seconds; any missing decision becomes Steal.`,now,p.id);refreshSocialDeadline(r);return;
  }
  requireRule(c.type==='deal:accept'||c.type==='deal:reject','UNAVAILABLE_ACTION');
  const offer=social.dealInvites.find(o=>o.id===c.dealOfferId);requireRule(offer&&offer.slot===social.slot&&offer.status==='pending'&&now<offer.deadline,'DEAL_OFFER_CLOSED');requireRule(offer.defenderId===p.id,'NOT_DEFENDER');
  if(c.type==='deal:reject'){cancelOffer(r,offer,'rejected');event(r,e,`${p.name} declines the contract; its reservation returns.`,now,p.id);refreshSocialDeadline(r);return;}
  requireRule(!r.terminationConfirmed&&participants(r).length>=2,'NOT_ENOUGH_PLAYERS');requireRule(now+CHOICE_MS+SUMMARY_MS<=social.hardDeadline,'INSUFFICIENT_SOCIAL_TIME');
  requireRule(participants(r).some(p=>p.id===offer.inviterId),'INVITER_UNAVAILABLE');requireRule(!dealPairUsed(r,offer.inviterId,p.id),'DEAL_PAIR_USED');
  cancelSocialInvites(r);cancelDealOffers(r,offer.id);
  requireRule(available(p.account)>=offer.amount,'INSUFFICIENT_AVAILABLE_CHIPS');reserve(p.account,stakeKey(offer.id,p.id),offer.amount);
  commit(player(r,offer.inviterId).account,stakeKey(offer.id,offer.inviterId));commit(p.account,stakeKey(offer.id,p.id));offer.status='accepted';
  failBallot(r,e,now,'The overthrow ballot closed because a funded contract was accepted.');
  social.deal={id:offer.id,socialId:social.id,slot:social.slot,inviterId:offer.inviterId,defenderId:p.id,amount:offer.amount,status:'choosing',startedAt:now,deadline:now+CHOICE_MS,choices:{},defaultedPlayerIds:[],bonusEach:0,returns:{},vaultAmount:0};
  r.phase='DEAL';r.deadline=social.deal.deadline;
  event(r,e,`${p.name} accepts the Split or Steal contract. Both ${offer.amount}-chip contributions are committed. Lock a private decision within ten seconds; missing decisions become Steal.`,now,p.id);
}

export function dealsDeadline(r:Room,e:EngineOptions,at:number){const deal=r.party?.social?.deal;requireRule(r.phase==='DEAL'&&deal?.status==='choosing','DEAL_CLOSED');requireRule(at>=deal.deadline,'DEAL_DEADLINE');settleDeal(r,deal,e,at);}
export function projectDeal(d:DealState,viewerId:string):DealView{
  return {id:d.id,socialId:d.socialId,slot:d.slot,inviterId:d.inviterId,defenderId:d.defenderId,amount:d.amount,status:d.status,startedAt:d.startedAt,deadline:d.deadline,lockedPlayerIds:Object.keys(d.choices),...(Object.hasOwn(d.choices,viewerId)?{ownChoice:d.choices[viewerId]}:{}),...(d.status==='settled'?{choices:{...d.choices}}:{}),defaultedPlayerIds:[...d.defaultedPlayerIds],bonusEach:d.bonusEach,returns:{...d.returns},vaultAmount:d.vaultAmount,...(d.reason?{reason:d.reason}:{})};
}
export function projectDealHistory(r:Room,viewerId:string):DealView[]{return(r.party?.dealHistory??[]).map(d=>projectDeal(d,viewerId));}

export function assertDeals(r:Room){
  if(!r.party)return;const social=r.party.social,seen=new Set<string>(),pairs=new Set<string>();
  for(const d of r.party.dealHistory){requireRule(d.status==='settled'&&!seen.has(d.id),'DEAL_HISTORY_INVARIANT');seen.add(d.id);}
  if(social?.deal&&seen.has(social.deal.id))requireRule(JSON.stringify(social.deal)===JSON.stringify(r.party.dealHistory.find(d=>d.id===social.deal!.id)),'DEAL_CURRENT_HISTORY_INVARIANT');
  const deals=[...r.party.dealHistory,...(social?.deal&&!seen.has(social.deal.id)?[social.deal]:[])];
  for(const d of deals){
    const ids=[d.inviterId,d.defenderId],pair=JSON.stringify([...ids].sort());requireRule(ids[0]!==ids[1]&&ids.every(id=>r.players.some(p=>p.id===id&&p.participating))&&validAmount(d.amount),'DEAL_STAKE_INVARIANT');requireRule(!pairs.has(pair),'DEAL_PAIR_INVARIANT');pairs.add(pair);
    requireRule(typeof d.socialId==='string'&&!!d.socialId&&(d.slot===1||d.slot===2)&&Number.isFinite(d.startedAt)&&d.deadline===d.startedAt+CHOICE_MS,'DEAL_CLOCK_INVARIANT');
    requireRule(Object.keys(d.choices).every(id=>ids.includes(id)&&(d.choices[id]==='SPLIT'||d.choices[id]==='STEAL')),'DEAL_CHOICE_INVARIANT');
    requireRule(new Set(d.defaultedPlayerIds).size===d.defaultedPlayerIds.length&&d.defaultedPlayerIds.every(id=>ids.includes(id)&&d.choices[id]==='STEAL'),'DEAL_DEFAULT_INVARIANT');
    const settled=d.status==='settled',bothSplit=ids.every(id=>d.choices[id]==='SPLIT'),bothSteal=ids.every(id=>d.choices[id]==='STEAL');
    requireRule(settled||d.status==='choosing','DEAL_STATUS_INVARIANT');
    requireRule(Number.isSafeInteger(d.bonusEach)&&d.bonusEach>=0&&d.bonusEach<=10&&(bothSplit&&settled||d.bonusEach===0),'DEAL_BONUS_INVARIANT');
    if(settled)requireRule(Object.keys(d.choices).length===2&&Object.keys(d.returns).length===2&&ids.every(id=>Object.hasOwn(d.returns,id)),'DEAL_REVEAL_INVARIANT');
    else requireRule(r.phase==='DEAL'&&social?.deal?.id===d.id&&social.id===d.socialId&&social.slot===d.slot&&r.deadline===d.deadline&&d.deadline+SUMMARY_MS<=social.hardDeadline&&Object.keys(d.returns).length===0&&d.defaultedPlayerIds.length===0,'LIVE_DEAL_INVARIANT');
    for(const id of ids){
      const account=player(r,id).account,key=stakeKey(d.id,id),bonusId=`${d.id}:${id}:deal-bonus`,bonuses=r.party.transfers.filter(t=>t.id===bonusId);
      requireRule(!Object.hasOwn(account.reservations,key),'COMMITTED_DEAL_RESERVATION');
      const principal=bothSplit?d.amount:bothSteal?0:d.choices[id]==='STEAL'?2*d.amount:0;
      if(settled)requireRule(!Object.hasOwn(account.escrows,key)&&account.settlements[key]===principal&&d.returns[id]===principal+d.bonusEach,'DEAL_SETTLEMENT_INVARIANT');
      else requireRule(account.escrows[key]===d.amount&&!Object.hasOwn(account.settlements,key),'DEAL_ESCROW_INVARIANT');
      if(d.bonusEach)requireRule(account.settlements[bonusId]===d.bonusEach&&bonuses.length===1&&bonuses[0]!.kind==='deal_bonus'&&bonuses[0]!.amount===d.bonusEach&&bonuses[0]!.from==='BONUS_RESERVE'&&bonuses[0]!.to===id,'DEAL_BONUS_TRANSFER_INVARIANT');
      else requireRule(!Object.hasOwn(account.settlements,bonusId)&&bonuses.length===0,'DEAL_UNEXPECTED_BONUS_INVARIANT');
    }
    const vault=r.party.transfers.filter(t=>t.id===`${d.id}:deal-vault`),expectedVault=settled&&bothSteal?2*d.amount:0;
    requireRule(d.vaultAmount===expectedVault,'DEAL_VAULT_INVARIANT');
    if(expectedVault)requireRule(vault.length===1&&vault[0]!.kind==='deal_vault'&&vault[0]!.amount===expectedVault&&vault[0]!.from===`DEAL:${d.id}`&&vault[0]!.to==='VAULT','DEAL_VAULT_TRANSFER_INVARIANT');else requireRule(vault.length===0,'DEAL_UNEXPECTED_VAULT_INVARIANT');
  }
  const offerIds=new Set<string>();requireRule((social?.dealInvites.length??0)<=64,'DEAL_OFFER_LIMIT_INVARIANT');
  for(const offer of social?.dealInvites??[]){
    requireRule(!offerIds.has(offer.id)&&typeof offer.id==='string'&&!!offer.id,'DEAL_OFFER_ID_INVARIANT');offerIds.add(offer.id);
    requireRule(offer.inviterId!==offer.defenderId&&validAmount(offer.amount)&&(offer.slot===1||offer.slot===2&&social!.slot===2),'DEAL_OFFER_INVARIANT');const opened=offer.slot===1?social!.openedAt:social!.slotOpenedAt;
    requireRule(offer.deadline>opened&&offer.deadline<=opened+20000,'DEAL_OFFER_DEADLINE_INVARIANT');
    const account=player(r,offer.inviterId).account,key=stakeKey(offer.id,offer.inviterId);
    if(offer.status==='pending')requireRule(account.reservations[key]===offer.amount&&!Object.hasOwn(account.escrows,key),'DEAL_OFFER_RESERVATION_INVARIANT');
    else if(offer.status==='accepted')requireRule(deals.some(d=>d.id===offer.id&&d.inviterId===offer.inviterId&&d.defenderId===offer.defenderId&&d.amount===offer.amount),'DEAL_OFFER_ACCEPTANCE_INVARIANT');
    else requireRule(['expired','cancelled','rejected'].includes(offer.status)&&!Object.hasOwn(account.reservations,key)&&!Object.hasOwn(account.escrows,key)&&!Object.hasOwn(account.settlements,key),'CANCELLED_DEAL_STAKE_INVARIANT');
  }
}
