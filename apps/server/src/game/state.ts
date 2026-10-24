import type {BluffView, Card, MatchResults, Phase, TableEvent, GameMode, PartyTransfer, RoundPayout, DuelInvite, DuelView, RpsChoice, BallotView, ChaosCard, ChaosKind, PotTwistView, BountyView} from '@bluff-house/shared';
import type {DealView,DealChoice,DealOffer} from '@bluff-house/shared';
import type {Account} from './ledger.js';

export interface Player {
  id:string; name:string; seat:number; joinedAt:number; connected:boolean; departed:boolean; ready:boolean;
  disconnectedAt:number|null; account:Account; hand:Card[]; status:string; wager:number; wagerId?:string;
  participating:boolean; bluffUsed:boolean; bluffWins:number; bluffLosses:number;
}
export interface Room {
  mode:GameMode; roundLimit:3|6; party:PartyState|null; roundPayouts:RoundPayout[];
  instanceId:string; code:string; revision:number; lobbyId:string; hostId:string|null; phase:Phase; players:Player[];
  matchId?:string; roundId?:string; round:number; initialChips:number; dealerNet:number;
  shoe:Card[]; cursor:number; dealer:Card[]; dealerRevealed:boolean; discarded:Card[];
  deadline:number|null; decisionId?:string; bettingId?:string; activePlayerId?:string;
  bluff:BluffView|null; pausedRemaining:number; biggestBluff:BluffView|null; bluffOutcomes:BluffView[];
  events:TableEvent[]; results:MatchResults|null; recoveryDeadline:number|null; terminationConfirmed:boolean;
  hostDeadline:number|null; emptySince:number|null; resultsSince:number|null;
}
export interface DuelState extends Omit<DuelView,'lockedPlayerIds'|'ownChoice'> {choices:Record<string,RpsChoice>;chessPgn?:string}
export interface DealState extends Omit<DealView,'lockedPlayerIds'|'ownChoice'|'choices'> {choices:Record<string,DealChoice>}
export interface SocialState {id:string;slotId:string;slot:1|2;slotOpenedAt:number;openedAt:number;admissionDeadline:number;hardDeadline:number;invites:DuelInvite[];duel:DuelState|null;dealInvites:DealOffer[];deal:DealState|null;ballot:BallotView|null}
export interface ChaosState {inventories:Record<string,ChaosCard[]>;usedRound:Record<string,string>;emergencyUsed:string[];grantedRounds:string[];multipliers:Record<string,{base:number;factor:2|3;source:ChaosKind}>;potTwist:PotTwistView|null;handWindow:{id:string;deadline:number;resolved:boolean}|null;ordinaryHits:Record<string,{cardId:string;decisionId:string}>}
export interface PartyState {houseId:string|null;houseSinceRound:number;overthrowHistory:BallotView[];vault:number;bonusReserve:number;initialBonusReserve:number;vaultDistributed:boolean;transfers:PartyTransfer[];social:SocialState|null;socialRound:number;duelHistory:DuelState[];dealHistory:DealState[];chaos:ChaosState;bounties:BountyView[];auction:{id:string;deadline:number;status:'open'|'revealed';bids:Record<string,number>;winnerId:string|null;winningBid:number|null}}
export interface EngineOptions { now:()=>number; id:()=>string; shoe:()=>Card[]; randomIndex:(length:number)=>number }
export class GameError extends Error { constructor(public code:string,message=code){super(message);} }
export function requireRule(condition:unknown,code:string,message?:string):asserts condition {if(!condition)throw new GameError(code,message);}
