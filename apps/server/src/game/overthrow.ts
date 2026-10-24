import type {BallotView,Command} from '@bluff-house/shared';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';
import {cancelSocialInvites,refreshSocialDeadline,startDuel} from './duels.js';
import {cancelDealOffers} from './deals.js';

const connected=(r:Room)=>r.players.filter(p=>p.participating&&p.connected&&!p.departed);
export const overthrowThreshold=(eligible:number)=>Math.ceil(eligible*0.75);
function event(r:Room,e:EngineOptions,text:string,now:number,playerId?:string){r.events.push({id:e.id(),kind:'house',text,at:now,playerId,revision:r.revision+1});r.events=r.events.slice(-60);}
function archive(r:Room,b:BallotView){if(!r.party!.overthrowHistory.some(old=>old.id===b.id))r.party!.overthrowHistory.push(structuredClone(b));}
export function failBallot(r:Room,e:EngineOptions,now:number,reason:string){
  const ballot=r.party?.social?.ballot;if(!ballot||ballot.status!=='open')return;
  ballot.status='failed';ballot.reason=reason;archive(r,ballot);event(r,e,reason,now);
}
export function settleLastStand(r:Room,e:EngineOptions,now:number,winnerId:string|null,reason:string){
  const ballot=r.party?.social?.ballot;requireRule(ballot&&(ballot.status==='selecting'||ballot.status==='playing'),'LAST_STAND_CLOSED');
  const retained=winnerId!==ballot.challengerId;
  if(!retained){r.party!.houseId=ballot.challengerId!;r.party!.houseSinceRound=r.round;}
  ballot.status='settled';ballot.winnerId=retained?ballot.houseId:ballot.challengerId;ballot.reason=reason;archive(r,ballot);
  const name=r.players.find(p=>p.id===ballot.winnerId)!.name;
  event(r,e,`${name} ${retained?'retains':'takes'} the House crown. ${reason}`,now,ballot.winnerId);
}
export function resolveBallot(r:Room,e:EngineOptions,now:number){
  const social=r.party!.social!,ballot=social.ballot!;
  requireRule(ballot.status==='open','BALLOT_CLOSED');
  requireRule(ballot.votes.filter(v=>v.yes).length>=ballot.requiredVotes,'BALLOT_THRESHOLD');
  if(r.terminationConfirmed||connected(r).length<2){failBallot(r,e,now,'Too few connected players remain to start a Last Stand. The House retains the crown.');refreshSocialDeadline(r);return;}
  const affirmative=new Set(ballot.votes.filter(v=>v.yes).map(v=>v.playerId));
  const candidates=connected(r).filter(p=>affirmative.has(p.id));
  if(!candidates.length){failBallot(r,e,now,'No affirmative voter remains connected. The House retains the crown.');refreshSocialDeadline(r);return;}
  requireRule(now+8000+60000+2000<=social.hardDeadline,'INSUFFICIENT_SOCIAL_TIME');
  const index=e.randomIndex(candidates.length);requireRule(Number.isInteger(index)&&index>=0&&index<candidates.length,'INVALID_RANDOM_INDEX');
  ballot.challengerId=candidates[index].id;ballot.status='selecting';ballot.deadline=now+8000;
  cancelSocialInvites(r);cancelDealOffers(r);r.phase='LAST_STAND_CHOICE';r.deadline=ballot.deadline;
  event(r,e,`Overthrow passes. ${candidates[index].name} challenges the House in a zero-stake Last Stand. The House has eight seconds to choose a game.`,now,ballot.challengerId);
}
export function overthrowCommand(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  const party=r.party,social=party?.social;requireRule(r.mode==='PARTY'&&party&&social,'SOCIAL_CLOSED');
  requireRule(c.socialId===social.id,'STALE_SOCIAL');requireRule(p.participating&&p.connected&&!p.departed,'NOT_PARTICIPATING');
  if(c.type==='house:ballot'){
    requireRule(c.socialSlotId===social.slotId,'STALE_SOCIAL_SLOT','This social admission slot has changed.');
    requireRule(r.phase==='SOCIAL'&&!social.duel&&!social.deal&&now<social.admissionDeadline,'ADMISSION_CLOSED');
    requireRule(!r.terminationConfirmed&&connected(r).length>=2,'NOT_ENOUGH_PLAYERS');
    requireRule(party.houseId&&p.id!==party.houseId,'NOT_ELIGIBLE_VOTER');
    requireRule(r.round>=party.houseSinceRound+1,'HOUSE_TENURE');requireRule(!social.ballot,'BALLOT_ALREADY_USED');
    const ids=connected(r).filter(candidate=>candidate.id!==party.houseId).map(candidate=>candidate.id);
    requireRule(ids.includes(p.id)&&ids.length>0,'NOT_ELIGIBLE_VOTER');
    social.ballot={id:e.id(),houseId:party.houseId,eligibleVoterIds:ids,requiredVotes:overthrowThreshold(ids.length),votes:[],deadline:Math.min(now+10000,social.admissionDeadline),status:'open'};
    event(r,e,`${p.name} opens an overthrow ballot. ${social.ballot.requiredVotes} of ${ids.length} frozen eligible voters must vote yes.`,now,p.id);refreshSocialDeadline(r);return;
  }
  const ballot=social.ballot;requireRule(ballot&&c.ballotId===ballot.id,'STALE_BALLOT');
  if(c.type==='house:vote'){
    requireRule(r.phase==='SOCIAL'&&ballot.status==='open'&&now<ballot.deadline,'BALLOT_CLOSED');
    requireRule(ballot.eligibleVoterIds.includes(p.id),'NOT_ELIGIBLE_VOTER');requireRule(!ballot.votes.some(v=>v.playerId===p.id),'VOTE_LOCKED');
    const yes=c.payload?.yes;requireRule(typeof yes==='boolean','INVALID_VOTE');ballot.votes.push({playerId:p.id,yes});
    if(ballot.votes.filter(v=>v.yes).length>=ballot.requiredVotes)resolveBallot(r,e,now);else refreshSocialDeadline(r);return;
  }
  requireRule(c.type==='house:choose'&&r.phase==='LAST_STAND_CHOICE'&&ballot.status==='selecting'&&now<ballot.deadline,'LAST_STAND_CLOSED');
  requireRule(p.id===ballot.houseId&&party.houseId===p.id,'NOT_HOUSE');
  requireRule(!r.terminationConfirmed&&connected(r).length>=2,'NOT_ENOUGH_PLAYERS');
  const challenger=connected(r).find(candidate=>candidate.id===ballot.challengerId);requireRule(challenger,'CHALLENGER_UNAVAILABLE');
  const game=c.payload?.game;requireRule(game==='RPS'||game==='COIN'||game==='CONNECT4'||game==='CHESS','INVALID_GAME');
  const side=c.payload?.coinSide;requireRule(game!=='COIN'||side==='HEADS'||side==='TAILS','INVALID_COIN_SIDE');
  requireRule(now+60000+2000<=social.hardDeadline,'INSUFFICIENT_SOCIAL_TIME');
  ballot.status='playing';
  startDuel(r,e,now,{id:e.id(),game,purpose:'LAST_STAND',ballotId:ballot.id,inviterId:challenger.id,defenderId:p.id,amount:0},side as 'HEADS'|'TAILS'|undefined);
}
/** Existing selection obligations resolve even after a recovery timeout. */
export function overthrowDeadline(r:Room,e:EngineOptions,at:number){
  const ballot=r.party?.social?.ballot;if(!ballot)return;
  if(ballot.status==='open'&&at>=ballot.deadline){
    if(ballot.votes.filter(v=>v.yes).length>=ballot.requiredVotes)resolveBallot(r,e,at);
    else failBallot(r,e,at,'The overthrow ballot expired without the required votes.');
    return;
  }
  if(ballot.status==='selecting'&&at>=ballot.deadline){
    const challenger=connected(r).some(p=>p.id===ballot.challengerId);
    settleLastStand(r,e,at,challenger?ballot.challengerId!:ballot.houseId,challenger?'The House did not choose a game before the selection deadline.':'The selected challenger is unavailable. The House retains the crown.');
    r.phase='DUEL_RESULT';r.deadline=Math.min(at+2000,r.party!.social!.hardDeadline);
  }
}
export function assertBallots(r:Room){
  const party=r.party;if(!party)return;
  requireRule(Number.isInteger(party.houseSinceRound)&&party.houseSinceRound>=0&&party.houseSinceRound<=r.round,'HOUSE_TENURE_INVARIANT');
  const history=new Set<string>();
  for(const b of party.overthrowHistory){requireRule(!history.has(b.id)&&(b.status==='failed'||b.status==='settled'),'BALLOT_HISTORY_INVARIANT');history.add(b.id);}
  const ballots=[...party.overthrowHistory,...(party.social?.ballot&&!history.has(party.social.ballot.id)?[party.social.ballot]:[])];
  for(const b of ballots){
    const eligible=new Set(b.eligibleVoterIds);requireRule(eligible.size===b.eligibleVoterIds.length&&eligible.size>0&&!eligible.has(b.houseId)&&r.players.some(p=>p.id===b.houseId)&&b.eligibleVoterIds.every(id=>r.players.some(p=>p.id===id&&p.participating)),'BALLOT_ELIGIBILITY_INVARIANT');
    requireRule(b.requiredVotes===overthrowThreshold(eligible.size),'BALLOT_THRESHOLD_INVARIANT');
    requireRule(new Set(b.votes.map(v=>v.playerId)).size===b.votes.length&&b.votes.every(v=>eligible.has(v.playerId)&&typeof v.yes==='boolean'),'BALLOT_VOTE_INVARIANT');
    if(b.status==='selecting'||b.status==='playing'||b.status==='settled')requireRule(b.votes.filter(v=>v.yes).length>=b.requiredVotes&&b.votes.some(v=>v.yes&&v.playerId===b.challengerId),'BALLOT_CHALLENGER_INVARIANT');
    if(b.status==='settled')requireRule(b.winnerId===b.houseId||b.winnerId===b.challengerId,'BALLOT_WINNER_INVARIANT');
  }
  const social=party.social,ballot=social?.ballot;
  if(ballot?.status==='open')requireRule(r.phase==='SOCIAL'&&!social!.duel&&!social!.deal&&ballot.deadline<=social!.admissionDeadline,'LIVE_BALLOT_INVARIANT');
  if(ballot?.status==='selecting')requireRule(r.phase==='LAST_STAND_CHOICE'&&!social!.duel&&!social!.deal&&ballot.deadline+62000<=social!.hardDeadline,'LAST_STAND_SELECTION_INVARIANT');
  if(ballot?.status==='playing')requireRule(r.phase==='DUEL'&&social!.duel?.purpose==='LAST_STAND'&&social!.duel.ballotId===ballot.id,'LIVE_LAST_STAND_INVARIANT');
}
