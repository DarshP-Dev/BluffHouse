import {type ChaosKind,type ChaosRule,type ChaosView,type Command} from '@bluff-house/shared';
import {available,credit,reserve} from './ledger.js';
import {addEvent} from './engine.js';
import {eligibleHands,handCardReason,applyHandCard} from './chaos-hands.js';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';

export const CHAOS_RULES:ChaosRule[]=[
  {kind:'DOUBLE_DOWN',name:'Double Down Chaos',window:'Betting, after submitting a wager',effect:'Fund twice your original wager, up to 750 chips. Replacing or withdrawing removes the effect; the card stays spent.'},
  {kind:'TRIPLE_DOWN',name:'Triple Down Chaos',window:'Betting, after submitting a wager',effect:'Fund three times your original wager, up to 750 chips. Replacing or withdrawing removes the effect; the card stays spent.'},
  {kind:'POT_TWIST',name:'Pot Twist',window:'Activate during betting with a wager; opt in for five seconds after betting closes',effect:'Open a voluntary funded doubling opportunity for already submitted wagers, up to 750 chips. Each recipient uses their round allowance. The owner must also opt in.'},
  {kind:'EMERGENCY_FUND',name:'Emergency Fund',window:'Betting, before submitting a wager; once per player per match',effect:'Receive up to 100 chips from the finite bonus reserve. A smaller remaining award is disclosed; an empty reserve leaves the card held.'},
  {kind:'HAND_SWAP',name:'Hand Swap',window:'The five-second window after natural checks, before ordinary decisions',effect:'Exchange your funded, connected, unacted, non-natural two-card hand with another eligible hand. Wagers, seats and bluff allowances stay with their owners. Only one movement resolves per window.'},
  {kind:'TABLE_TURN',name:'Table Turn',window:'The five-second window after natural checks, before ordinary decisions',effect:'Move all eligible hands one seat left. The dealer, naturals, and disconnected or unfunded hands stay fixed. Wagers and bluff allowances stay with seats. Only one movement resolves per window.'},
  {kind:'SECOND_CHANCE',name:'Second Chance',window:'Your next decision after an ordinary Hit leaves a live total below 21',effect:'Discard and replace that one ordinary Hit from the existing shoe. The discard stays consumed. A new decision gets 20 seconds. Cannot undo a bust, 21, natural, challenged draw, protected reveal or settled result.'},
];

function baseReason(r:Room,p:Player):string|null{
  if(!r.party||r.mode!=='PARTY')return 'Chaos cards are available in Party matches.';
  if(!p.participating||p.departed)return 'Only current match participants can play a Chaos card.';
  if(!p.connected)return 'Reconnect before playing a Chaos card.';
  if(r.terminationConfirmed)return 'This match is ending; new Chaos effects are closed.';
  return null;
}
function stakeReason(r:Room,p:Player,factor:2|3):string|null{
  if(!p.wagerId||!p.wager||p.account.reservations[p.wagerId]!==p.wager)return 'Submit a wager before using this effect.';
  if(r.party!.chaos.multipliers[p.id])return 'A wager multiplier is already active; effects cannot stack.';
  const amount=p.wager*factor;
  if(amount>750)return 'The multiplied wager cannot exceed 750 chips.';
  if(amount>available(p.account)+p.wager)return 'You do not have enough available chips to fund the larger wager.';
  return null;
}
function cardReason(r:Room,p:Player,kind:ChaosKind):string|null{
  const common=baseReason(r,p);if(common)return common;
  const chaos=r.party!.chaos;
  if(chaos.usedRound[p.id]===r.roundId)return 'You have already used your Chaos allowance this round.';
  if(kind==='HAND_SWAP'||kind==='TABLE_TURN'||kind==='SECOND_CHANCE')return handCardReason(r,p,kind);
  if(r.phase!=='BETTING')return 'Play this card during betting.';
  if(kind==='EMERGENCY_FUND'){
    if(p.wagerId||p.wager)return 'Withdraw your wager before requesting Emergency Fund.';
    if(chaos.emergencyUsed.includes(p.id))return 'Emergency Fund is available once per player per match.';
    if(r.party!.bonusReserve<=0)return 'The bonus reserve is empty; your card stays held.';
    return null;
  }
  if(kind==='POT_TWIST'){
    if(chaos.potTwist)return 'Pot Twist has already been activated this round.';
    if(!p.wagerId||!p.wager||p.account.reservations[p.wagerId]!==p.wager)return 'Submit a wager before activating Pot Twist.';
    return null;
  }
  return stakeReason(r,p,kind==='DOUBLE_DOWN'?2:3);
}
function optInReason(r:Room,p:Player):string|null{
  const common=baseReason(r,p);if(common)return common;
  const chaos=r.party!.chaos,window=chaos.potTwist;
  if(r.phase!=='POT_TWIST'||!window||window.status!=='open')return 'Wait for an open Pot Twist window.';
  if(window.optedInIds.includes(p.id))return 'Your wager is already doubled by this Pot Twist.';
  if(chaos.usedRound[p.id]===r.roundId&&window.ownerId!==p.id)return 'You have already used your Chaos allowance this round.';
  return stakeReason(r,p,2);
}
function applyMultiplier(r:Room,p:Player,factor:2|3,source:ChaosKind){
  const base=p.wager;
  reserve(p.account,p.wagerId!,base*factor);
  p.wager=base*factor;r.party!.chaos.multipliers[p.id]={base,factor,source};
}

