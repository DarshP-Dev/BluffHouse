import {describe,expect,it} from 'vitest';
import type {Command,CommandType} from '@bluff-house/shared';
import {evaluate} from '../../apps/server/src/game/cards.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture,shoe} from '../fixtures/core.js';
import {fundedFinale,dealShadow,declareShadow,advanceFinale,finishFinale,standRemaining,standTo,type ShadowFixture} from '../fixtures/shadow.js';

// Approved replacement for the former draw-then-points contest: hidden Blackjack,
// accepted totals, free calls, finite dealer backing and the funded Vault.
function conserved(f:ShadowFixture){const r=f.room(),p=r.party!;expect(r.players.reduce((n,a)=>n+a.account.balance+Object.values(a.account.escrows).reduce((s,v)=>s+v,0),0)+p.bank.balance+p.vault+p.bonusReserve).toBe(r.initialChips+p.bank.initial+p.initialBonusReserve);assertRoom(r);}
function reject(f:ShadowFixture,actor:string,type:CommandType,payload?:Record<string,unknown>,extra?:Partial<Command>){const before=structuredClone(f.room());expect(f.send(actor,type,payload,extra).status).toBe('rejected');expect(f.room()).toEqual(before);conserved(f);}
function entry(f:ShadowFixture,seat:number){return f.room().party!.shadow!.entries.find(e=>e.playerId===f.actors[seat])!;}
function deplete(f:ShadowFixture,seats:number[]){const r=f.room(),b=r.party!.bank;for(const seat of seats){const p=r.players.find(p=>p.id===f.actors[seat])!;b.balance+=p.account.balance;if(b.bond.ownerId===p.id){if(b.bond.reservationId)delete p.account.reservations[b.bond.reservationId];b.bond.amount=0;}p.account.balance=0;}r.dealerNet=b.initial-b.balance;conserved(f);}

