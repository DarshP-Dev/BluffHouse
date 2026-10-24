import {validAmount,type BountyView,type Command,type DuelInvite} from '@bluff-house/shared';
import {available,reserve,commit,settle,credit} from './ledger.js';
import {inviteDuel} from './duels.js';
import {requireRule,type Room,type Player,type EngineOptions,type DuelState} from './state.js';

export const remainingBountyIntervals=(r:Room)=>r.phase==='RESULTS'?0:Math.max(0,r.roundLimit-Math.max(1,r.round));
function event(r:Room,e:EngineOptions,text:string,at:number,playerId?:string){r.events.push({id:e.id(),kind:'bounty',text,at,playerId,revision:r.revision+1});r.events=r.events.slice(-60);}
function owner(r:Room,id:string){const p=r.players.find(p=>p.id===id);requireRule(p,'PLAYER_MISSING');return p;}
function hasDefended(r:Room,targetId:string){const social=r.party!.social!;return r.party!.bounties.some(b=>b.targetId===targetId&&b.defendedIntervalIds.includes(social.id));}
function activeBounty(r:Room,id:unknown){const b=r.party!.bounties.find(b=>b.id===id&&b.status==='active');requireRule(b,'BOUNTY_CLOSED','That bounty is no longer active.');return b;}
function acceptedDefense(r:Room,b:BountyView){const duel=r.party!.social?.duel;return !!duel&&duel.id===b.duelId&&duel.status==='playing';}

export function bountyCommand(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  const party=r.party,social=party?.social;requireRule(r.mode==='PARTY'&&party&&social,'SOCIAL_CLOSED');
  requireRule(c.socialId===social.id,'STALE_SOCIAL');
  requireRule(c.socialSlotId===social.slotId,'STALE_SOCIAL_SLOT','This social admission slot has changed.');
  requireRule(p.participating&&p.connected&&!p.departed,'NOT_PARTICIPATING');
  requireRule(r.phase==='SOCIAL'&&!social.duel&&now<social.admissionDeadline,'ADMISSION_CLOSED');
  requireRule(!r.terminationConfirmed&&r.players.filter(p=>p.participating&&p.connected&&!p.departed).length>=2,'NOT_ENOUGH_PLAYERS');
  if(c.type==='bounty:invite'){
    const bounty=activeBounty(r,c.payload?.bountyId);
    requireRule(!hasDefended(r,bounty.targetId),'BOUNTY_DEFENSE_USED','This target has already accepted a qualifying defense in this interval.');
    inviteDuel(r,p,bounty.targetId,50,e,now,{purpose:'BOUNTY',bountyId:bounty.id});return;
  }
  requireRule(c.type==='bounty:contribute','UNAVAILABLE_ACTION');
  const targetId=c.payload?.targetId,amount=c.payload?.amount;
  requireRule(typeof targetId==='string'&&targetId!==p.id,'INVALID_BOUNTY_TARGET','Choose another eligible participant.');
  requireRule(r.players.some(p=>p.id===targetId&&p.participating&&p.connected&&!p.departed),'BOUNTY_TARGET_UNAVAILABLE','The target must be connected and participating.');
  requireRule(validAmount(amount),'INVALID_AMOUNT','Contribute 50–250 chips in steps of 50.');
  let bounty=party.bounties.find(b=>b.targetId===targetId&&b.status==='active');
  if(!bounty){
    requireRule(remainingBountyIntervals(r)>=3,'BOUNTY_TOO_LATE','A new bounty needs at least three remaining social intervals, including this one.');
    bounty={id:e.id(),targetId,total:0,streak:0,status:'active',contributions:[],defendedIntervalIds:[]};party.bounties.push(bounty);
  }
  requireRule(!acceptedDefense(r,bounty),'BOUNTY_FROZEN','Contributions are frozen during an accepted bounty duel.');
  requireRule(bounty.total+amount<=1000,'BOUNTY_CAP','A target bounty cannot exceed 1,000 chips.');
  requireRule(available(p.account)>=amount,'INSUFFICIENT_AVAILABLE_CHIPS');
  const id=`${bounty.id}:${e.id()}:bounty-contribution`;reserve(p.account,id,amount);commit(p.account,id);
  bounty.contributions.push({id,playerId:p.id,amount});bounty.total+=amount;
  event(r,e,`${p.name} commits ${amount} chips to ${owner(r,targetId).name}'s bounty (${bounty.total} total). Contributions stay in escrow until the bounty resolves or the match ends.`,now,p.id);
}

export function validateBountyDefense(r:Room,invite:DuelInvite){
  if(invite.purpose!=='BOUNTY')return;
  const bounty=activeBounty(r,invite.bountyId);
  requireRule(invite.amount===50&&invite.defenderId===bounty.targetId&&invite.inviterId!==bounty.targetId,'INVALID_BOUNTY_DUEL');
  requireRule(!hasDefended(r,bounty.targetId),'BOUNTY_DEFENSE_USED','This target has already accepted a qualifying defense in this interval.');
  requireRule(!acceptedDefense(r,bounty),'BOUNTY_FROZEN');
}
export function acceptBountyDefense(r:Room,invite:DuelInvite){
  if(invite.purpose!=='BOUNTY')return;validateBountyDefense(r,invite);
  const bounty=activeBounty(r,invite.bountyId);bounty.duelId=invite.id;bounty.defendedIntervalIds.push(r.party!.social!.id);
}