/** One grant pass per settled non-final round. Ranking ties are included. */
export function grantChaos(r:Room,e:EngineOptions,now:number){
  if(!r.party||r.phase!=='ROUND_RESULT'||!r.roundId||r.round>=r.roundLimit||r.terminationConfirmed)return;
  const chaos=r.party.chaos;if(chaos.grantedRounds.includes(r.roundId))return;
  const players=r.players.filter(p=>p.participating&&!p.departed).sort((a,b)=>a.account.balance-b.account.balance||a.seat-b.seat);
  const threshold=players[Math.min(1,players.length-1)]?.account.balance;
  for(const p of players.filter(p=>p.account.balance<=threshold!).sort((a,b)=>a.seat-b.seat)){
    const inventory=chaos.inventories[p.id]??=[];
    if(inventory.length>=2){addEvent(r,e,'chaos',`${p.name}'s Chaos inventory is full; no card granted.`,now,p.id);continue;}
    const index=e.randomIndex(CHAOS_RULES.length),rule=CHAOS_RULES[index];requireRule(rule,'INVALID_RANDOM_INDEX');
    inventory.push({id:e.id(),kind:rule.kind});addEvent(r,e,'chaos',`${p.name} receives ${rule.name}.`,now,p.id);
  }
  chaos.grantedRounds.push(r.roundId);
}

export function resetChaosRound(r:Room){if(r.party){r.party.chaos.multipliers={};r.party.chaos.potTwist=null;r.party.chaos.handWindow=null;r.party.chaos.ordinaryHits={};}}
export function clearWagerEffect(r:Room,p:Player){if(r.party)delete r.party.chaos.multipliers[p.id];}

