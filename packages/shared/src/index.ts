export const RULES = { startingChips:1000, minBet:50, maxBet:250, maxPlayers:6, rounds:3, bettingMs:20000, decisionMs:20000, offerMs:8000, revealMs:2000, dealingMs:1000, dealerMs:350, resultMs:4000, recoveryMs:60000 } as const;
export const EMOJIS = ['😂','😱','🔥','👀','💀','👑'] as const;
export const VOICE_STATUS = {available:false,status:'CONNECTIVITY_UNVERIFIED',message:'Room voice is unavailable while device and network connectivity remain unverified. No microphone is requested.'} as const;
export type Suit = 'S'|'H'|'D'|'C';
export type Rank = 'A'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'10'|'J'|'Q'|'K';
export interface Card { id:string; rank:Rank; suit:Suit }
export interface HandValue { total:number; soft:boolean; bust:boolean; natural:boolean }
export type GameMode = 'CLASSIC'|'PARTY';
export interface RoomSettings {maxPlayers:number;house:boolean;duels:boolean;overthrow:boolean;chaos:boolean;bounties:boolean;deals:boolean;doubleDown:boolean;extraClaims:boolean}
export function defaultSettings(mode:GameMode):RoomSettings {const enabled=mode==='PARTY';return {maxPlayers:6,house:enabled,duels:enabled,overthrow:enabled,chaos:enabled,bounties:enabled,deals:enabled,doubleDown:enabled,extraClaims:enabled};}
export type ProfileColor = 'GOLD'|'RUBY'|'EMERALD'|'SAPPHIRE'|'VIOLET'|'CORAL';
export type BadgeId = 'HOUSEBREAKER'|'BOUNTY_HUNTER'|'MASTER_BLUFFER'|'VAULT_THIEF'|'UNTOUCHABLE'|'BETRAYER'|'HIGH_ROLLER'|'COMEBACK_KING';
export interface BadgeRule {id:BadgeId;name:string;description:string}
export interface EarnedBadge {id:BadgeId;earnedAt:number;evidence:{matchId:string;eventId:string;description:string}}
export interface ProfileView {initials:string;color:ProfileColor;badges:EarnedBadge[];progress:{acceptedBluffWins:number;masterBlufferTarget:5};lifetime:'guest-session'}
export interface MatchStats {playerId:string;blackjackWins:number;blackjackLosses:number;blackjackPushes:number;blackjackNet:number;bluffWins:number;bluffLosses:number;bluffNet:number;duelWins:number;duelLosses:number;duelDraws:number;duelNet:number;bountyAwarded:number;dealsPlayed:number;cooperations:number;loneSteals:number;dealNet:number;vaultWon:number;houseReigns:number;bountiesClaimed:number;vaultVictories:number}
export interface ChatMessage {id:string;playerId:string;username:string;text:string;at:number}
export type Phase = 'LOBBY'|'HOUSE_AUCTION'|'HOUSE_REVEAL'|'BETTING'|'POT_TWIST'|'DEALING'|'HAND_CHAOS'|'PLAYER_TURN'|'BLUFF_OFFER'|'BLUFF_REVEAL'|'DEALER_TURN'|'ROUND_RESULT'|'SOCIAL'|'LAST_STAND_CHOICE'|'DUEL'|'DUEL_RESULT'|'DEAL'|'DEAL_RESULT'|'SHADOW_DRAW'|'SHADOW_CLAIM'|'SHADOW_CHALLENGE'|'SHADOW_RESULT'|'WAITING_FOR_PLAYERS'|'RESULTS';
export interface PlayerView {
  id:string; name:string; seat:number; connected:boolean; departed:boolean; ready:boolean;
  balance:number; reserved:number; available:number; committed:number; wager:number;
  hand:Card[]; value:HandValue|null; status:string; bluffUsed:boolean; bluffWins:number; bluffLosses:number;
  profile:ProfileView;
  doubled:boolean;doubleEligible:boolean;doubleReason:string;
}
export type ClaimType = 'NEXT_HIT_SAFE'|'NEXT_HIT_EXACT_21'|'BEAT_DEALER'|'THREE_CARD_WIN'|'DEALER_BUST';
export interface ClaimRule {type:ClaimType;label:string;timing:'IMMEDIATE'|'ROUND_RESULT';help:string}
export interface ClaimEvidence {playerTotal:number;playerCardCount:number;playerNatural:boolean;playerBust:boolean;claimTrue:boolean;dealerTotal?:number;dealerNatural?:boolean;dealerBust?:boolean;playerOutcome?:'blackjack'|'win'|'push'|'loss'}
export interface BluffView { id:string; claimantId:string; challengerId?:string; amount:number; deadline:number; status:'open'|'accepted'|'expired'|'cancelled'; card?:Card; winnerId?:string; pot?:number;claimType?:ClaimType;timing?:'IMMEDIATE'|'ROUND_RESULT';settlement?:'pending'|'settled';roundId?:string;evidence?:ClaimEvidence }
export interface TableEvent { id:string; kind:string; text:string; playerId?:string; at:number; revision:number }
export interface MatchResults { reason?:string; winners:string[]; standings:{id:string;name:string;balance:number;bluffWins:number;bluffLosses:number}[]; biggestBluff:BluffView|null }
export interface PartyTransfer {id:string;kind:'auction'|'commission'|'vault_distribution'|'bonus'|'bounty_award'|'bounty_vault'|'bounty_refund'|'deal_bonus'|'deal_vault'|'shadow_award';amount:number;from:string;to:string;roundId?:string}
export interface AuctionView {id:string;deadline:number;status:'open'|'revealed';bids:{playerId:string;submitted:boolean;amount?:number}[];winnerId:string|null;winningBid:number|null}
export type DuelGame = 'RPS'|'COIN'|'CONNECT4'|'CHESS';
export type RpsChoice = 'ROCK'|'PAPER'|'SCISSORS';
export type CoinSide = 'HEADS'|'TAILS';
export interface BountyContribution {id:string;playerId:string;amount:number}
export interface BountyView {id:string;targetId:string;total:number;streak:number;status:'active'|'claimed'|'defeated'|'refunded';contributions:BountyContribution[];defendedIntervalIds:string[];duelId?:string;winnerId?:string}
export interface DuelInvite {id:string;inviterId:string;defenderId:string;amount:number;deadline:number;status:'pending'|'accepted'|'rejected'|'expired'|'cancelled';purpose?:'BOUNTY';bountyId?:string;slot?:1|2}
export interface RpsThrow {number:number;choices:Record<string,RpsChoice|null>;winnerId:string|null}
export interface Connect4View {cells:(string|null)[][];firstPlayerId:string;activePlayerId:string;moveId:string}
export interface ChessMove {from:string;to:string;promotion?:string}
export interface ChessView {fen:string;board:{square:string;piece:string;color:'w'|'b'}[];whiteId:string;blackId:string;turnId:string;moveId:string;remainingMs:Record<string,number>;clockStartedAt:number;check:boolean;legalMoves:ChessMove[];lastMove?:ChessMove}
export interface BallotView {id:string;houseId:string;eligibleVoterIds:string[];requiredVotes:number;votes:{playerId:string;yes:boolean}[];deadline:number;status:'open'|'selecting'|'playing'|'failed'|'settled';challengerId?:string;winnerId?:string;reason?:string}
export interface DuelView {id:string;socialId?:string;slot?:1|2;game:DuelGame;purpose?:'LAST_STAND'|'BOUNTY';ballotId?:string;bountyId?:string;inviterId:string;defenderId:string;amount:number;status:'playing'|'settled';startedAt:number;hardDeadline:number;deadline:number;throwId?:string;throwNumber:number;scores:Record<string,number>;lockedPlayerIds:string[];ownChoice?:RpsChoice;throws:RpsThrow[];coinSide?:CoinSide;coinResult?:CoinSide;connect4?:Connect4View;chess?:ChessView;winnerId:string|null;reason?:string}
export type DealChoice = 'SPLIT'|'STEAL';
export interface DealOffer {id:string;inviterId:string;defenderId:string;amount:number;deadline:number;status:'pending'|'accepted'|'rejected'|'expired'|'cancelled';slot:1|2}
export interface DealView {id:string;socialId:string;slot:1|2;inviterId:string;defenderId:string;amount:number;status:'choosing'|'settled';startedAt:number;deadline:number;lockedPlayerIds:string[];ownChoice?:DealChoice;choices?:Record<string,DealChoice>;defaultedPlayerIds:string[];bonusEach:number;returns:Record<string,number>;vaultAmount:number;reason?:string}
export interface ShadowClaim {id:string;claimantId:string;declaredTotal:17|18|19|20|21;status:'open'|'unchallenged'|'truthful'|'caught';deadline:number;challengerId?:string}
export interface ShadowEntrantView {playerId:string;seat:number;hand:(Card|null)[];value:HandValue|null;locked:boolean;drew:boolean;revealed:boolean;claimDone:boolean;disqualified?:boolean;baseTotal?:number;claimBonus?:number;challengePoints?:number;score?:number|null}
export interface ShadowView {id:string;status:'drawing'|'claiming'|'challenging'|'settled';pot:number;entrantIds:string[];entrants:ShadowEntrantView[];activePlayerId:string|null;decisionId:string|null;deadline:number|null;claim:ShadowClaim|null;claims:ShadowClaim[];winnerIds:string[];awards:{playerId:string;amount:number}[];fallback:boolean;vaultThiefIds:string[]}
export interface SocialView {id:string;slotId:string;openedAt:number;slot:1|2;slotOpenedAt:number;admissionDeadline:number;hardDeadline:number;invites:DuelInvite[];duel:DuelView|null;dealInvites:DealOffer[];deal:DealView|null;ballot:BallotView|null}
export interface DuelStats {playerId:string;wins:number;losses:number;draws:number}
export type ChaosKind = 'DOUBLE_DOWN'|'TRIPLE_DOWN'|'POT_TWIST'|'EMERGENCY_FUND'|'HAND_SWAP'|'TABLE_TURN'|'SECOND_CHANCE';
export interface ChaosCard {id:string;kind:ChaosKind}
export interface ChaosRule {kind:ChaosKind;name:string;window:string;effect:string}
export interface PotTwistView {id:string;ownerId:string;roundId:string;status:'pending'|'open'|'closed';deadline:number|null;optedInIds:string[]}
export interface HandWindowView {id:string;deadline:number;resolved:boolean;eligibleIds:string[]}
export interface ChaosView {registry:ChaosRule[];inventories:{playerId:string;cards:ChaosCard[]}[];actions:{cardId:string;eligible:boolean;reason:string}[];usedThisRound:boolean;emergencyUsed:boolean;emergencyAmount:number;potTwist:PotTwistView|null;handWindow:HandWindowView|null;handTargets:string[];optInEligible:boolean;optInReason:string;multipliers:{playerId:string;base:number;factor:2|3;source:ChaosKind}[]}
export interface PartyView {houseId:string|null;houseSinceRound:number;overthrowHistory:BallotView[];vault:number;bonusReserve:number;initialBonusReserve:number;auction:AuctionView;transfers:PartyTransfer[];social:SocialView|null;duelHistory:DuelView[];dealHistory:DealView[];duelStats:DuelStats[];chaos:ChaosView;bounties:BountyView[];bountyOpportunities:number;shadow:ShadowView|null}
export interface RoundPayout {playerId:string;stake:number;returned:number;profit:number;houseCommission:number}
export interface RoomView {
  serverInstanceId:string; instanceId:string; code:string; revision:number; lobbyId:string; viewerId:string; hostId:string|null;
  phase:Phase; mode:GameMode; roundLimit:3|6; finaleEnabled:boolean; visibility:'PRIVATE'|'PUBLIC';settings:RoomSettings;party:PartyView|null; roundPayouts:RoundPayout[]; players:PlayerView[]; matchId?:string; roundId?:string; round:number;
  deadline:number|null; serverTime:number; decisionId?:string; bettingId?:string; activePlayerId?:string;
  dealer:(Card|null)[]; dealerValue:HandValue|null; discarded:Card[]; bluff:BluffView|null; events:TableEvent[]; results:MatchResults|null; recoveryDeadline:number|null;
  chat:ChatMessage[];badgeRegistry:BadgeRule[];matchStats:MatchStats[];
  pendingClaims:BluffView[];claimOutcomes:BluffView[];claimRegistry:ClaimRule[];
}
export type CommandType = 'room:create'|'room:join'|'room:quickplay'|'lobby:settings'|'lobby:ready'|'lobby:mode'|'lobby:rounds'|'lobby:finale'|'bounty:contribute'|'bounty:invite'|'deal:offer'|'deal:accept'|'deal:reject'|'deal:choose'|'shadow:draw'|'shadow:stand'|'shadow:claim'|'shadow:pass'|'shadow:reveal'|'shadow:challenge'|'house:bid'|'house:ballot'|'house:vote'|'house:choose'|'chaos:activate'|'chaos:optin'|'duel:invite'|'duel:reject'|'duel:accept'|'duel:choose'|'duel:move'|'duel:resign'|'match:start'|'bet:submit'|'bet:withdraw'|'turn:hit'|'turn:stand'|'turn:double'|'bluff:offer'|'bluff:accept'|'reaction:send'|'chat:send'|'profile:update'|'room:leave'|'results:return'|'state:sync';
export interface Command { requestId:string; type:CommandType; roomInstanceId?:string; lobbyId?:string; matchId?:string; roundId?:string; decisionId?:string; bettingId?:string; offerId?:string; auctionId?:string; socialId?:string; socialSlotId?:string; dealOfferId?:string; dealId?:string; shadowId?:string; shadowClaimId?:string; inviteId?:string; duelId?:string; throwId?:string; moveId?:string; ballotId?:string; chaosWindowId?:string; payload?:Record<string,unknown> }
export interface Ack { requestId:string; status:'ok'|'rejected'; code:string; message?:string; appliedRevision?:number; currentRevision:number }
export interface SessionResponse { authenticated:boolean; playerId?:string; recoverable?:boolean; serverInstanceId:string; error?:string }
export function validName(input:unknown):string|null { if(typeof input!=='string')return null; const name=input.trim(); return /^[\p{L}\p{N} _-]{2,16}$/u.test(name)?name:null; }
export function validAmount(input:unknown):input is number { return typeof input==='number' && Number.isSafeInteger(input) && input>=50 && input<=250 && input%50===0; }