/** Duel stakes settle normally before this separately funded bounty award. */
export function settleBountyDefense(r:Room,d:DuelState,e:EngineOptions,now:number,winnerId:string|null){
  if(d.purpose!=='BOUNTY')return;
  if(r.party!.duelHistory.some(old=>old.id===d.id&&old.purpose==='BOUNTY'&&old.bountyId===d.bountyId))return;
  const bounty=activeBounty(r,d.bountyId);requireRule(bounty.duelId===d.id,'BOUNTY_DUEL_MISMATCH');
  if(winnerId===null){event(r,e,`The bounty defense draws. ${owner(r,bounty.targetId).name}'s ${bounty.streak}-win streak and bounty escrow stay unchanged.`,now,bounty.targetId);return;}
  if(winnerId===bounty.targetId){
    bounty.streak++;
    if(bounty.streak<3){event(r,e,`${owner(r,bounty.targetId).name} wins bounty defense ${bounty.streak} of 3. The bounty stays funded.`,now,bounty.targetId);return;}
    bounty.status='claimed';
  }else{requireRule(winnerId===d.inviterId,'INVALID_BOUNTY_WINNER');bounty.status='defeated';bounty.streak=0;}
  for(const contribution of bounty.contributions)requireRule(settle(owner(r,contribution.playerId).account,contribution.id,0),'BOUNTY_ALREADY_SETTLED');
  const award=bounty.status==='claimed'?bounty.total:Math.floor(85*bounty.total/100),vault=bounty.total-award,id=`${bounty.id}:award`;
  requireRule(credit(owner(r,winnerId).account,id,award),'BOUNTY_ALREADY_SETTLED');bounty.winnerId=winnerId;
  r.party!.transfers.push({id,kind:'bounty_award',amount:award,from:`BOUNTY:${bounty.id}`,to:winnerId,roundId:r.roundId});
  if(vault){r.party!.vault+=vault;r.party!.transfers.push({id:`${bounty.id}:vault`,kind:'bounty_vault',amount:vault,from:`BOUNTY:${bounty.id}`,to:'VAULT',roundId:r.roundId});}
  event(r,e,bounty.status==='claimed'?`${owner(r,winnerId).name} wins three bounty defenses and claims all ${award} escrowed chips.`:`${owner(r,winnerId).name} defeats the bounty target and receives ${award} bounty chips; the exact ${vault}-chip remainder enters the Vault.`,now,winnerId);
}

export function refundBounties(r:Room,e:EngineOptions,now:number){
  if(!r.party)return;
  const unresolved=r.party.bounties.filter(b=>b.status==='active');
  requireRule(!unresolved.some(bounty=>acceptedDefense(r,bounty)),'LIVE_BOUNTY_OBLIGATION');
  for(const bounty of unresolved){
    for(const contribution of bounty.contributions){
      requireRule(settle(owner(r,contribution.playerId).account,contribution.id,contribution.amount),'BOUNTY_ALREADY_SETTLED');
      r.party.transfers.push({id:`${contribution.id}:refund`,kind:'bounty_refund',amount:contribution.amount,from:`BOUNTY:${bounty.id}`,to:contribution.playerId,roundId:r.roundId});
    }
    bounty.status='refunded';event(r,e,`${owner(r,bounty.targetId).name}'s unresolved ${bounty.total}-chip bounty is refunded to its original contributors.`,now);
  }
}
export function projectBounties(r:Room):BountyView[]{return structuredClone(r.party?.bounties??[]);}