export function chaosCommand(r:Room,p:Player,c:Command,e:EngineOptions,now:number){
  requireRule(r.party&&r.mode==='PARTY','PARTY_REQUIRED');
  const chaos=r.party.chaos;
  if(c.type==='chaos:optin'){
    const window=chaos.potTwist;
    requireRule(window&&c.chaosWindowId===window.id&&window.roundId===r.roundId&&window.status==='open'&&window.deadline!==null&&now<window.deadline,'STALE_CHAOS_WINDOW','This Pot Twist window has closed or changed.');
    const reason=optInReason(r,p);requireRule(!reason,'CHAOS_UNAVAILABLE',reason??undefined);
    applyMultiplier(r,p,2,'POT_TWIST');window.optedInIds.push(p.id);chaos.usedRound[p.id]=r.roundId!;p.chaosAffected=true;
    addEvent(r,e,'chaos',`${p.name} opts into Pot Twist: ${p.wager} chips funded.`,now,p.id);return;
  }
  requireRule(c.type==='chaos:activate','UNAVAILABLE_ACTION');
  const inventory=chaos.inventories[p.id]??[],card=inventory.find(card=>card.id===c.payload?.cardId);
  requireRule(card,'CARD_NOT_HELD','That Chaos card is no longer in your inventory.');
  const handEffect=card.kind==='HAND_SWAP'||card.kind==='TABLE_TURN'||card.kind==='SECOND_CHANCE';
  if(!handEffect)requireRule(r.phase==='BETTING'&&c.bettingId===r.bettingId&&r.deadline!==null&&now<r.deadline,'STALE_BETTING','Betting is closed or this round has changed.');
  const reason=cardReason(r,p,card.kind);requireRule(!reason,'CHAOS_UNAVAILABLE',reason??undefined);
  if(handEffect){
    applyHandCard(r,p,card.kind,c,e,now);
  }else if(card.kind==='EMERGENCY_FUND'){
    const amount=Math.min(100,r.party.bonusReserve),id=`${r.matchId}:${p.id}:emergency-fund`;
    requireRule(credit(p.account,id,amount),'EMERGENCY_ALREADY_SETTLED');
    r.party.bonusReserve-=amount;chaos.emergencyUsed.push(p.id);r.party.transfers.push({id,kind:'bonus',amount,from:'BONUS_RESERVE',to:p.id,roundId:r.roundId});
    addEvent(r,e,'chaos',`${p.name} receives ${amount} chips from the bonus reserve through Emergency Fund.`,now,p.id);
  }else if(card.kind==='POT_TWIST'){
    chaos.potTwist={id:e.id(),ownerId:p.id,roundId:r.roundId!,status:'pending',deadline:null,optedInIds:[]};
    addEvent(r,e,'chaos',`${p.name} activates Pot Twist. After betting, submitted wagers may voluntarily fund a double during a five-second window.`,now,p.id);
  }else{
    applyMultiplier(r,p,card.kind==='DOUBLE_DOWN'?2:3,card.kind);
    addEvent(r,e,'chaos',`${p.name} plays ${card.kind==='DOUBLE_DOWN'?'Double':'Triple'} Down Chaos: ${p.wager} chips funded.`,now,p.id);
  }
  inventory.splice(inventory.indexOf(card),1);chaos.usedRound[p.id]=r.roundId!;p.chaosAffected=true;
}

export function openPotTwist(r:Room,now:number):boolean{
  const window=r.party?.chaos.potTwist;
  if(!window||window.status!=='pending')return false;
  if(!r.players.some(p=>p.participating&&p.wagerId&&p.wager>0)){window.status='closed';return false;}
  window.status='open';window.deadline=now+5000;r.phase='POT_TWIST';r.deadline=window.deadline;return true;
}
export function closePotTwist(r:Room){const window=r.party?.chaos.potTwist;if(window)window.status='closed';}

export function projectChaos(r:Room,viewerId:string):ChaosView{
  requireRule(r.party,'PARTY_REQUIRED');const chaos=r.party.chaos,p=r.players.find(p=>p.id===viewerId);
  const optReason=p?optInReason(r,p):'Only current match participants can opt in.';
  const handEligible=r.phase==='HAND_CHAOS'?eligibleHands(r).map(player=>player.id):[];
  const handTargets=p&&!cardReason(r,p,'HAND_SWAP')?handEligible.filter(id=>id!==viewerId):[];
  return {registry:CHAOS_RULES.map(rule=>({...rule})),inventories:r.players.filter(p=>p.participating).map(p=>({playerId:p.id,cards:(chaos.inventories[p.id]??[]).map(card=>({...card}))})),actions:p?(chaos.inventories[p.id]??[]).map(card=>{const reason=cardReason(r,p,card.kind);return {cardId:card.id,eligible:!reason,reason:reason??'Ready to activate.'};}):[],usedThisRound:!!r.roundId&&chaos.usedRound[viewerId]===r.roundId,emergencyUsed:chaos.emergencyUsed.includes(viewerId),emergencyAmount:Math.min(100,r.party.bonusReserve),potTwist:chaos.potTwist?{...chaos.potTwist,optedInIds:[...chaos.potTwist.optedInIds]}:null,handWindow:chaos.handWindow?{...chaos.handWindow,eligibleIds:handEligible}:null,handTargets,optInEligible:!optReason,optInReason:optReason??'Fund a double of your submitted wager.',multipliers:Object.entries(chaos.multipliers).map(([playerId,m])=>({playerId,...m}))};
}

