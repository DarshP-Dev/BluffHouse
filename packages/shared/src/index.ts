export const RULES = { startingChips:1000, minBet:50, maxBet:250, maxPlayers:6, rounds:3, bettingMs:20000, decisionMs:20000, offerMs:8000, revealMs:2000, dealingMs:1000, dealerMs:350, resultMs:4000, recoveryMs:60000 } as const;
export const EMOJIS = ['😂','😱','🔥','👀','💀','👑'] as const;
export type Suit = 'S'|'H'|'D'|'C';
export type Rank = 'A'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K';
export interface Card { id:string; rank:Rank; suit:Suit }
export interface HandValue { total:number; soft:boolean; bust:boolean; natural:boolean }
export type Phase = 'LOBBY'|'BETTING'|'DEALING'|'PLAYER_TURN'|'BLUFF_OFFER'|'BLUFF_REVEAL'|'DEALER_TURN'|'ROUND_RESULT'|'WAITING_FOR_PLAYERS'|'RESULTS';
export interface PlayerView {
  id:string; name:string; seat:number; connected:boolean; departed:boolean; ready:boolean;
  balance:number; reserved:number; available:number; committed:number;
  hand:Card[]; value:HandValue|null; status:string; bluffUsed:boolean; bluffWins:number; bluffLosses:number;
}
export interface BluffView { id:string; claimantId:string; challengerId?:string; amount:number; deadline:number; status:'open'|'accepted'|'expired'|'cancelled'; card?:Card; winnerId?:string; pot?:number }
export interface TableEvent { id:string; kind:string; text:string; playerId?:string; at:number; revision:number }
export interface MatchResults { reason?:string; winners:string[]; standings:{id:string;name:string;balance:number;bluffWins:number;bluffLosses:number}[]; biggestBluff:BluffView|null }
export interface RoomView {
  serverInstanceId:string; instanceId:string; code:string; revision:number; lobbyId:string; viewerId:string; hostId:string|null;
  phase:Phase; players:PlayerView[]; matchId?:string; roundId?:string; round:number;
  deadline:number|null; serverTime:number; decisionId?:string; bettingId?:string; activePlayerId?:string;
  dealer:(Card|null)[]; dealerValue:HandValue|null; bluff:BluffView|null; events:TableEvent[]; results:MatchResults|null; recoveryDeadline:number|null;
}
export type CommandType = 'room:create'|'room:join'|'lobby:ready'|'match:start'|'bet:submit'|'bet:withdraw'|'turn:hit'|'turn:stand'|'bluff:offer'|'bluff:accept'|'reaction:send'|'room:leave'|'results:return'|'state:sync';
export interface Command { requestId:string; type:CommandType; roomInstanceId?:string; lobbyId?:string; matchId?:string; roundId?:string; decisionId?:string; bettingId?:string; offerId?:string; payload?:Record<string,unknown> }
export interface Ack { requestId:string; status:'ok'|'rejected'; code:string; message?:string; appliedRevision?:number; currentRevision:number }
export interface SessionResponse { authenticated:boolean; playerId?:string; recoverable?:boolean; serverInstanceId:string; error?:string }
export function validName(input:unknown):string|null { if(typeof input!=='string')return null; const name=input.trim(); return /^[\p{L}\p{N} _-]{2,16}$/u.test(name)?name:null; }
export function validAmount(input:unknown):input is number { return typeof input==='number' && Number.isSafeInteger(input) && input>=50 && input<=250 && input%50===0; }
