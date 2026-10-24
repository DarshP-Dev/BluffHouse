import {RULES,validAmount,type Command,type MatchResults} from '@bluff-house/shared';
import {account,assertAccount,reserve,release,commit,settle} from './ledger.js';
import {evaluate} from './cards.js';
import {payout,dealerShouldHit} from './blackjack.js';
import {offerBluff,acceptBluff,cancelBluff} from './bluff.js';
import {startAuction,closeAuction,submitBid,payCommission,distributeVault} from './house.js';
import {openSocial,duelCommand,socialDeadline,closeSocial,assertDuels} from './duels.js';
import {overthrowCommand} from './overthrow.js';
import {grantChaos,resetChaosRound,chaosCommand,openPotTwist,closePotTwist,clearWagerEffect,assertChaos,canAffordNextRound} from './chaos.js';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';

export function addEvent(r:Room,e:EngineOptions,kind:string,text:string,at:number,playerId?:string){
  r.events.push({id:e.id(),kind,text,at,playerId,revision:r.revision+1});
  r.events=r.events.slice(-60);
}
export function makePlayer(id:string,name:string,seat:number,now:number):Player {
  return {id,name,seat,joinedAt:now,connected:true,departed:false,ready:false,disconnectedAt:null,account:account(),hand:[],status:'waiting',wager:0,participating:false,bluffUsed:false,bluffWins:0,bluffLosses:0};
}
export function createRoom(code:string,player:Player,e:EngineOptions):Room {
  return {mode:'CLASSIC',party:null,roundPayouts:[],instanceId:e.id(),code,revision:0,lobbyId:e.id(),hostId:player.id,phase:'LOBBY',players:[player],round:0,initialChips:0,dealerNet:0,shoe:[],cursor:0,dealer:[],dealerRevealed:false,deadline:null,bluff:null,pausedRemaining:0,biggestBluff:null,bluffOutcomes:[],events:[],results:null,recoveryDeadline:null,terminationConfirmed:false,hostDeadline:null,emptySince:null,resultsSince:null};
}
export function connected(r:Room){return r.players.filter(p=>p.connected&&!p.departed&&(r.phase==='LOBBY'||p.participating));}
export function active(r:Room):Player {const p=r.players.find(p=>p.id===r.activePlayerId);requireRule(p,'NO_ACTIVE_PLAYER');return p;}
export function draw(r:Room){const card=r.shoe[r.cursor];requireRule(card,'SHOE_EXHAUSTED');r.cursor++;return card;}
export function startRound(r:Room,e:EngineOptions,now:number){
  r.round++;r.roundId=e.id();r.bettingId=e.id();r.phase='BETTING';r.deadline=now+RULES.bettingMs;
  resetChaosRound(r);
  r.roundPayouts=[];
  r.decisionId=undefined;r.activePlayerId=undefined;r.dealer=[];r.dealerRevealed=false;r.shoe=[];r.cursor=0;r.bluff=null;
  for(const p of r.players){p.hand=[];p.status=p.participating?'waiting':'observer';p.wager=0;p.wagerId=undefined;p.bluffUsed=false;}
  addEvent(r,e,'round',`Round ${r.round} · Place your wagers`,now);
}
export function startMatch(r:Room,e:EngineOptions,now:number){
  const players=connected(r);requireRule(players.length>=2,'NOT_ENOUGH_PLAYERS','At least two connected players are needed.');
  requireRule(players.every(p=>p.ready),'NOT_READY','Everyone connected must be ready.');
  r.matchId=e.id();r.round=0;r.initialChips=players.length*RULES.startingChips;r.dealerNet=0;r.results=null;r.resultsSince=null;r.biggestBluff=null;r.bluffOutcomes=[];r.terminationConfirmed=false;r.recoveryDeadline=null;
  // Absent lobby guests are not participants in this new match.
  for(const p of r.players){p.participating=p.connected&&!p.departed;p.account=account();p.bluffWins=0;p.bluffLosses=0;}
  r.party=null;r.roundPayouts=[];
  if(r.mode==='PARTY'){startAuction(r,e,now);addEvent(r,e,'house','The sealed House auction is open. Bids stay private until reveal.',now);}else startRound(r,e,now);
}
export function freshDecision(r:Room,e:EngineOptions,now:number,duration=RULES.decisionMs){r.phase='PLAYER_TURN';r.decisionId=e.id();r.deadline=now+duration;}
export function nextTurn(r:Room,e:EngineOptions,now:number){
  const next=r.players.find(p=>p.participating&&p.status==='playing');
  if(next){r.activePlayerId=next.id;freshDecision(r,e,now);return;}
  r.activePlayerId=undefined;r.decisionId=undefined;r.phase='DEALER_TURN';r.dealerRevealed=true;r.deadline=now+RULES.dealerMs;
}
export function finishHit(r:Room,e:EngineOptions,now:number){
  const p=active(r),v=evaluate(p.hand);
  if(v.total>=21){p.status=v.bust?'bust':'stood';nextTurn(r,e,now);}else freshDecision(r,e,now);
}
export function settleRound(r:Room,e:EngineOptions,now:number){
  r.dealerRevealed=true;
  for(const p of [...r.players].sort((a,b)=>a.seat-b.seat)){if(!p.wagerId||!p.wager)continue;
    const result=payout(p.hand,r.dealer,p.wager,r.mode==='PARTY'?750:250);
    if(settle(p.account,p.wagerId,result.returned)){
      r.dealerNet+=result.returned-p.wager;p.status=result.outcome;
      const houseCommission=payCommission(r,p,result.profit);r.roundPayouts.push({playerId:p.id,stake:p.wager,returned:result.returned,profit:result.profit,houseCommission});
      addEvent(r,e,'settlement',`${p.name}: ${result.outcome} · ${result.profit>=0?'+':''}${result.profit} chips`,now,p.id);
      if(houseCommission)addEvent(r,e,'commission',`Dealer bank pays ${houseCommission} extra chips to the House. ${p.name} keeps the full ${result.returned}-chip return.`,now,r.party!.houseId!);
    }
  }
  r.phase='ROUND_RESULT';r.deadline=now+RULES.resultMs;r.activePlayerId=undefined;r.decisionId=undefined;
  grantChaos(r,e,now);
}
export function results(r:Room,e:EngineOptions,now:number,reason?:string){
  closeSocial(r);
  const vault=r.party?.vault??0;distributeVault(r);if(vault)addEvent(r,e,'vault',`The ${vault}-chip Vault is shared among all original participants, with remainder chips in seat order.`,now);
  const standings=r.players.filter(p=>p.participating).map(p=>({id:p.id,name:p.name,balance:p.account.balance,bluffWins:p.bluffWins,bluffLosses:p.bluffLosses})).sort((a,b)=>b.balance-a.balance);
  const result:MatchResults={reason,standings,winners:standings.filter(p=>p.balance===standings[0]?.balance).map(p=>p.id),biggestBluff:r.biggestBluff};
  r.results=result;r.phase='RESULTS';r.deadline=null;r.recoveryDeadline=null;r.resultsSince=now;r.activePlayerId=undefined;r.decisionId=undefined;
  addEvent(r,e,'results',reason?`Match ended early: ${reason}`:'Three rounds. One table. Final standings are in.',now);
}
export function roundBoundary(r:Room,e:EngineOptions,now:number){
  if(r.terminationConfirmed){results(r,e,now,'Too few connected players after the recovery window.');return;}
  if(r.round>=RULES.rounds){results(r,e,now);return;}
  if(connected(r).length<2){r.phase='WAITING_FOR_PLAYERS';r.deadline=null;return;}
  if(!canAffordNextRound(r)){results(r,e,now,'Fewer than two connected players can afford the minimum wager.');return;}
  if(r.party&&r.round>0&&r.party.socialRound<r.round){openSocial(r,e,now);return;}
  startRound(r,e,now);
}
function commitBetsAndDeal(r:Room,e:EngineOptions,at:number){
  let wagers=0;
  for(const p of r.players){if(p.wagerId&&p.wager){commit(p.account,p.wagerId);p.status='playing';wagers++;}else p.status=p.participating?'skipped':'observer';}
  if(!wagers){addEvent(r,e,'round','No wagers were placed.',at);settleRound(r,e,at);return;}
  r.shoe=e.shoe();r.cursor=0;
  for(let pass=0;pass<2;pass++){for(const p of r.players)if(p.status==='playing')p.hand.push(draw(r));r.dealer.push(draw(r));}
  r.phase='DEALING';r.deadline=at+RULES.dealingMs;
}
export function deadlineTransition(r:Room,e:EngineOptions,at:number){
  switch(r.phase){
    case 'HOUSE_AUCTION': closeAuction(r,e);r.phase='HOUSE_REVEAL';r.deadline=at+RULES.revealMs;addEvent(r,e,'house',r.party!.houseId?`${r.players.find(p=>p.id===r.party!.houseId)!.name} becomes the House. ${r.party!.auction.winningBid} chips enter the Vault.`:'Everyone passed. No House this match.',at);break;
    case 'HOUSE_REVEAL': roundBoundary(r,e,at);break;
    case 'BETTING': if(!openPotTwist(r,at))commitBetsAndDeal(r,e,at);break;
    case 'POT_TWIST': closePotTwist(r);commitBetsAndDeal(r,e,at);break;
    case 'DEALING': {
      for(const p of r.players)if(p.hand.length&&evaluate(p.hand).natural)p.status='natural';
      if(evaluate(r.dealer).natural)settleRound(r,e,at);else nextTurn(r,e,at);break;
    }
    case 'PLAYER_TURN': {const p=active(r);p.status='stood';addEvent(r,e,'timeout',`${p.name} automatically stands.`,at,p.id);nextTurn(r,e,at);break;}
    case 'BLUFF_OFFER': cancelBluff(r,e,at,'expired');addEvent(r,e,'bluff','Nobody called. Reserved chips returned; no card drawn.',at);break;
    case 'BLUFF_REVEAL': finishHit(r,e,at);break;
    case 'DEALER_TURN': {if(dealerShouldHit(r.dealer)){r.dealer.push(draw(r));r.deadline=at+RULES.dealerMs;}else settleRound(r,e,at);break;}
    case 'ROUND_RESULT': roundBoundary(r,e,at);break;
    case 'SOCIAL':case 'LAST_STAND_CHOICE':case 'DUEL':case 'DUEL_RESULT': if(socialDeadline(r,e,at)){closeSocial(r);roundBoundary(r,e,at);}break;
    default: requireRule(false,'INVALID_PHASE_DEADLINE');
  }
}
export function gameCommand(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  switch(c.type){
    case 'chaos:activate':case 'chaos:optin':chaosCommand(r,p,c,e,now);break;
    case 'house:ballot':case 'house:vote':case 'house:choose':overthrowCommand(r,p,c,e,now);break;
    case 'duel:invite':case 'duel:reject':case 'duel:accept':case 'duel:choose':case 'duel:move':case 'duel:resign':duelCommand(r,p,c,e,now);break;
    case 'house:bid': submitBid(r,p,c);break;
    case 'bluff:offer': offerBluff(r,p,c,e,now);addEvent(r,e,'bluff',`${p.name}: “My next hit won't bust.” ${r.bluff!.amount} chips to call.`,now,p.id);break;
    case 'bluff:accept': {
      acceptBluff(r,p,c,e,now);const winner=r.players.find(p=>p.id===r.bluff!.winnerId)!;
      addEvent(r,e,'bluff',`${winner.name} wins the ${r.bluff!.pot}-chip bluff pot (+${r.bluff!.amount} net).`,now,winner.id);break;
    }
    case 'bet:submit': case 'bet:withdraw': {
      requireRule(r.phase==='BETTING'&&c.bettingId===r.bettingId,'STALE_BETTING','Betting is closed or this round has changed.');
      requireRule(p.participating,'NOT_PARTICIPATING');
      clearWagerEffect(r,p);
      if(c.type==='bet:submit'){const amount=c.payload?.amount;requireRule(validAmount(amount),'INVALID_AMOUNT','Choose 50–250 chips in steps of 50.');const id=p.wagerId??`${r.roundId}:${p.id}:blackjack`;reserve(p.account,id,amount);p.wagerId=id;p.wager=amount;}
      else {if(p.wagerId)release(p.account,p.wagerId);p.wager=0;p.wagerId=undefined;}
      break;
    }
    case 'turn:hit':case 'turn:stand': {
      requireRule(r.phase==='PLAYER_TURN','PHASE_LOCKED','Wait for your next Blackjack decision.');
      requireRule(r.activePlayerId===p.id,'NOT_YOUR_TURN');requireRule(c.decisionId===r.decisionId,'STALE_DECISION','This decision has already changed.');
      if(c.type==='turn:hit'){p.hand.push(draw(r));finishHit(r,e,now);}else {p.status='stood';nextTurn(r,e,now);}break;
    }
    default: requireRule(false,'UNAVAILABLE_ACTION','This action is not available.');
  }
}
export function assertRoom(r:Room){
  assertChaos(r);
  assertDuels(r);
  let total=0;
  for(const p of r.players){assertAccount(p.account);if(p.participating)total+=p.account.balance+Object.values(p.account.escrows).reduce((a,b)=>a+b,0);}
  if(r.matchId)requireRule(total+(r.party?.vault??0)+(r.party?.bonusReserve??0)===r.initialChips+(r.party?.initialBonusReserve??0)+r.dealerNet,'LEDGER_INVARIANT');
  if(r.party){
    for(const amount of [r.party.vault,r.party.bonusReserve,r.party.initialBonusReserve])requireRule(Number.isSafeInteger(amount)&&amount>=0,'PARTY_LEDGER_INVARIANT');
    requireRule(new Set(r.party.transfers.map(t=>t.id)).size===r.party.transfers.length,'DUPLICATE_PARTY_TRANSFER');
    for(const t of r.party.transfers)requireRule(Number.isSafeInteger(t.amount)&&t.amount>=0,'INVALID_PARTY_TRANSFER');
    requireRule(new Set(r.party.duelHistory.map(d=>d.id)).size===r.party.duelHistory.length,'DUPLICATE_DUEL');
    const social=r.party.social;
    if(social){
      requireRule(social.admissionDeadline===social.openedAt+20000&&social.hardDeadline===social.openedAt+90000,'SOCIAL_BUDGET_INVARIANT');
      requireRule(social.invites.length<=64&&new Set(social.invites.map(i=>i.id)).size===social.invites.length,'DUEL_INVITES_INVARIANT');
      requireRule(social.invites.filter(i=>i.status==='accepted').length<=1,'DUEL_OVERLAP');
      if(social.duel){requireRule(social.duel.throws.length<=5,'RPS_THROW_CAP');requireRule(social.duel.deadline<=social.duel.hardDeadline&&social.duel.hardDeadline<=social.hardDeadline-2000,'DUEL_BUDGET_INVARIANT');}
    }
  }
  const dealt=r.players.flatMap(p=>p.hand).concat(r.dealer);requireRule(new Set(dealt.map(c=>c.id)).size===dealt.length,'DUPLICATE_CARD');
  requireRule(r.cursor===dealt.length,'DRAW_INVARIANT');
  requireRule(new Set(r.bluffOutcomes.map(o=>o.id)).size===r.bluffOutcomes.length,'DUPLICATE_BLUFF');
  requireRule(r.players.reduce((n,p)=>n+p.bluffWins,0)===r.bluffOutcomes.length,'BLUFF_STATS_INVARIANT');
  requireRule(r.players.reduce((n,p)=>n+p.bluffLosses,0)===r.bluffOutcomes.length,'BLUFF_STATS_INVARIANT');
  for(const offer of r.bluffOutcomes){requireRule(offer.status==='accepted'&&offer.card&&offer.winnerId&&offer.challengerId&&offer.pot===offer.amount*2,'BLUFF_SETTLEMENT_INVARIANT');}
}