describe('one hidden Blackjack finale and backed optional wagers',()=>{
  it('opens betting then deals every zero-wager entrant and the actual House dealer exactly once',()=>{
    const f=fundedFinale({betting:true});expect(f.view().phase).toBe('SHADOW_BETTING');expect(f.room().party!.shadow!.dealt).toBe(false);expect(f.view().deadline!-f.view().serverTime).toBe(20000);dealShadow(f);
    const s=f.room().party!.shadow!;expect(f.view().phase).toBe('SHADOW_TURN');expect(f.view().party!.shadow!.entrantIds).toEqual(f.actors);expect(f.view().players.every(p=>p.wager===0&&p.committed===0)).toBe(true);expect(s.dealer).toBe(s.entries.find(e=>e.role==='HOUSE'));expect(s.cursor).toBe(6);expect(s.entries.map(e=>e.hand.length)).toEqual([2,2,2]);expect(new Set(s.entries.flatMap(e=>e.hand.map(c=>c.id))).size).toBe(6);conserved(f);
  });
  it('atomically edits and withdraws bettor stakes with paired Bank collateral, while House cannot bet',()=>{
    const f=fundedFinale({betting:true});reject(f,f.actors[2]!,'bet:submit',{amount:100});expect(f.send(f.host,'bet:submit',{amount:101}).status).toBe('ok');expect(f.view().party!.bank.committed).toBe(151);expect(f.send(f.host,'bet:submit',{amount:200}).status).toBe('ok');expect(f.view().party!.bank.committed).toBe(300);expect(f.send(f.host,'bet:withdraw').status).toBe('ok');expect(f.view().party!.bank.committed).toBe(0);dealShadow(f,[100]);expect(f.view().players[0]).toMatchObject({committed:100,reserved:0,balance:900});expect(f.view().party!.bank.committed).toBe(150);reject(f,f.host,'bet:withdraw');
  });
  it('lets zero-chip entrants claim and call for free without a call bond or Emergency Fund',()=>{
    const f=fundedFinale({betting:true});deplete(f,[0,1]);dealShadow(f);declareShadow(f,0);const bank=structuredClone(f.view().party!.bank);expect(f.view(f.actors[1]).party!.shadow!.actions).toMatchObject({canCall:true,callReward:25});expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');expect(f.view().players[1]).toMatchObject({balance:25,committed:0,reserved:0});expect(f.view().party!.vault).toBe(75);expect(f.view().party!.bank).toEqual(bank);standRemaining(f);finishFinale(f);conserved(f);
  });
  it('lets an All-In entrant call without releasing the committed wager or spending it twice',()=>{
    const f=fundedFinale({betting:true});dealShadow(f,[100,1000]);declareShadow(f,0);expect(f.view(f.actors[1]).players[1]).toMatchObject({balance:0,available:0,committed:1000});expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');expect(f.view().players[1]).toMatchObject({balance:25,committed:1000,wager:1000});standRemaining(f);finishFinale(f);conserved(f);
  });
  it('supports an empty-Vault no-bid casino finale without inventing a player dealer or reward',()=>{
    const f=fundedFinale({pot:0,ranks:['10','9','8','10','9','8','7','7']});expect(f.view().party!.shadow!.entrantIds).toEqual(f.actors);expect(f.view().party!.shadow!.dealer).toMatchObject({role:'CASINO',ownerId:null});expect(f.room().party!.shadow!.cursor).toBe(8);declareShadow(f,0);expect(f.view(f.actors[1]).party!.shadow!.actions.callReward).toBe(0);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');expect(f.view().party!.shadow!.rewards).toEqual([expect.objectContaining({amount:0})]);standRemaining(f);finishFinale(f);conserved(f);
  });
  it('runs only zero-wager Shadow hands after two real rounds exhaust the finite Bank',()=>{
    const f=fixture({mode:'PARTY',players:4,finale:true,ranks:['A','A','A','10','K','K','K','7']});expect(f.send(f.host,'lobby:rounds',{rounds:2}).status).toBe('ok');f.start();expect(f.send(f.host,'house:bid',{amount:900}).status).toBe('ok');f.advance(22000);f.bet(1000);f.deal();expect(f.send(f.host,'dealer:stand').status).toBe('ok');expect(f.view().party!.bank.balance).toBe(3600);f.advance(24000);f.manager.e.shoe=()=>shoe(['A','10','K','7']);expect(f.send(f.actors[1]!,'bet:submit',{amount:2400}).status).toBe('ok');f.deal();expect(f.send(f.host,'dealer:stand').status).toBe('ok');expect(f.view().party!.bank.balance).toBe(0);f.advance(4000);expect(f.view().phase).toBe('SHADOW_BETTING');reject(f,f.actors[1]!,'bet:submit',{amount:1});dealShadow(f);expect(f.view().players.every(p=>p.wager===0)).toBe(true);standRemaining(f);finishFinale(f);expect(f.view().party!.bank.balance).toBe(0);expect(f.view().party!.vault).toBe(0);expect(f.view().players.map(p=>p.balance)).toEqual([0,7000,2500,2500]);conserved(f);
  });
});

