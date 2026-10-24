import {type RoomView,type DuelView} from '@bluff-house/shared';
import {evaluate} from './game/cards.js';
import {available,reserved} from './game/ledger.js';
import type {Room,DuelState} from './game/state.js';

function duelView(d:DuelState,viewerId:string):DuelView {
  // Current simultaneous choices are private; completed throws are public.
  return {id:d.id,game:d.game,inviterId:d.inviterId,defenderId:d.defenderId,amount:d.amount,status:d.status,startedAt:d.startedAt,hardDeadline:d.hardDeadline,deadline:d.deadline,throwId:d.throwId,throwNumber:d.throwNumber,scores:{...d.scores},lockedPlayerIds:Object.keys(d.choices),...(d.choices[viewerId]?{ownChoice:d.choices[viewerId]}:{}),throws:structuredClone(d.throws),coinSide:d.coinSide,coinResult:d.coinResult,connect4:d.connect4?structuredClone(d.connect4):undefined,chess:d.chess?structuredClone(d.chess):undefined,winnerId:d.winnerId,reason:d.reason};
}

export function project(r:Room,viewerId:string,serverInstanceId:string,now:number):RoomView {
  const sealed=r.phase==='HOUSE_AUCTION';
  return {serverInstanceId,instanceId:r.instanceId,code:r.code,revision:r.revision,lobbyId:r.lobbyId,viewerId,hostId:r.hostId,phase:r.phase,mode:r.mode,roundPayouts:r.roundPayouts.map(p=>({...p})),
    party:r.party?{houseId:r.party.houseId,vault:r.party.vault,bonusReserve:r.party.bonusReserve,initialBonusReserve:r.party.initialBonusReserve,transfers:r.party.transfers.map(t=>({...t})),auction:{id:r.party.auction.id,deadline:r.party.auction.deadline,status:r.party.auction.status,winnerId:r.party.auction.winnerId,winningBid:r.party.auction.winningBid,bids:r.players.filter(p=>p.participating).map(p=>({playerId:p.id,submitted:Object.hasOwn(r.party!.auction.bids,p.id),...(!sealed||p.id===viewerId?{amount:r.party!.auction.bids[p.id]??0}:{})}))},social:r.party.social?{id:r.party.social.id,openedAt:r.party.social.openedAt,admissionDeadline:r.party.social.admissionDeadline,hardDeadline:r.party.social.hardDeadline,invites:r.party.social.invites.map(i=>({...i})),duel:r.party.social.duel?duelView(r.party.social.duel,viewerId):null}:null,duelHistory:r.party.duelHistory.map(d=>duelView(d,viewerId)),duelStats:r.players.filter(p=>p.participating).map(p=>{const history=r.party!.duelHistory.filter(d=>d.inviterId===p.id||d.defenderId===p.id);return {playerId:p.id,wins:history.filter(d=>d.winnerId===p.id).length,losses:history.filter(d=>d.winnerId!==null&&d.winnerId!==p.id).length,draws:history.filter(d=>d.winnerId===null).length};})}:null,
    players:r.players.map(p=>({id:p.id,name:p.name,seat:p.seat,connected:p.connected,departed:p.departed,ready:p.ready,balance:p.account.balance,reserved:sealed&&p.id!==viewerId?0:reserved(p.account),available:sealed&&p.id!==viewerId?p.account.balance:available(p.account),committed:Object.values(p.account.escrows).reduce((a,b)=>a+b,0),hand:p.hand.map(c=>({...c})),value:p.hand.length?evaluate(p.hand):null,status:p.status,bluffUsed:p.bluffUsed,bluffWins:p.bluffWins,bluffLosses:p.bluffLosses})),
    matchId:r.matchId,roundId:r.roundId,round:r.round,deadline:r.deadline,serverTime:now,
    decisionId:r.activePlayerId===viewerId?r.decisionId:undefined,bettingId:r.bettingId,activePlayerId:r.activePlayerId,
    dealer:r.dealer.map((c,i)=>i===0||r.dealerRevealed?{...c}:null),dealerValue:r.dealerRevealed&&r.dealer.length?evaluate(r.dealer):null,
    bluff:r.bluff?structuredClone(r.bluff):null,events:r.events.map(ev=>({...ev})),results:r.results?structuredClone(r.results):null,recoveryDeadline:r.recoveryDeadline};
}
