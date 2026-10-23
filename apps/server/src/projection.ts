import {type RoomView} from '@bluff-house/shared';
import {evaluate} from './game/cards.js';
import {available,reserved} from './game/ledger.js';
import type {Room} from './game/state.js';

export function project(r:Room,viewerId:string,serverInstanceId:string,now:number):RoomView {
  return {serverInstanceId,instanceId:r.instanceId,code:r.code,revision:r.revision,lobbyId:r.lobbyId,viewerId,hostId:r.hostId,phase:r.phase,
    players:r.players.map(p=>({id:p.id,name:p.name,seat:p.seat,connected:p.connected,departed:p.departed,ready:p.ready,balance:p.account.balance,reserved:reserved(p.account),available:available(p.account),committed:Object.values(p.account.escrows).reduce((a,b)=>a+b,0),hand:p.hand.map(c=>({...c})),value:p.hand.length?evaluate(p.hand):null,status:p.status,bluffUsed:p.bluffUsed,bluffWins:p.bluffWins,bluffLosses:p.bluffLosses})),
    matchId:r.matchId,roundId:r.roundId,round:r.round,deadline:r.deadline,serverTime:now,
    decisionId:r.activePlayerId===viewerId?r.decisionId:undefined,bettingId:r.bettingId,activePlayerId:r.activePlayerId,
    dealer:r.dealer.map((c,i)=>i===0||r.dealerRevealed?{...c}:null),dealerValue:r.dealerRevealed&&r.dealer.length?evaluate(r.dealer):null,
    bluff:r.bluff?structuredClone(r.bluff):null,events:r.events.map(ev=>({...ev})),results:r.results?structuredClone(r.results):null,recoveryDeadline:r.recoveryDeadline};
}