describe('owner decisions share one fixed configured turn budget',()=>{
  it('allows repeated soft-ace Hits but never refreshes the turn deadline',()=>{
    const f=fundedFinale({turnSeconds:9,ranks:['A','9','10','2','8','8','2','3','2']}),deadline=f.view().deadline,first=f.view().decisionId;f.advance(2000);expect(f.send(f.host,'shadow:draw').status).toBe('ok');expect(evaluate(entry(f,0).hand)).toMatchObject({total:15,soft:true});expect(f.view().deadline).toBe(deadline);expect(f.view().decisionId).not.toBe(first);f.advance(2000);expect(f.send(f.host,'shadow:draw').status).toBe('ok');expect(f.view().deadline).toBe(deadline);expect(evaluate(entry(f,0).hand)).toMatchObject({total:18,soft:true});f.advance(5000);expect(entry(f,0)).toMatchObject({locked:true,revealed:true,effectiveTotal:18});expect(f.view().party!.shadow!.activePlayerId).toBe(f.actors[1]);conserved(f);
  });
  it('supports immediate claim and an atomic hidden draw-and-claim with idempotent retries',()=>{
    const immediate=fundedFinale();declareShadow(immediate,0);expect(entry(immediate,0).hand).toHaveLength(2);expect(immediate.view().phase).toBe('SHADOW_CHALLENGE');const f=fundedFinale(),command=f.command(f.host,'shadow:drawclaim'),ack=f.manager.command(f.host,command);expect(ack.status).toBe('ok');expect(entry(f,0).hand).toHaveLength(3);expect(evaluate(entry(f,0).hand).total).toBe(29);expect(f.view().deadline!-f.view().serverTime).toBe(8000);const after=structuredClone(f.room());expect(f.manager.command(f.host,command)).toEqual(ack);expect(f.room()).toEqual(after);conserved(f);
  });
  it('allows a hidden bust to claim 21, but rejects a further draw without exposing that bust',()=>{
    const f=fundedFinale();expect(f.send(f.host,'shadow:draw').status).toBe('ok');expect(evaluate(entry(f,0).hand).bust).toBe(true);reject(f,f.host,'shadow:draw');expect(f.view(f.actors[1]).party!.shadow!.entrants[0]!.value).toBeNull();declareShadow(f,0);expect(f.view().party!.shadow!.claim).toMatchObject({declaredTotal:21,status:'open'});conserved(f);
  });
  it('reveals and locks a truthful non-21 stand immediately without opening a call window',()=>{
    const f=fundedFinale();expect(f.send(f.host,'shadow:stand').status).toBe('ok');expect(entry(f,0)).toMatchObject({locked:true,revealed:true,effectiveTotal:19,claimUsed:false});expect(f.view().phase).toBe('SHADOW_TURN');expect(f.view().party!.shadow!.claims).toEqual([]);for(const actor of f.actors)expect(f.view(actor).party!.shadow!.entrants[0]!.value?.total).toBe(19);reject(f,f.host,'shadow:claim',{declaredTotal:21});
  });
  it.each([0,17,19,20,22,21.5,'21',null])('rejects unsupported client declaration %s atomically',declaredTotal=>{const f=fundedFinale();reject(f,f.host,'shadow:claim',{declaredTotal});});
  it('rejects another owner, stale IDs and client-picked cards before touching the shoe',()=>{
    const f=fundedFinale();reject(f,f.actors[1]!,'shadow:draw');reject(f,f.host,'shadow:draw',undefined,{decisionId:'stale'});reject(f,f.host,'shadow:drawclaim',undefined,{shadowId:'stale'});reject(f,f.host,'shadow:draw',{rank:'A',suit:'S',cardId:'forged'});
  });
});

