import type {BluffView, Card, MatchResults, Phase, TableEvent, GameMode, PartyTransfer, RoundPayout, DuelInvite, DuelView, RpsChoice, BallotView, ChaosCard, ChaosKind, PotTwistView, BountyView} from '@bluff-house/shared';
import type {DealView,DealChoice,DealOffer,ShadowClaim,ProfileColor,EarnedBadge,MatchStats,ChatMessage,RoomSettings,HouseRoundSettlement} from '@bluff-house/shared';
import type {Account} from './ledger.js';

export interface Player {
  id:string; name:string; seat:number; joinedAt:number; connected:boolean; departed:boolean; ready:boolean;
  disconnectedAt:number|null; account:Account; hand:Card[]; status:string; wager:number; wagerId?:string;
  participating:boolean; bluffUsed:boolean; bluffWins:number; bluffLosses:number;
  profile:ProfileState;matchStats:MatchStats;lobbyWins:number;
  doubled:boolean;chaosAffected:boolean;
}
export interface BluffState extends BluffView {acceptedOrder?:number;proof?:{hand:Card[];dealer?:Card[]}}
export interface PendingClaimState extends BluffState {lockedHands:Record<string,Card[]>}
export interface ProfileState {initials:string;color:ProfileColor;badges:EarnedBadge[];acceptedBluffWins:number;matchProgress:{matchId:string|null;bottomTwo:boolean;bottomRoundId:string|null;lastSettledRoundId:string|null}}
export interface Room {
  mode:GameMode; roundLimit:number; startingChips:number; bettingSeconds:number; turnSeconds:number; winsRecordedMatchId:string|null; lobbyWinsByPlayer:Record<string,number>; finaleEnabled:boolean;visibility:'PRIVATE'|'PUBLIC';settings:RoomSettings;party:PartyState|null; roundPayouts:RoundPayout[];
  instanceId:string; code:string; revision:number; lobbyId:string; hostId:string|null; phase:Phase; players:Player[];
  matchId?:string; roundId?:string; round:number; initialChips:number; dealerNet:number;
  shoe:Card[]; cursor:number; dealer:Card[]; dealerRevealed:boolean; discarded:Card[];
  deadline:number|null; decisionId?:string; bettingId?:string; activePlayerId?:string;
  bluff:BluffState|null; pausedRemaining:number; biggestBluff:BluffView|null; bluffOutcomes:BluffState[];pendingClaims:PendingClaimState[];
  events:TableEvent[]; results:MatchResults|null; recoveryDeadline:number|null; terminationConfirmed:boolean;
  chat:ChatMessage[];chatRates:Record<string,number[]>;
  hostDeadline:number|null; emptySince:number|null; resultsSince:number|null;
}
export interface DuelState extends Omit<DuelView,'lockedPlayerIds'|'ownChoice'> {choices:Record<string,RpsChoice>;chessPgn?:string}
export interface DealState extends Omit<DealView,'lockedPlayerIds'|'ownChoice'|'choices'> {choices:Record<string,DealChoice>}
export interface ShadowEntryState {handId:string;playerId:string;seat:number;role:'BETTOR'|'HOUSE'|'CASINO';hand:Card[];locked:boolean;revealed:boolean;claimUsed:boolean;callUsed:boolean;forcedTruth:boolean;disqualifiedReason:null|'CAUGHT_LIE'|'WRONG_CALL';effectiveTotal:number|null;acceptedBluff:boolean;turnDeadline:number|null}
export interface ShadowState {id:string;status:'betting'|'playing'|'challenging'|'settled';pot:number;entries:ShadowEntryState[];dealer:ShadowEntryState;shoe:Card[];cursor:number;dealt:boolean;finalized:boolean;activePlayerId:string|null;decisionId:string|null;deadline:number|null;claim:ShadowClaim|null;claims:ShadowClaim[];rewards:{claimId:string;playerId:string;amount:number}[];winnerIds:string[];awards:{playerId:string;amount:number}[];fallback:boolean;fallbackReason:'NONE'|'NO_LIVE_HAND'|'ALL_DISQUALIFIED';vaultThiefIds:string[]}
export interface SocialState {id:string;slotId:string;slot:1|2;slotOpenedAt:number;openedAt:number;admissionDeadline:number;hardDeadline:number;invites:DuelInvite[];duel:DuelState|null;dealInvites:DealOffer[];deal:DealState|null;ballot:BallotView|null}
export interface ChaosState {inventories:Record<string,ChaosCard[]>;usedRound:Record<string,string>;emergencyUsed:string[];grantedRounds:string[];multipliers:Record<string,{base:number;factor:2|3;source:ChaosKind}>;potTwist:PotTwistView|null;handWindow:{id:string;deadline:number;resolved:boolean}|null;ordinaryHits:Record<string,{cardId:string;decisionId:string}>}
export interface HouseBankState {initial:number;balance:number;liabilities:Record<string,{playerId:string;roundId:string;amount:number;committed:boolean}>;bond:{ownerId:string|null;amount:number;reservationId:string|null};rounds:HouseRoundSettlement[];bondHistory:{id:string;kind:'entry'|'release';ownerId:string;amount:number}[];dealerAutomated:boolean}
export interface PartyState {bank:HouseBankState;houseId:string|null;houseSinceRound:number;overthrowHistory:BallotView[];vault:number;bonusReserve:number;initialBonusReserve:number;vaultDistributed:boolean;transfers:PartyTransfer[];social:SocialState|null;socialRound:number;duelHistory:DuelState[];dealHistory:DealState[];shadow:ShadowState|null;chaos:ChaosState;bounties:BountyView[];auction:{id:string;deadline:number;status:'open'|'revealed';bids:Record<string,number>;winnerId:string|null;winningBid:number|null}}
export interface EngineOptions { now:()=>number; id:()=>string; shoe:()=>Card[]; randomIndex:(length:number)=>number }
export class GameError extends Error { constructor(public code:string,message=code){super(message);} }
export function requireRule(condition:unknown,code:string,message?:string):asserts condition {if(!condition)throw new GameError(code,message);}
