export const RULES = { startingChips:1000, minBet:50, maxBet:250, maxPlayers:6, rounds:3, bettingMs:20000, decisionMs:20000, offerMs:8000, revealMs:2000, dealingMs:1000, dealerMs:350, resultMs:4000, recoveryMs:60000 } as const;
export const EMOJIS = ['😂','😱','🔥','👀','💀','👑'] as const;
export type Suit = 'S'|'H'|'D'|'C';
export type Rank = 'A'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K';
export interface Card { id:string; rank:Rank; suit:Suit }
export interface HandValue { total:number; soft:boolean; bust:boolean; natural:boolean }
export type GameMode = 'CLASSIC'|'PARTY';
export type Phase = 'LOBBY'|'HOUSE_AUCTION'|'HOUSE_REVEAL'|'BETTING'|'POT_TWIST'|'DEALING'|'HAND_CHAOS'|'PLAYER_TURN'|'BLUFF_OFFER'|'BLUFF_REVEAL'|'DEALER_TURN'|'ROUND_RESULT'|'SOCIAL'|'LAST_STAND_CHOICE'|'DUEL'|'DUEL_RESULT'|'WAITING_FOR_PLAYERS'|'RESULTS';
export interface PlayerView {
  id:string; name:string; seat:number; connected:boolean; departed:boolean; ready:boolean;
  balance:number; reserved:number; available:number; committed:number; wager:number;
  hand:Card[]; value:HandValue|null; status:string; bluffUsed:boolean; bluffWins:number; bluffLosses:number;
}
export interface BluffView { id:string; claimantId:string; challengerId?:string; amount:number; deadline:number; status:'open'|'accepted'|'expired'|'cancelled'; card?:Card; winnerId?:string; pot?:number }
export interface TableEvent { id:string; kind:string; text:string; playerId?:string; at:number; revision:number }
export interface MatchResults { reason?:string; winners:string[]; standings:{id:string;name:string;balance:number;bluffWins:number;bluffLosses:number}[]; biggestBluff:BluffView|null }
export interface PartyTransfer {id:string;kind:'auction'|'commission'|'vault_distribution'|'bonus';amount:number;from:string;to:string;roundId?:string}
export interface AuctionView {id:string;deadline:number;status:'open'|'revealed';bids:{playerId:string;submitted:boolean;amount?:number}[];winnerId:string|null;winningBid:number|null}
export type DuelGame = 'RPS'|'COIN'|'CONNECT4'|'CHESS';
export type RpsChoice = 'ROCK'|'PAPER'|'SCISSORS';
export type CoinSide = 'HEADS'|'TAILS';
export interface DuelInvite {id:string;inviterId:string;defenderId:string;amount:number;deadline:number;status:'pending'|'accepted'|'rejected'|'expired'|'cancelled'}
export interface RpsThrow {number:number;choices:Record<string,RpsChoice|null>;winnerId:string|null}
export interface Connect4View {cells:(string|null)[][];firstPlayerId:string;activePlayerId:string;moveId:string}
export interface ChessMove {from:string;to:string;promotion?:string}
export interface ChessView {fen:string;board:{square:string;piece:string;color:'w'|'b'}[];whiteId:string;blackId:string;turnId:string;moveId:string;remainingMs:Record<string,number>;clockStartedAt:number;check:boolean;legalMoves:ChessMove[];lastMove?:ChessMove}
export interface BallotView {id:string;houseId:string;eligibleVoterIds:string[];requiredVotes:number;votes:{playerId:string;yes:boolean}[];deadline:number;status:'open'|'selecting'|'playing'|'failed'|'settled';challengerId?:string;winnerId?:string;reason?:string}
export interface DuelView {id:string;game:DuelGame;purpose?:'LAST_STAND';ballotId?:string;inviterId:string;defenderId:string;amount:number;status:'playing'|'settled';startedAt:number;hardDeadline:number;deadline:number;throwId?:string;throwNumber:number;scores:Record<string,number>;lockedPlayerIds:string[];ownChoice?:RpsChoice;throws:RpsThrow[];coinSide?:CoinSide;coinResult?:CoinSide;connect4?:Connect4View;chess?:ChessView;winnerId:string|null;reason?:string}
export interface SocialView {id:string;openedAt:number;admissionDeadline:number;hardDeadline:number;invites:DuelInvite[];duel:DuelView|null;ballot:BallotView|null}
export interface DuelStats {playerId:string;wins:number;losses:number;draws:number}
export type ChaosKind = 'DOUBLE_DOWN'|'TRIPLE_DOWN'|'POT_TWIST'|'EMERGENCY_FUND'|'HAND_SWAP'|'TABLE_TURN'|'SECOND_CHANCE';
export interface ChaosCard {id:string;kind:ChaosKind}
export interface ChaosRule {kind:ChaosKind;name:string;window:string;effect:string}
export interface PotTwistView {id:string;ownerId:string;roundId:string;status:'pending'|'open'|'closed';deadline:number|null;optedInIds:string[]}
export interface HandWindowView {id:string;deadline:number;resolved:boolean;eligibleIds:string[]}
export interface ChaosView {registry:ChaosRule[];inventories:{playerId:string;cards:ChaosCard[]}[];actions:{cardId:string;eligible:boolean;reason:string}[];usedThisRound:boolean;emergencyUsed:boolean;emergencyAmount:number;potTwist:PotTwistView|null;handWindow:HandWindowView|null;handTargets:string[];optInEligible:boolean;optInReason:string;multipliers:{playerId:string;base:number;factor:2|3;source:ChaosKind}[]}
export interface PartyView {houseId:string|null;houseSinceRound:number;overthrowHistory:BallotView[];vault:number;bonusReserve:number;initialBonusReserve:number;auction:AuctionView;transfers:PartyTransfer[];social:SocialView|null;duelHistory:DuelView[];duelStats:DuelStats[];chaos:ChaosView}
export interface RoundPayout {playerId:string;stake:number;returned:number;profit:number;houseCommission:number}
export interface RoomView {
  serverInstanceId:string; instanceId:string; code:string; revision:number; lobbyId:string; viewerId:string; hostId:string|null;
  phase:Phase; mode:GameMode; party:PartyView|null; roundPayouts:RoundPayout[]; players:PlayerView[]; matchId?:string; roundId?:string; round:number;
  deadline:number|null; serverTime:number; decisionId?:string; bettingId?:string; activePlayerId?:string;
  dealer:(Card|null)[]; dealerValue:HandValue|null; discarded:Card[]; bluff:BluffView|null; events:TableEvent[]; results:MatchResults|null; recoveryDeadline:number|null;
}
export type CommandType = 'room:create'|'room:join'|'lobby:ready'|'lobby:mode'|'house:bid'|'house:ballot'|'house:vote'|'house:choose'|'chaos:activate'|'chaos:optin'|'duel:invite'|'duel:reject'|'duel:accept'|'duel:choose'|'duel:move'|'duel:resign'|'match:start'|'bet:submit'|'bet:withdraw'|'turn:hit'|'turn:stand'|'bluff:offer'|'bluff:accept'|'reaction:send'|'room:leave'|'results:return'|'state:sync';
export interface Command { requestId:string; type:CommandType; roomInstanceId?:string; lobbyId?:string; matchId?:string; roundId?:string; decisionId?:string; bettingId?:string; offerId?:string; auctionId?:string; socialId?:string; inviteId?:string; duelId?:string; throwId?:string; moveId?:string; ballotId?:string; chaosWindowId?:string; payload?:Record<string,unknown> }
export interface Ack { requestId:string; status:'ok'|'rejected'; code:string; message?:string; appliedRevision?:number; currentRevision:number }
export interface SessionResponse { authenticated:boolean; playerId?:string; recoverable?:boolean; serverInstanceId:string; error?:string }
export function validName(input:unknown):string|null { if(typeof input!=='string')return null; const name=input.trim(); return /^[\p{L}\p{N} _-]{2,16}$/u.test(name)?name:null; }
export function validAmount(input:unknown):input is number { return typeof input==='number' && Number.isSafeInteger(input) && input>=50 && input<=250 && input%50===0; }