describe('free calls have funded consequences and no point bonuses',()=>{
  it('pays a correct caller once and makes a caught bettor lose an otherwise winning wager',()=>{
    const f=fundedFinale({betting:true});dealShadow(f,[100]);declareShadow(f,0);const command=f.command(f.actors[1]!,'shadow:challenge'),ack=f.manager.command(f.actors[1]!,command);expect(ack.status).toBe('ok');expect(entry(f,0)).toMatchObject({revealed:true,disqualifiedReason:'CAUGHT_LIE'});expect(f.view().players[1]!.balance).toBe(1025);expect(f.view().party!.vault).toBe(75);const after=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,command)).toEqual(ack);expect(f.room()).toEqual(after);standRemaining(f);expect(f.view().roundPayouts).toEqual([expect.objectContaining({playerId:f.host,stake:100,returned:0,profit:-100})]);expect(f.view().party!.shadow!.awards.reduce((n,a)=>n+a.amount,0)).toBe(75);expect(f.view().party!.shadow!.rewards).toEqual([{claimId:expect.any(String),playerId:f.actors[1],amount:25}]);expect(f.view().matchStats.find(s=>s.playerId===f.actors[1])).toMatchObject({vaultWon:25,vaultVictories:0});expect(f.view().matchStats.find(s=>s.playerId===f.host)).toMatchObject({blackjackLosses:1,blackjackNet:-100});expect(f.view().matchStats.find(s=>s.playerId===f.actors[2])).toMatchObject({vaultWon:75,vaultVictories:1});conserved(f);
  });
  it('vindicates a true natural, transfers no wrong-call money, and forces the caller truthful while retaining their wager',()=>{
    const f=fundedFinale({betting:true,ranks:['A','10','10','K','7','8','2']});dealShadow(f,[100,100]);declareShadow(f,0);const before=f.view().players.map(p=>[p.balance,p.committed]);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');expect(f.view().players.map(p=>[p.balance,p.committed])).toEqual(before);expect(f.view().party!.vault).toBe(100);expect(entry(f,0)).toMatchObject({effectiveTotal:21,disqualifiedReason:null});expect(entry(f,1)).toMatchObject({revealed:true,forcedTruth:true,disqualifiedReason:'WRONG_CALL',callUsed:true});reject(f,f.actors[1]!,'shadow:claim',{declaredTotal:21});reject(f,f.actors[1]!,'shadow:drawclaim');expect(f.send(f.actors[1]!,'shadow:draw').status).toBe('ok');expect(evaluate(entry(f,1).hand).total).toBe(19);standRemaining(f);expect(f.view().roundPayouts.map(p=>p.returned)).toEqual([250,200]);expect(f.view().party!.shadow!.winnerIds).toEqual([f.host]);conserved(f);
  });
  it('keeps an uncalled busted29 as effective21, pays ordinary1:1, and awards the Vault without a fabricated natural',()=>{
    const f=fundedFinale({betting:true});dealShadow(f,[101]);expect(f.send(f.host,'shadow:drawclaim').status).toBe('ok');f.advance(8000);standRemaining(f);const s=f.view().party!.shadow!;expect(s.entrants[0]).toMatchObject({value:{total:29,bust:true},effectiveTotal:21,acceptedBluff:true});expect(f.view().roundPayouts[0]).toMatchObject({stake:101,returned:202,profit:101});expect(s.winnerIds).toEqual([f.host]);expect(s.vaultThiefIds).toEqual([f.host]);expect(f.view().players[0]!.balance).toBe(1201);conserved(f);
  });
  it('distinguishes odd genuine-natural3:2 from false21 ordinary1:1 while both tie at21 for the Vault',()=>{
    const f=fundedFinale({betting:true,ranks:['A','10','10','K','9','8']});dealShadow(f,[101,100]);declareShadow(f,0);f.advance(8000);declareShadow(f,1);f.advance(8000);standRemaining(f);expect(f.view().roundPayouts.map(p=>p.returned)).toEqual([252,200]);expect(f.view().party!.shadow!.winnerIds).toEqual(f.actors.slice(0,2));expect(f.view().party!.shadow!.awards.map(a=>a.amount)).toEqual([50,50]);conserved(f);
  });
  it('caps later correct-call rewards at the actual remaining Vault, including zero',()=>{
    const f=fundedFinale({players:4,pot:50,ranks:['10','10','10','10','8','7','6','9']});declareShadow(f,0);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');declareShadow(f,1);expect(f.send(f.actors[2]!,'shadow:challenge').status).toBe('ok');declareShadow(f,2);expect(f.view(f.actors[3]).party!.shadow!.actions.callReward).toBe(0);expect(f.send(f.actors[3]!,'shadow:challenge').status).toBe('ok');expect(f.view().party!.shadow!.rewards.map(r=>r.amount)).toEqual([25,25,0]);standRemaining(f);expect(f.view().party!.shadow!.awards.reduce((n,a)=>n+a.amount,0)).toBe(0);conserved(f);
  });
  it('caps a correct-call reward at a smaller17-chip remainder without touching other funds',()=>{
    const f=fundedFinale(),r=f.room(),s=r.party!.shadow!;r.players[2]!.account.balance+=83;r.party!.vault=17;s.pot=17;conserved(f);declareShadow(f,0);const bank=structuredClone(f.view().party!.bank),bonus=f.view().party!.bonusReserve;expect(f.view(f.actors[1]).party!.shadow!.actions.callReward).toBe(17);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');expect(f.view().players[1]!.balance).toBe(1017);expect(f.view().party!.shadow!.rewards[0]!.amount).toBe(17);expect(f.view().party!.vault).toBe(0);expect(f.view().party!.bank).toEqual(bank);expect(f.view().party!.bonusReserve).toBe(bonus);standRemaining(f);finishFinale(f);conserved(f);
  });
  it('accepts only the first simultaneous caller and enforces one call per entrant across windows',()=>{
    const f=fundedFinale({players:4});declareShadow(f,0);reject(f,f.host,'shadow:challenge');reject(f,f.actors[1]!,'shadow:challenge',undefined,{shadowClaimId:'stale'});const first=f.command(f.actors[1]!,'shadow:challenge'),second=f.command(f.actors[2]!,'shadow:challenge');expect(f.manager.command(f.actors[1]!,first).status).toBe('ok');const called=structuredClone(f.room());expect(f.manager.command(f.actors[2]!,second).status).toBe('rejected');expect(f.room()).toEqual(called);declareShadow(f,1);reject(f,f.actors[0]!,'shadow:challenge');expect(f.send(f.actors[2]!,'shadow:challenge').status).toBe('ok');declareShadow(f,2);reject(f,f.actors[1]!,'shadow:challenge');conserved(f);
  });
  it('rejects a second call by an otherwise eligible correct caller without a disqualification shortcut',()=>{
    const f=fundedFinale({players:4});declareShadow(f,0);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');expect(f.send(f.actors[1]!,'shadow:stand').status).toBe('ok');declareShadow(f,2);expect(entry(f,1)).toMatchObject({callUsed:true,disqualifiedReason:null});reject(f,f.actors[1]!,'shadow:challenge');expect(f.send(f.actors[3]!,'shadow:challenge').status).toBe('ok');conserved(f);
  });
});

