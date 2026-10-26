import {RULES,defaultSettings,validBetAmount,type Command,type MatchResults} from '@bluff-house/shared';
import {account,assertAccount,reserve,release,commit,settle,increaseEscrow} from './ledger.js';
import {evaluate} from './cards.js';
import {payout,dealerShouldHit,doubleReason} from './blackjack.js';
import {CLAIM_RULES,settlePendingClaims,assertClaims,isDeferredClaim} from './claims.js';
import {offerBluff,acceptBluff,cancelBluff} from './bluff.js';
import {startAuction,closeAuction,submitBid,distributeVault} from './house.js';
import {openSocial,duelCommand,socialDeadline,closeSocial,assertDuels} from './duels.js';
import {overthrowCommand} from './overthrow.js';
import {grantChaos,resetChaosRound,chaosCommand,openPotTwist,closePotTwist,clearWagerEffect,assertChaos,canAffordNextRound} from './chaos.js';
import {openHandWindow,markOrdinaryHit,clearOrdinaryHit} from './chaos-hands.js';
import {bountyCommand,refundBounties,assertBounties} from './bounties.js';
import {dealCommand,dealsDeadline,assertDeals} from './deals.js';
import {startShadow,shadowCommand,shadowDeadline,assertShadow} from './shadow.js';
import {defaultProfile,assertProfiles} from './profiles.js';
import {defaultMatchStats} from './achievements.js';
import {assertChat} from './chat.js';
import {assertSettings,hasEligibleSocial} from './settings.js';
import {isHouse,reserveLiability,releaseLiability,commitLiability,settleBankRound,releaseHouseBond,bankAvailable,assertHouseBank} from './house-bank.js';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';

