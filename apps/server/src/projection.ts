import {type RoomView,type DuelView,type PartyView} from '@bluff-house/shared';
import {evaluate} from './game/cards.js';
import {available,reserved} from './game/ledger.js';
import type {Room,DuelState} from './game/state.js';
import {projectChaos} from './game/chaos.js';
import {projectBounties,remainingBountyIntervals} from './game/bounties.js';
import {projectDeal,projectDealHistory} from './game/deals.js';
import {projectShadow} from './game/shadow.js';
import {projectProfile} from './game/profiles.js';
import {ACHIEVEMENTS,projectMatchStats} from './game/achievements.js';
import {CLAIM_RULES,projectClaim} from './game/claims.js';
import {projectBank,maximumBackedBet} from './game/house-bank.js';
import {doubleReason} from './game/blackjack.js';

function duelView(d:DuelState,viewerId:string):DuelView {
  // Current simultaneous choices are private; completed throws are public.
  return {id:d.id,socialId:d.socialId,slot:d.slot,game:d.game,purpose:d.purpose,ballotId:d.ballotId,bountyId:d.bountyId,inviterId:d.inviterId,defenderId:d.defenderId,amount:d.amount,status:d.status,startedAt:d.startedAt,hardDeadline:d.hardDeadline,deadline:d.deadline,throwId:d.throwId,throwNumber:d.throwNumber,scores:{...d.scores},lockedPlayerIds:Object.keys(d.choices),...(d.choices[viewerId]?{ownChoice:d.choices[viewerId]}:{}),throws:structuredClone(d.throws),coinSide:d.coinSide,coinResult:d.coinResult,connect4:d.connect4?structuredClone(d.connect4):undefined,chess:d.chess?structuredClone(d.chess):undefined,winnerId:d.winnerId,reason:d.reason};
}

function partyView(r:Room,viewerId:string,sealed:boolean,now:number):PartyView|null {
  const party=r.party;if(!party)return null;
  const chaos=projectChaos(r,viewerId);
  if(!r.settings.chaos){chaos.actions=chaos.actions.map(action=>({...action,eligible:false,reason:'Chaos cards are disabled for this match.'}));chaos.optInEligible=false;chaos.optInReason='Chaos cards are disabled for this match.';chaos.handTargets=[];chaos.handWindow=null;}
  return {
    bank:projectBank(r),houseId:party.houseId,houseSinceRound:party.houseSinceRound,overthrowHistory:structuredClone(party.overthrowHistory),
    chaos,bounties:projectBounties(r),bountyOpportunities:r.settings.bounties?remainingBountyIntervals(r):0,
    vault:party.vault,bonusReserve:party.bonusReserve,initialBonusReserve:party.initialBonusReserve,transfers:party.transfers.map(t=>({...t})),
    auction:{id:party.auction.id,deadline:party.auction.deadline,status:party.auction.status,winnerId:party.auction.winnerId,winningBid:party.auction.winningBid,bids:r.players.filter(p=>p.participating).map(p=>({playerId:p.id,submitted:Object.hasOwn(party.auction.bids,p.id),...(!sealed||p.id===viewerId?{amount:party.auction.bids[p.id]??0}:{})}))},
    social:party.social?{id:party.social.id,slotId:party.social.slotId,slot:party.social.slot,slotOpenedAt:party.social.slotOpenedAt,openedAt:party.social.openedAt,admissionDeadline:party.social.admissionDeadline,hardDeadline:party.social.hardDeadline,invites:party.social.invites.map(i=>({...i})),dealInvites:party.social.dealInvites.map(i=>({...i})),deal:party.social.deal?projectDeal(party.social.deal,viewerId):null,duel:party.social.duel?duelView(party.social.duel,viewerId):null,ballot:party.social.ballot?structuredClone(party.social.ballot):null}:null,
    duelHistory:party.duelHistory.map(d=>duelView(d,viewerId)),
    dealHistory:projectDealHistory(r,viewerId),
    shadow:projectShadow(r,viewerId,now),
    duelStats:r.players.filter(p=>p.participating).map(p=>{const history=party.duelHistory.filter(d=>d.inviterId===p.id||d.defenderId===p.id);return {playerId:p.id,wins:history.filter(d=>d.winnerId===p.id).length,losses:history.filter(d=>d.winnerId!==null&&d.winnerId!==p.id).length,draws:history.filter(d=>d.winnerId===null).length};})
  };
}