/** A held legal Emergency Fund can keep the next betting phase reachable. */
export function canAffordNextRound(r:Room):boolean{
  const players=r.players.filter(p=>p.participating&&p.connected&&!p.departed);
  let count=players.filter(p=>available(p.account)>=50).length;if(count>=2)return true;
  if(!r.party)return false;
  let reserveLeft=r.party.bonusReserve;
  for(const p of players.filter(p=>available(p.account)<50).sort((a,b)=>a.account.balance-b.account.balance||a.seat-b.seat)){
    if(r.party.chaos.emergencyUsed.includes(p.id)||!(r.party.chaos.inventories[p.id]??[]).some(c=>c.kind==='EMERGENCY_FUND'))continue;
    const award=Math.min(100,reserveLeft);if(!award)break;
    if(available(p.account)+award<50)continue;
    reserveLeft-=award;if(++count>=2)return true;
  }
  return false;
}

export function assertChaos(r:Room){
  if(!r.party)return;const chaos=r.party.chaos,ids:string[]=[];
  for(const [playerId,cards] of Object.entries(chaos.inventories)){
    requireRule(r.players.some(p=>p.id===playerId&&p.participating)&&cards.length<=2,'CHAOS_INVENTORY_INVARIANT');
    for(const card of cards){requireRule(typeof card.id==='string'&&!!card.id&&CHAOS_RULES.some(rule=>rule.kind===card.kind),'CHAOS_CARD_INVARIANT');ids.push(card.id);}
  }
  requireRule(new Set(ids).size===ids.length,'DUPLICATE_CHAOS_CARD');
  for(const entries of [chaos.emergencyUsed,chaos.grantedRounds])requireRule(new Set(entries).size===entries.length,'DUPLICATE_CHAOS_SETTLEMENT');
  for(const [playerId,m] of Object.entries(chaos.multipliers)){
    const p=r.players.find(p=>p.id===playerId);requireRule(p&&Number.isSafeInteger(m.base)&&m.base>=50&&m.base<=250&&m.base%50===0&&(m.factor===2||m.factor===3)&&p.wager===m.base*m.factor&&p.wager<=750&&chaos.usedRound[playerId]===r.roundId,'CHAOS_MULTIPLIER_INVARIANT');
    requireRule(m.factor===3?m.source==='TRIPLE_DOWN':m.source==='DOUBLE_DOWN'||m.source==='POT_TWIST','CHAOS_MULTIPLIER_SOURCE_INVARIANT');
    if(p.wagerId){for(const entries of [p.account.reservations,p.account.escrows])if(Object.hasOwn(entries,p.wagerId))requireRule(entries[p.wagerId]===p.wager,'CHAOS_FUNDING_INVARIANT');}
  }
  const window=chaos.potTwist;
  if(window){requireRule(window.roundId===r.roundId&&new Set(window.optedInIds).size===window.optedInIds.length,'POT_TWIST_INVARIANT');if(window.status==='open')requireRule(r.phase==='POT_TWIST'&&window.deadline===r.deadline,'POT_TWIST_DEADLINE_INVARIANT');}
  if(chaos.handWindow){const hand=chaos.handWindow;requireRule(typeof hand.id==='string'&&!!hand.id&&Number.isFinite(hand.deadline)&&typeof hand.resolved==='boolean','HAND_WINDOW_INVARIANT');if(r.phase==='HAND_CHAOS')requireRule(r.deadline===hand.deadline&&!r.activePlayerId&&!r.decisionId,'HAND_WINDOW_DEADLINE_INVARIANT');}
  for(const [playerId,marker] of Object.entries(chaos.ordinaryHits)){
    const p=r.players.find(player=>player.id===playerId);
    requireRule(p&&p.participating&&p.hand.at(-1)?.id===marker.cardId&&typeof marker.decisionId==='string'&&!!marker.decisionId,'ORDINARY_HIT_INVARIANT');
  }
}