export function addEvent(r:Room,e:EngineOptions,kind:string,text:string,at:number,playerId?:string){
  r.events.push({id:e.id(),kind,text,at,playerId,revision:r.revision+1});
  r.events=r.events.slice(-60);
}
export function makePlayer(id:string,name:string,seat:number,now:number):Player {
  return {id,name,seat,joinedAt:now,connected:true,departed:false,ready:false,disconnectedAt:null,account:account(),hand:[],status:'waiting',wager:0,participating:false,bluffUsed:false,bluffWins:0,bluffLosses:0,doubled:false,chaosAffected:false,profile:defaultProfile(name,seat),matchStats:defaultMatchStats(id),lobbyWins:0};
}
export function createRoom(code:string,player:Player,e:EngineOptions):Room {
  return {chat:[],chatRates:{},mode:'CLASSIC',roundLimit:3,startingChips:RULES.startingChips,bettingSeconds:RULES.bettingMs/1000,turnSeconds:RULES.decisionMs/1000,winsRecordedMatchId:null,lobbyWinsByPlayer:{},finaleEnabled:false,visibility:'PRIVATE',settings:defaultSettings('CLASSIC'),party:null,roundPayouts:[],instanceId:e.id(),code,revision:0,lobbyId:e.id(),hostId:player.id,phase:'LOBBY',players:[player],round:0,initialChips:0,dealerNet:0,shoe:[],cursor:0,discarded:[],dealer:[],dealerRevealed:false,deadline:null,bluff:null,pausedRemaining:0,biggestBluff:null,bluffOutcomes:[],pendingClaims:[],events:[],results:null,recoveryDeadline:null,terminationConfirmed:false,hostDeadline:null,emptySince:null,resultsSince:null};
}
export function connected(r:Room){return r.players.filter(p=>p.connected&&!p.departed&&(r.phase==='LOBBY'||p.participating));}
export function active(r:Room):Player {const p=r.players.find(p=>p.id===r.activePlayerId);requireRule(p,'NO_ACTIVE_PLAYER');return p;}
export function draw(r:Room){const card=r.shoe[r.cursor];requireRule(card,'SHOE_EXHAUSTED');r.cursor++;return card;}
export function startRound(r:Room,e:EngineOptions,now:number){
  r.round++;r.roundId=e.id();r.bettingId=e.id();r.phase='BETTING';r.deadline=now+r.bettingSeconds*1000;
  resetChaosRound(r);
  r.roundPayouts=[];
  r.decisionId=undefined;r.activePlayerId=undefined;r.dealer=[];r.dealerRevealed=false;r.shoe=[];r.cursor=0;r.discarded=[];r.bluff=null;
  if(r.party)r.party.bank.dealerAutomated=false;
  for(const p of r.players){p.hand=[];p.status=isHouse(r,p)?'dealer':p.participating?'waiting':'observer';p.wager=0;p.wagerId=undefined;p.bluffUsed=false;p.doubled=false;p.chaosAffected=false;}
  addEvent(r,e,'round',`Round ${r.round} · Place your wagers`,now);
}
export function startMatch(r:Room,e:EngineOptions,now:number){
  const players=connected(r);requireRule(players.length>=2,'NOT_ENOUGH_PLAYERS','At least two connected players are needed.');
  requireRule(players.every(p=>p.ready),'NOT_READY','Everyone connected must be ready.');
  r.matchId=e.id();r.round=0;r.initialChips=players.length*r.startingChips;r.dealerNet=0;r.results=null;r.resultsSince=null;r.biggestBluff=null;r.bluffOutcomes=[];r.pendingClaims=[];r.terminationConfirmed=false;r.recoveryDeadline=null;
  // Absent lobby guests are not participants in this new match.
  for(const p of r.players){p.participating=p.connected&&!p.departed;p.account=account(r.startingChips);p.bluffWins=0;p.bluffLosses=0;}
  r.party=null;r.roundPayouts=[];
  if(r.mode==='PARTY'){
    startAuction(r,e,now);
    if(r.settings.house)addEvent(r,e,'house','The sealed House auction is open. Bids stay private until reveal.',now);else{addEvent(r,e,'house','House is disabled. Party accounting remains available for the funded Vault and bonus reserve.',now);startRound(r,e,now);}
  }else startRound(r,e,now);
}
export function freshDecision(r:Room,e:EngineOptions,now:number,duration:number=r.turnSeconds*1000){if(r.activePlayerId)clearOrdinaryHit(r,r.activePlayerId);r.phase='PLAYER_TURN';r.decisionId=e.id();r.deadline=now+duration;}
export function nextTurn(r:Room,e:EngineOptions,now:number){
  const next=r.players.find(p=>p.participating&&p.status==='playing');
  if(next){r.activePlayerId=next.id;freshDecision(r,e,now);return;}
  r.activePlayerId=undefined;r.decisionId=undefined;r.phase='DEALER_TURN';
  const house=r.party?.houseId?r.players.find(p=>p.id===r.party!.houseId):undefined;
  if(house?.connected&&!house.departed&&!r.party!.bank.dealerAutomated){r.activePlayerId=house.id;r.decisionId=e.id();r.deadline=now+r.turnSeconds*1000;}else{if(r.party)r.party.bank.dealerAutomated=true;r.dealerRevealed=true;r.deadline=now+RULES.dealerMs;}
}
export function finishHit(r:Room,e:EngineOptions,now:number){
  const p=active(r),v=evaluate(p.hand);
  if(v.total>=21){p.status=v.bust?'bust':'stood';nextTurn(r,e,now);}else freshDecision(r,e,now);
}
export function settleRound(r:Room,e:EngineOptions,now:number){
  if(r.party?.bank.rounds.some(item=>item.roundId===r.roundId))return;
  r.dealerRevealed=true;
  const outcomes=[...r.players].sort((a,b)=>a.seat-b.seat).filter(p=>p.wagerId&&p.wager&&!isHouse(r,p)).map(p=>({p,result:payout(p.hand,r.dealer,p.wager)}));
  if(r.party){const existing=r.party.bank.rounds.some(item=>item.roundId===r.roundId);if(!existing){
    for(const {p,result} of outcomes){requireRule(settle(p.account,p.wagerId!,result.returned),'DUPLICATE_ROUND_SETTLEMENT');p.status=result.outcome;r.roundPayouts.push({playerId:p.id,stake:p.wager,returned:result.returned,profit:result.profit,houseCommission:0});addEvent(r,e,'settlement',`${p.name}: ${result.outcome} · ${result.profit>=0?'+':''}${result.profit} chips`,now,p.id);}
    const record=settleBankRound(r,outcomes.reduce((n,item)=>n+Math.max(0,-item.result.profit),0),outcomes.reduce((n,item)=>n+Math.max(0,item.result.profit),0))!;
    addEvent(r,e,'bank',`Dealer net ${record.net>=0?'+':''}${record.net}. Bond loss ${record.bondLoss}; Bank loss ${record.bankLoss}; Bank recovery ${record.recovery}; House earnings ${record.houseEarnings}.`,now,r.party.houseId??undefined);
  }}else for(const {p,result} of outcomes)if(settle(p.account,p.wagerId!,result.returned)){r.dealerNet+=result.profit;p.status=result.outcome;r.roundPayouts.push({playerId:p.id,stake:p.wager,returned:result.returned,profit:result.profit,houseCommission:0});addEvent(r,e,'settlement',`${p.name}: ${result.outcome} · ${result.profit>=0?'+':''}${result.profit} chips`,now,p.id);}
  settlePendingClaims(r,e,now);
  r.phase='ROUND_RESULT';r.deadline=now+RULES.resultMs;r.activePlayerId=undefined;r.decisionId=undefined;
  if(r.settings.chaos)grantChaos(r,e,now);
}
export function results(r:Room,e:EngineOptions,now:number,reason?:string){
  closeSocial(r);
  releaseHouseBond(r,`${r.matchId}:final-bond-release`);
  refundBounties(r,e,now);
  const vault=r.party?.vault??0;distributeVault(r);if(vault)addEvent(r,e,'vault',`The ${vault}-chip Vault is shared among all original participants, with remainder chips in seat order.`,now);
  const standings=r.players.filter(p=>p.participating).map(p=>({id:p.id,name:p.name,balance:p.account.balance,bluffWins:p.bluffWins,bluffLosses:p.bluffLosses})).sort((a,b)=>b.balance-a.balance);
  const result:MatchResults={reason,standings,winners:standings.filter(p=>p.balance===standings[0]?.balance).map(p=>p.id),biggestBluff:r.biggestBluff};
  if(r.winsRecordedMatchId!==r.matchId){for(const winner of r.players.filter(p=>result.winners.includes(p.id)))winner.lobbyWins++;for(const player of r.players)if(player.lobbyWins)r.lobbyWinsByPlayer[player.id]=player.lobbyWins;r.winsRecordedMatchId=r.matchId!;}
  r.results=result;r.phase='RESULTS';r.deadline=null;r.recoveryDeadline=null;r.resultsSince=now;r.activePlayerId=undefined;r.decisionId=undefined;
  addEvent(r,e,'results',reason?`Match ended early: ${reason}`:`${r.roundLimit} rounds. One table. Final standings are in.`,now);
}
export function roundBoundary(r:Room,e:EngineOptions,now:number){
  if(r.party?.houseId&&r.players.find(p=>p.id===r.party!.houseId)?.departed){releaseHouseBond(r,`${r.matchId}:${r.roundId}:departed-bond-release`);r.party.houseId=null;}
  if(r.terminationConfirmed){results(r,e,now,'Too few connected players after the recovery window.');return;}
  if(r.round>=r.roundLimit){refundBounties(r,e,now);if(!startShadow(r,e,now))results(r,e,now);return;}
  if(r.party&&bankAvailable(r)<1){results(r,e,now,'The finite Table Bank cannot back another wager.');return;}
  if(connected(r).length<2){r.phase='WAITING_FOR_PLAYERS';r.deadline=null;return;}
  if(!canAffordNextRound(r)){results(r,e,now,r.party?'No connected bettor can fund the minimum wager.':'Fewer than two connected players can afford the minimum wager.');return;}
  if(r.party&&r.round>0&&r.party.socialRound<r.round&&hasEligibleSocial(r)){openSocial(r,e,now);return;}
  startRound(r,e,now);
}
function commitBetsAndDeal(r:Room,e:EngineOptions,at:number){
  let wagers=0;
  for(const p of r.players){if(p.wagerId&&p.wager){commit(p.account,p.wagerId);commitLiability(r,p);p.status='playing';wagers++;}else p.status=isHouse(r,p)?'dealer':p.participating?'skipped':'observer';}
  if(!wagers){addEvent(r,e,'round','No wagers were placed.',at);settleRound(r,e,at);return;}
  r.shoe=e.shoe();r.cursor=0;
  for(let pass=0;pass<2;pass++){for(const p of r.players)if(p.status==='playing')p.hand.push(draw(r));r.dealer.push(draw(r));}
  r.phase='DEALING';r.deadline=at+RULES.dealingMs;
}
export function deadlineTransition(r:Room,e:EngineOptions,at:number){
  switch(r.phase){
    case 'HOUSE_AUCTION': closeAuction(r,e);r.phase='HOUSE_REVEAL';r.deadline=at+RULES.revealMs;addEvent(r,e,'house',r.party!.houseId?`${r.players.find(p=>p.id===r.party!.houseId)!.name} becomes the House. ${r.party!.auction.winningBid} chips enter the Vault.`:'Everyone passed. No House this match.',at);break;
    case 'HOUSE_REVEAL': roundBoundary(r,e,at);break;
    case 'BETTING': if(!r.settings.chaos||!openPotTwist(r,at))commitBetsAndDeal(r,e,at);break;
    case 'POT_TWIST': closePotTwist(r);commitBetsAndDeal(r,e,at);break;
    case 'DEALING': {
      for(const p of r.players)if(p.hand.length&&evaluate(p.hand).natural)p.status='natural';
      if(evaluate(r.dealer).natural)settleRound(r,e,at);else if(!r.settings.chaos||!openHandWindow(r,e,at))nextTurn(r,e,at);break;
    }
    case 'HAND_CHAOS': nextTurn(r,e,at);break;
    case 'PLAYER_TURN': {const p=active(r);clearOrdinaryHit(r,p.id);p.status='stood';addEvent(r,e,'timeout',`${p.name} automatically stands.`,at,p.id);nextTurn(r,e,at);break;}
    case 'BLUFF_OFFER': cancelBluff(r,e,at,'expired');addEvent(r,e,'bluff','Nobody called. Reserved chips returned; no card drawn.',at);break;
    case 'BLUFF_REVEAL': if(r.bluff?.settlement==='pending'&&isDeferredClaim(r.bluff.claimType!))freshDecision(r,e,at,Math.max(5000,r.pausedRemaining));else finishHit(r,e,at);break;
    case 'DEALER_TURN': {if(r.party)r.party.bank.dealerAutomated=true;r.activePlayerId=undefined;r.decisionId=undefined;r.dealerRevealed=true;if(dealerShouldHit(r.dealer)){r.dealer.push(draw(r));r.deadline=at+RULES.dealerMs;}else settleRound(r,e,at);break;}
    case 'ROUND_RESULT': roundBoundary(r,e,at);break;
    case 'DEAL': dealsDeadline(r,e,at);break;
    case 'SHADOW_BETTING':case 'SHADOW_TURN':case 'SHADOW_CHALLENGE':case 'SHADOW_RESULT': if(shadowDeadline(r,e,at))results(r,e,at);break;
    case 'SOCIAL':case 'LAST_STAND_CHOICE':case 'DUEL':case 'DUEL_RESULT':case 'DEAL_RESULT': if(socialDeadline(r,e,at)){closeSocial(r);roundBoundary(r,e,at);}break;
    default: requireRule(false,'INVALID_PHASE_DEADLINE');
  }
}
export function gameCommand(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  if(c.type.startsWith('deal:'))requireRule(r.settings.deals,'DEALS_DISABLED','Split or Steal is disabled for this match.');
  if(c.type.startsWith('bounty:'))requireRule(r.settings.bounties,'BOUNTIES_DISABLED','Bounties are disabled for this match.');
  if(c.type.startsWith('chaos:'))requireRule(r.settings.chaos,'CHAOS_DISABLED','Chaos cards are disabled for this match.');
  if(c.type.startsWith('duel:'))requireRule(r.settings.duels,'DUELS_DISABLED','Duels are disabled for this match.');
  if(c.type==='house:bid')requireRule(r.settings.house,'HOUSE_DISABLED','The House auction is disabled for this match.');
  if(c.type==='house:ballot'||c.type==='house:vote'||c.type==='house:choose')requireRule(r.settings.overthrow,'OVERTHROW_DISABLED','House overthrow is disabled for this match.');
  switch(c.type){
    case 'shadow:draw':case 'shadow:drawclaim':case 'shadow:stand':case 'shadow:claim':case 'shadow:pass':case 'shadow:reveal':case 'shadow:challenge':shadowCommand(r,p,c,e,now);break;
    case 'deal:offer':case 'deal:accept':case 'deal:reject':case 'deal:choose':dealCommand(r,p,c,e,now);break;
    case 'bounty:contribute':case 'bounty:invite':bountyCommand(r,p,c,e,now);break;
    case 'chaos:activate':case 'chaos:optin':chaosCommand(r,p,c,e,now);break;
    case 'house:ballot':case 'house:vote':case 'house:choose':overthrowCommand(r,p,c,e,now);break;
    case 'duel:invite':case 'duel:reject':case 'duel:accept':case 'duel:choose':case 'duel:move':case 'duel:resign':duelCommand(r,p,c,e,now);break;
    case 'house:bid': submitBid(r,p,c);break;
    case 'bluff:offer': offerBluff(r,p,c,e,now);clearOrdinaryHit(r,p.id);addEvent(r,e,'bluff',`${p.name}: “${CLAIM_RULES.find(rule=>rule.type===r.bluff!.claimType)!.label}.” ${r.bluff!.amount} chips to call.`,now,p.id);break;
    case 'bluff:accept': {
      acceptBluff(r,p,c,e,now);
      if(r.bluff!.settlement==='pending')addEvent(r,e,'bluff',`Both ${r.bluff!.amount}-chip stakes are committed. This claim settles with the dealer result; no card is forced.`,now);
      else {const winner=r.players.find(p=>p.id===r.bluff!.winnerId)!;addEvent(r,e,'bluff',`${winner.name} wins the ${r.bluff!.pot}-chip bluff pot (+${r.bluff!.amount} net).`,now,winner.id);}break;
    }
    case 'bet:submit': case 'bet:withdraw': {
      requireRule((r.phase==='BETTING'||r.phase==='SHADOW_BETTING')&&c.bettingId===r.bettingId,'STALE_BETTING','Betting is closed or this round has changed.');
      requireRule(p.participating,'NOT_PARTICIPATING');if(r.phase==='SHADOW_BETTING')requireRule(!r.terminationConfirmed&&r.party?.shadow?.entries.some(entry=>entry.playerId===p.id),'SHADOW_BETTING_CLOSED');requireRule(!isHouse(r,p),'HOUSE_CANNOT_BET','The House plays the dealer hand.');
      clearWagerEffect(r,p);
      if(c.type==='bet:submit'){const amount=c.payload?.amount;requireRule(validBetAmount(amount),'INVALID_AMOUNT','Choose a positive whole-chip wager you can fund.');const id=p.wagerId??`${r.roundId}:${p.id}:blackjack`;reserveLiability(r,p,amount);reserve(p.account,id,amount);p.wagerId=id;p.wager=amount;}
      else {releaseLiability(r,p);if(p.wagerId)release(p.account,p.wagerId);p.wager=0;p.wagerId=undefined;}
      break;
    }
    case 'dealer:hit':case 'dealer:stand':{
      requireRule(r.mode==='PARTY'&&r.party&&isHouse(r,p),'NOT_HOUSE');requireRule(r.phase==='DEALER_TURN'&&r.activePlayerId===p.id&&!r.party.bank.dealerAutomated,'DEALER_DECISION_CLOSED');requireRule(c.decisionId===r.decisionId&&r.deadline!==null&&now<r.deadline,'STALE_DECISION');
      const value=evaluate(r.dealer);requireRule(!value.bust&&value.total<21,'DEALER_HAND_FINISHED');
      if(c.type==='dealer:hit'){r.dealer.push(draw(r));const next=evaluate(r.dealer);if(next.bust||next.total===21)settleRound(r,e,now);else{r.decisionId=e.id();r.deadline=now+r.turnSeconds*1000;}}
      else settleRound(r,e,now);break;
    }
    case 'turn:double': {
      const reason=doubleReason(r,p);requireRule(!reason,'DOUBLE_UNAVAILABLE',reason??undefined);
      requireRule(c.decisionId===r.decisionId,'STALE_DECISION');
      reserveLiability(r,p,p.wager*2);increaseEscrow(p.account,p.wagerId!,p.wager);p.wager*=2;p.doubled=true;
      clearOrdinaryHit(r,p.id);p.hand.push(draw(r));p.status=evaluate(p.hand).bust?'bust':'stood';
      addEvent(r,e,'double',`${p.name} doubles to ${p.wager} funded chips, takes exactly one card, and stands.`,now,p.id);nextTurn(r,e,now);break;
    }
    case 'turn:hit':case 'turn:stand': {
      requireRule(r.phase==='PLAYER_TURN','PHASE_LOCKED','Wait for your next Blackjack decision.');
      requireRule(r.activePlayerId===p.id,'NOT_YOUR_TURN');requireRule(c.decisionId===r.decisionId,'STALE_DECISION','This decision has already changed.');
      if(c.type==='turn:hit'){p.hand.push(draw(r));finishHit(r,e,now);if(r.settings.chaos)markOrdinaryHit(r,p);}else {clearOrdinaryHit(r,p.id);p.status='stood';nextTurn(r,e,now);}break;
    }
    default: requireRule(false,'UNAVAILABLE_ACTION','This action is not available.');
  }
}
export function assertRoom(r:Room){
  assertSettings(r);assertHouseBank(r);
  assertClaims(r);
  assertProfiles(r);assertChat(r);
  requireRule(Number.isSafeInteger(r.roundLimit)&&r.roundLimit>=1&&r.roundLimit<=20&&typeof r.finaleEnabled==='boolean'&&(r.mode==='PARTY'||!r.finaleEnabled),'ROUND_LIMIT_INVARIANT');
  assertChaos(r);
  assertDuels(r);
  assertBounties(r);
  assertDeals(r);
  assertShadow(r);
  let total=0;
  for(const p of r.players){requireRule(Number.isSafeInteger(p.lobbyWins)&&p.lobbyWins>=0,'LOBBY_WINS_INVARIANT');assertAccount(p.account);if(p.participating)total+=p.account.balance+Object.values(p.account.escrows).reduce((a,b)=>a+b,0);}
  if(r.matchId)requireRule(r.party?total+r.party.bank.balance+r.party.vault+r.party.bonusReserve===r.initialChips+r.party.bank.initial+r.party.initialBonusReserve:total===r.initialChips+r.dealerNet,'LEDGER_INVARIANT');
  if(r.party){
    for(const amount of [r.party.vault,r.party.bonusReserve,r.party.initialBonusReserve])requireRule(Number.isSafeInteger(amount)&&amount>=0,'PARTY_LEDGER_INVARIANT');
    requireRule(new Set(r.party.transfers.map(t=>t.id)).size===r.party.transfers.length,'DUPLICATE_PARTY_TRANSFER');
    for(const t of r.party.transfers)requireRule(Number.isSafeInteger(t.amount)&&t.amount>=0,'INVALID_PARTY_TRANSFER');
    requireRule(new Set(r.party.duelHistory.map(d=>d.id)).size===r.party.duelHistory.length,'DUPLICATE_DUEL');
    const social=r.party.social;
    if(social){
      requireRule(typeof social.slotId==='string'&&!!social.slotId&&(social.slot===1&&social.slotOpenedAt===social.openedAt||r.roundLimit>=6&&social.slot===2&&social.slotOpenedAt>=social.openedAt&&social.slotOpenedAt+90000<=social.hardDeadline)&&social.admissionDeadline===social.slotOpenedAt+20000&&social.hardDeadline===social.openedAt+(r.roundLimit>=6?180000:90000),'SOCIAL_BUDGET_INVARIANT');
      requireRule(social.invites.length<=64&&new Set(social.invites.map(i=>i.id)).size===social.invites.length,'DUEL_INVITES_INVARIANT');
      requireRule(social.dealInvites.length<=64&&new Set(social.dealInvites.map(i=>i.id)).size===social.dealInvites.length,'DEAL_INVITES_INVARIANT');
      requireRule(!social.duel||!social.deal,'SOCIAL_CONTEST_OVERLAP');
      requireRule([1,2].every(slot=>social.invites.filter(i=>i.status==='accepted'&&(i.slot??1)===slot).length+social.dealInvites.filter(i=>i.status==='accepted'&&i.slot===slot).length<=1),'DUEL_OVERLAP');
      const contests=[...r.party.duelHistory,...r.party.dealHistory,...(social.duel?.status==='playing'?[social.duel]:[]),...(social.deal?.status==='choosing'?[social.deal]:[])].filter(contest=>contest.socialId===social.id);
      requireRule([1,2].every(slot=>contests.filter(contest=>contest.slot===slot).length<=1),'SOCIAL_CONTEST_OVERLAP');
      if(social.duel){requireRule(social.duel.throws.length<=5,'RPS_THROW_CAP');requireRule(social.duel.deadline<=social.duel.hardDeadline&&social.duel.hardDeadline<=social.hardDeadline-2000,'DUEL_BUDGET_INVARIANT');}
    }
  }
  const dealt=r.players.flatMap(p=>p.hand).concat(r.dealer,r.discarded);requireRule(new Set(dealt.map(c=>c.id)).size===dealt.length,'DUPLICATE_CARD');
  requireRule(r.cursor===dealt.length,'DRAW_INVARIANT');
  requireRule(new Set(r.bluffOutcomes.map(o=>o.id)).size===r.bluffOutcomes.length,'DUPLICATE_BLUFF');
  requireRule(r.players.reduce((n,p)=>n+p.bluffWins,0)===r.bluffOutcomes.length,'BLUFF_STATS_INVARIANT');
  requireRule(r.players.reduce((n,p)=>n+p.bluffLosses,0)===r.bluffOutcomes.length,'BLUFF_STATS_INVARIANT');
}