describe('the House uses the same one dealer hand; casino never bluffs',()=>{
  it('allows a free House call before its own turn, then a claim with the actual dealer hand',()=>{
    const f=fundedFinale();declareShadow(f,0);const house=f.actors[2]!;expect(f.send(house,'shadow:challenge').status).toBe('ok');expect(f.view().party!.shadow!.rewards[0]).toMatchObject({playerId:house,amount:25});standTo(f,2);declareShadow(f,2);f.advance(8000);expect(f.view().party!.shadow!.dealer).toMatchObject({playerId:house,effectiveTotal:21,acceptedBluff:true});expect(f.view().party!.shadow!.winnerIds).toEqual([house]);conserved(f);
  });
  it.each([false,true])('an accepted false dealer21 wins; catching it instead pays surviving backed bettors; challenged=%s',challenged=>{
    const f=fundedFinale({betting:true,ranks:['10','10','10','9','8','9','10']});dealShadow(f,[100,100]);standTo(f,2);expect(f.send(f.actors[2]!,'shadow:drawclaim').status).toBe('ok');if(challenged)expect(f.send(f.host,'shadow:challenge').status).toBe('ok');else f.advance(8000);expect(f.view().phase).toBe('SHADOW_RESULT');expect(f.view().roundPayouts.map(p=>p.returned)).toEqual(challenged?[200,200]:[0,0]);expect(f.view().party!.shadow!.dealer).toMatchObject(challenged?{disqualifiedReason:'CAUGHT_LIE',value:{bust:true}}:{effectiveTotal:21,acceptedBluff:true,value:{bust:true}});conserved(f);
  });
  it('automates the casino truthfully to17 without a casino claim window',()=>{
    const f=fundedFinale({pot:0,ranks:['10','10','10','5','8','7','6','5','7']});standRemaining(f);expect(f.view().party!.shadow!.dealer.value).toMatchObject({total:17});expect(f.view().party!.shadow!.claims).toEqual([]);expect(f.view().party!.shadow!.dealer.hand).toHaveLength(3);conserved(f);
  });
});