export function project(r:Room,viewerId:string,serverInstanceId:string,now:number):RoomView {
  const sealed=r.phase==='HOUSE_AUCTION';
  const shadow=r.party?.shadow,activePlayerId=shadow?shadow.activePlayerId??undefined:r.activePlayerId,decisionId=shadow?shadow.decisionId??undefined:r.decisionId;
  const ownDealer=r.party?.houseId===viewerId,manualDealer=r.phase==='DEALER_TURN'&&ownDealer&&!r.party!.bank.dealerAutomated&&r.activePlayerId===viewerId;
  const me=r.players.find(p=>p.id===viewerId);
  return {backedMaxBet:me?maximumBackedBet(r,me):0,dealerControls:{ownerId:r.party?.houseId??null,canHit:manualDealer&&evaluate(r.dealer).total<21,canStand:manualDealer&&evaluate(r.dealer).total<21,automated:!!r.party?.bank.dealerAutomated},serverInstanceId,instanceId:r.instanceId,code:r.code,revision:r.revision,lobbyId:r.lobbyId,viewerId,hostId:r.hostId,phase:r.phase,mode:r.mode,roundLimit:r.roundLimit,startingChips:r.startingChips,bettingSeconds:r.bettingSeconds,turnSeconds:r.turnSeconds,finaleEnabled:r.finaleEnabled,visibility:r.visibility,settings:{maxPlayers:r.settings.maxPlayers,house:r.settings.house,duels:r.settings.duels,overthrow:r.settings.overthrow,chaos:r.settings.chaos,bounties:r.settings.bounties,deals:r.settings.deals,doubleDown:r.settings.doubleDown,extraClaims:r.settings.extraClaims},roundPayouts:r.roundPayouts.map(p=>({...p})),
    pendingClaims:r.pendingClaims.map(projectClaim),claimOutcomes:r.bluffOutcomes.map(projectClaim),claimRegistry:CLAIM_RULES.filter(rule=>rule.type==='NEXT_HIT_SAFE'||r.mode==='PARTY'&&r.settings.extraClaims).map(rule=>({...rule})),
    party:partyView(r,viewerId,sealed,now),chat:r.chat.map(message=>({...message})),badgeRegistry:ACHIEVEMENTS.map(rule=>({...rule})),matchStats:projectMatchStats(r),
    players:r.players.map(p=>({doubled:p.doubled,doubleEligible:!doubleReason(r,p),doubleReason:doubleReason(r,p)??'Fund one equal extra stake, draw once, then stand.',profile:projectProfile(p.profile),id:p.id,name:p.name,seat:p.seat,connected:p.connected,departed:p.departed,ready:p.ready,balance:p.account.balance,reserved:sealed&&p.id!==viewerId?0:reserved(p.account),available:sealed&&p.id!==viewerId?p.account.balance:available(p.account),committed:Object.values(p.account.escrows).reduce((a,b)=>a+b,0),wager:p.wager,hand:p.hand.map(c=>({...c})),value:p.hand.length?evaluate(p.hand):null,status:p.status,bluffUsed:p.bluffUsed,bluffWins:p.bluffWins,bluffLosses:p.bluffLosses,lobbyWins:p.lobbyWins})),
    matchId:r.matchId,roundId:r.roundId,round:r.round,deadline:r.deadline,serverTime:now,
    decisionId:activePlayerId===viewerId?decisionId:undefined,bettingId:r.bettingId,activePlayerId,
    dealer:r.dealer.map((c,i)=>i===0||r.dealerRevealed||ownDealer?{...c}:null),dealerValue:(r.dealerRevealed||ownDealer)&&r.dealer.length?evaluate(r.dealer):null,discarded:r.discarded.map(c=>({...c})),
    bluff:r.bluff?projectClaim(r.bluff):null,events:r.events.map(ev=>({...ev})),results:r.results?{reason:r.results.reason,winners:[...r.results.winners],standings:r.results.standings.map(p=>({...p})),biggestBluff:r.results.biggestBluff?projectClaim(r.results.biggestBluff):null}:null,recoveryDeadline:r.recoveryDeadline};
}