export function assertBounties(r:Room){
  if(!r.party)return;const ids=new Set<string>(),activeTargets=new Set<string>(),intervalTargets=new Set<string>();
  for(const bounty of r.party.bounties){
    requireRule(!ids.has(bounty.id)&&r.players.some(p=>p.id===bounty.targetId&&p.participating),'BOUNTY_ID_INVARIANT');ids.add(bounty.id);
    requireRule(['active','claimed','defeated','refunded'].includes(bounty.status)&&Number.isSafeInteger(bounty.total)&&bounty.total>=50&&bounty.total<=1000&&bounty.total===bounty.contributions.reduce((sum,c)=>sum+c.amount,0),'BOUNTY_TOTAL_INVARIANT');
    requireRule(Number.isInteger(bounty.streak)&&bounty.streak>=0&&bounty.streak<=3&&(bounty.status!=='active'||bounty.streak<3)&&(bounty.status!=='claimed'||bounty.streak===3)&&(bounty.status!=='defeated'||bounty.streak===0),'BOUNTY_STREAK_INVARIANT');
    requireRule(new Set(bounty.defendedIntervalIds).size===bounty.defendedIntervalIds.length,'BOUNTY_DEFENSE_INVARIANT');
    const defenses=r.party.duelHistory.filter(d=>d.purpose==='BOUNTY'&&d.bountyId===bounty.id),live=r.party.social?.duel;
    if(live?.purpose==='BOUNTY'&&live.bountyId===bounty.id&&!defenses.some(d=>d.id===live.id))defenses.push(live);
    requireRule(defenses.length===bounty.defendedIntervalIds.length&&defenses.every(d=>d.amount===50&&d.defenderId===bounty.targetId&&typeof d.socialId==='string'&&!!d.socialId&&(d.slot===1||d.slot===2)&&bounty.defendedIntervalIds.includes(d.socialId)),'BOUNTY_DEFENSE_HISTORY_INVARIANT');
    requireRule(defenses.length?bounty.duelId===defenses.at(-1)!.id:bounty.duelId===undefined,'BOUNTY_LATEST_DUEL_INVARIANT');
    let streak=0,defeated=false;
    for(const d of defenses){
      const key=`${d.socialId}:${bounty.targetId}`;requireRule(!intervalTargets.has(key),'BOUNTY_INTERVAL_TARGET_INVARIANT');intervalTargets.add(key);
      requireRule(!defeated&&streak<3,'BOUNTY_CLOSED_DEFENSE_INVARIANT');
      if(d.status==='settled'&&d.winnerId!==null){if(d.winnerId===bounty.targetId)streak++;else{requireRule(d.winnerId===d.inviterId,'BOUNTY_WINNER_INVARIANT');streak=0;defeated=true;}}
    }
    requireRule(bounty.streak===streak&&(bounty.status==='claimed')===(streak===3)&&(bounty.status==='defeated')===defeated,'BOUNTY_STREAK_HISTORY_INVARIANT');
    if(bounty.status==='active'){requireRule(!activeTargets.has(bounty.targetId),'BOUNTY_TARGET_INVARIANT');activeTargets.add(bounty.targetId);}
    for(const contribution of bounty.contributions){
      requireRule(!ids.has(contribution.id)&&validAmount(contribution.amount)&&contribution.playerId!==bounty.targetId&&r.players.some(p=>p.id===contribution.playerId&&p.participating),'BOUNTY_CONTRIBUTION_INVARIANT');ids.add(contribution.id);
      const account=owner(r,contribution.playerId).account;
      requireRule(!Object.hasOwn(account.reservations,contribution.id),'BOUNTY_RESERVATION_INVARIANT');
      if(bounty.status==='active')requireRule(account.escrows[contribution.id]===contribution.amount&&!Object.hasOwn(account.settlements,contribution.id),'BOUNTY_ESCROW_INVARIANT');
      else requireRule(!Object.hasOwn(account.escrows,contribution.id)&&account.settlements[contribution.id]===(bounty.status==='refunded'?contribution.amount:0),'BOUNTY_SETTLEMENT_INVARIANT');
      const refunds=r.party.transfers.filter(t=>t.id===`${contribution.id}:refund`);
      if(bounty.status==='refunded')requireRule(refunds.length===1&&refunds[0]!.kind==='bounty_refund'&&refunds[0]!.amount===contribution.amount&&refunds[0]!.from===`BOUNTY:${bounty.id}`&&refunds[0]!.to===contribution.playerId,'BOUNTY_REFUND_TRANSFER_INVARIANT');
      else requireRule(refunds.length===0,'BOUNTY_UNEXPECTED_REFUND_INVARIANT');
    }
    const awards=r.party.transfers.filter(t=>t.id===`${bounty.id}:award`),vaultTransfers=r.party.transfers.filter(t=>t.id===`${bounty.id}:vault`);
    if(bounty.status==='claimed'||bounty.status==='defeated'){
      const award=bounty.status==='claimed'?bounty.total:Math.floor(85*bounty.total/100);
      const expectedWinner=bounty.status==='claimed'?bounty.targetId:defenses.at(-1)!.inviterId,vault=bounty.total-award;
      requireRule(bounty.winnerId===expectedWinner&&owner(r,expectedWinner).account.settlements[`${bounty.id}:award`]===award,'BOUNTY_AWARD_INVARIANT');
      requireRule(awards.length===1&&awards[0]!.kind==='bounty_award'&&awards[0]!.amount===award&&awards[0]!.from===`BOUNTY:${bounty.id}`&&awards[0]!.to===expectedWinner,'BOUNTY_AWARD_TRANSFER_INVARIANT');
      if(vault)requireRule(vaultTransfers.length===1&&vaultTransfers[0]!.kind==='bounty_vault'&&vaultTransfers[0]!.amount===vault&&vaultTransfers[0]!.from===`BOUNTY:${bounty.id}`&&vaultTransfers[0]!.to==='VAULT','BOUNTY_VAULT_TRANSFER_INVARIANT');
      else requireRule(vaultTransfers.length===0,'BOUNTY_VAULT_TRANSFER_INVARIANT');
    }else requireRule(awards.length===0&&vaultTransfers.length===0&&!bounty.winnerId,'BOUNTY_UNEXPECTED_AWARD_INVARIANT');
  }
}