describe('exact clocks, disconnect, finalization and replay',()=>{
  it('rejects a call at exactly8seconds without consuming the caller allowance',()=>{
    const f=fundedFinale();declareShadow(f,0);const late=f.command(f.actors[1]!,'shadow:challenge');f.advance(7999);expect(f.view().phase).toBe('SHADOW_CHALLENGE');f.advance(1);const after=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,late).status).toBe('rejected');expect(f.room()).toEqual(after);expect(entry(f,1).callUsed).toBe(false);
  });
  it('preserves the full open claim window and hidden cards through claimant disconnect/reconnect',()=>{
    const f=fundedFinale();expect(f.send(f.host,'shadow:drawclaim').status).toBe('ok');const deadline=f.view().deadline,hand=structuredClone(entry(f,0).hand);f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().deadline).toBe(deadline);expect(entry(f,0).hand).toEqual(hand);f.advance(7999);expect(f.view().phase).toBe('SHADOW_CHALLENGE');f.advance(1);expect(entry(f,0).effectiveTotal).toBe(21);conserved(f);
  });
  it('truthfully auto-stands a disconnected bettor and retains the funded wager',()=>{
    const f=fundedFinale({betting:true});dealShadow(f,[100]);const deadline=f.view().deadline;f.advance(3000);f.manager.presence(f.host,false);expect(entry(f,0)).toMatchObject({locked:true,revealed:true,effectiveTotal:19});expect(f.view(f.actors[1]).players[0]!.committed).toBe(100);f.manager.presence(f.host,true);expect(f.view().deadline).not.toBe(deadline);standRemaining(f);finishFinale(f);conserved(f);
  });
  it('retains an accepted declaration and original Vault rights after explicit departure',()=>{
    const f=fundedFinale();standTo(f,1);declareShadow(f,1);const deadline=f.view().deadline;expect(f.send(f.actors[1]!,'room:leave').status).toBe('ok');expect(f.view().deadline).toBe(deadline);f.advance(8000);standRemaining(f);finishFinale(f);expect(f.view().party!.shadow!.winnerIds).toEqual([f.actors[1]]);expect(f.view().players[1]!.departed).toBe(true);expect(f.send(f.actors[1]!,'shadow:claim',{declaredTotal:21}).status).toBe('rejected');conserved(f);
  });
  it('refunds reservations and shares the Vault equally if recovery ends before the first card',()=>{
    const f=fundedFinale({betting:true,bettingSeconds:120});expect(f.send(f.host,'bet:submit',{amount:100}).status).toBe('ok');for(const actor of f.actors)f.manager.presence(actor,false);f.advance(60000);expect(f.view().phase).toBe('RESULTS');expect(f.view().party!.shadow).toBeNull();expect(f.view().players.map(p=>p.balance)).toEqual([1034,1033,933]);expect(f.view().players.every(p=>p.committed===0&&p.reserved===0)).toBe(true);expect(f.view().party!.bank.committed).toBe(0);conserved(f);
  });
  it('drains dealt hands after all players disconnect without shortening an open call window or stranding money',()=>{
    const f=fundedFinale({betting:true});dealShadow(f,[100,100]);declareShadow(f,0);const deadline=f.view().deadline;for(const actor of f.actors)f.manager.presence(actor,false);expect(f.view().deadline).toBe(deadline);f.advance(7999);expect(f.view().phase).toBe('SHADOW_CHALLENGE');f.advance(60001);expect(f.view().phase).toBe('RESULTS');expect(f.view().party!.vault).toBe(0);const paid=structuredClone(f.room().players.map(p=>p.account));for(const actor of f.actors)f.manager.presence(actor,true);expect(f.room().players.map(p=>p.account)).toEqual(paid);conserved(f);
  });
  it('honors a free call already open when recovery expires, while later financial admission remains closed',()=>{
    const f=fundedFinale({turnSeconds:120});for(const actor of f.actors.slice(1))f.manager.presence(actor,false);f.advance(59000);declareShadow(f,0);const deadline=f.view().deadline;f.advance(1000);expect(f.room().terminationConfirmed).toBe(true);expect(f.view().phase).toBe('SHADOW_CHALLENGE');expect(f.view().deadline).toBe(deadline);f.manager.presence(f.actors[1]!,true);expect(f.view(f.actors[1]).party!.shadow!.actions.canCall).toBe(true);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');expect(f.view().party!.shadow!.rewards[0]).toMatchObject({playerId:f.actors[1],amount:25});finishFinale(f);expect(f.view().phase).toBe('RESULTS');expect(f.view().party!.vault).toBe(0);conserved(f);
  });
  it('settles Bank then remaining Vault once, releases the bond, and resets only when replay starts',()=>{
    const f=fundedFinale({betting:true});dealShadow(f,[100]);declareShadow(f,0);f.advance(8000);standRemaining(f);const id=f.view().party!.shadow!.id,match=f.view().matchId;expect(f.room().party!.bank.rounds.filter(r=>r.roundId===id)).toHaveLength(1);finishFinale(f);const paid=structuredClone(f.room().players.map(p=>p.account));f.advance(10000);expect(f.room().players.map(p=>p.account)).toEqual(paid);expect(f.view().players.every(p=>p.committed===0&&p.reserved===0)).toBe(true);const command=f.command(f.host,'results:return'),ack=f.manager.command(f.host,command);expect(ack.status).toBe('ok');expect(f.view()).toMatchObject({phase:'LOBBY',party:null,finaleEnabled:true});f.start();expect(f.view().matchId).not.toBe(match);const restarted=structuredClone(f.room());expect(f.manager.command(f.host,command)).toEqual(ack);expect(f.room()).toEqual(restarted);conserved(f);
  });
});
