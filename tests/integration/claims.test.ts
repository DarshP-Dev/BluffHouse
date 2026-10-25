import {describe,expect,it} from 'vitest';
import {RULES,type ClaimType,type Rank} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {reserve} from '../../apps/server/src/game/ledger.js';
import {fixture} from '../fixtures/core.js';

type F=ReturnType<typeof fixture>;
function hand(ranks:Rank[]=['6','9','10','6','8','7','3','2','10'],players=2){const f=fixture({mode:'PARTY',players,ranks});f.start();f.advance(22000);f.bet(100);f.deal();return f;}
const offer=(f:F,type:ClaimType,amount=100)=>f.send(f.view().activePlayerId!,'bluff:offer',{claimType:type,amount});
function accepted(f:F,type:ClaimType,amount=100){expect(offer(f,type,amount).status).toBe('ok');expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('ok');}
function finish(f:F){for(let n=0;n<30&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);}expect(f.view().phase).toBe('ROUND_RESULT');assertRoom(f.room());}

describe('funded exact21 immediate claim without Classic rule changes',()=>{
  it.each<[Rank,number]>([['9',0],['3',1],['K',1]])('forces exactly one%s card and settles the exact21 predicate to the real winner',(hit,winner)=>{
    const f=hand(['6','9','10','6','8','7',hit]),cursor=f.room().cursor;accepted(f,'NEXT_HIT_EXACT_21',200);expect(f.room().cursor).toBe(cursor+1);expect(f.view().bluff).toMatchObject({claimType:'NEXT_HIT_EXACT_21',timing:'IMMEDIATE',settlement:'settled',winnerId:f.actors[winner],pot:400,evidence:{claimTrue:winner===0}});expect(f.view().pendingClaims).toEqual([]);expect(f.view().claimOutcomes).toHaveLength(1);expect(f.view().players[winner]!.bluffWins).toBe(1);expect(f.view().bluff!.evidence).not.toHaveProperty('dealerTotal');assertRoom(f.room());
  });
  it('rejects additional claims in Classic or when extraClaims is disabled but retains NEXT_HIT_SAFE',()=>{
    const classic=fixture({ranks:['6','9','10','6','8','7','3']});classic.start();classic.bet();classic.deal();const before=structuredClone(classic.room());for(const claimType of ['NEXT_HIT_EXACT_21','BEAT_DEALER','THREE_CARD_WIN','DEALER_BUST'])expect(classic.send(classic.host,'bluff:offer',{claimType,amount:50}).status).toBe('rejected');expect(classic.room()).toEqual(before);expect(classic.view().claimRegistry.map(r=>r.type)).toEqual(['NEXT_HIT_SAFE']);expect(classic.send(classic.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:50}).status).toBe('ok');
    const f=fixture({mode:'PARTY',ranks:['6','9','10','6','8','7','3']});expect(f.send(f.host,'lobby:settings',{settings:{...f.view().settings,extraClaims:false},rounds:3,finale:false,visibility:'PRIVATE'}).status).toBe('ok');f.start();f.advance(22000);f.bet();f.deal();expect(offer(f,'BEAT_DEALER').status).toBe('rejected');expect(offer(f,'NEXT_HIT_SAFE').status).toBe('ok');
  });
});

describe('accepted deferred claims keep escrow until actual dealer settlement',()=>{
  it.each<ClaimType>(['BEAT_DEALER','THREE_CARD_WIN','DEALER_BUST'])('accepts%s without drawing, paying chips, publishing dealer truth or updating win statistics',type=>{
    const f=hand(),before=structuredClone(f.room()),cursor=f.room().cursor;accepted(f,type);expect(f.view().phase).toBe('BLUFF_REVEAL');expect(f.room().cursor).toBe(cursor);expect(f.view().players.map(p=>p.hand)).toEqual(before.players.map(p=>p.hand));expect(f.view().players.map(p=>[p.balance,p.committed,p.bluffWins,p.bluffLosses])).toEqual([[800,200,0,0],[800,200,0,0]]);expect(f.view().pendingClaims).toHaveLength(1);expect(f.view().claimOutcomes).toEqual([]);
    for(const actor of f.actors){const v=f.view(actor);expect(v.dealer[1]).toBeNull();expect(v.dealerValue).toBeNull();for(const claim of [v.bluff!,...v.pendingClaims]){expect(claim).toMatchObject({settlement:'pending',timing:'ROUND_RESULT',claimType:type});for(const key of ['evidence','proof','lockedHands','card','winnerId'])expect(claim).not.toHaveProperty(key);}}assertRoom(f.room());
  });
  it('resumes an unchanged ordinary hand with a fresh decision and at least five seconds after confirmation',()=>{
    const f=hand();f.advance(19900);const previous=f.view().decisionId;accepted(f,'BEAT_DEALER');f.advance(RULES.revealMs);expect(f.view().phase).toBe('PLAYER_TURN');expect(f.view().decisionId).not.toBe(previous);expect(f.view().deadline!-f.view().serverTime).toBe(5000);expect(f.view().players[0]!.hand).toHaveLength(2);expect(f.send(f.host,'turn:hit').status).toBe('ok');expect(f.view().players[0]!.hand).toHaveLength(3);expect(f.view().pendingClaims).toHaveLength(1);assertRoom(f.room());
  });
  it.each<[Rank[],ClaimType,boolean]>([
    [['10','9','10','8','8','7'],'BEAT_DEALER',true],
    [['10','9','10','7','8','7'],'BEAT_DEALER',false],
    [['6','9','10','6','8','7','8'],'THREE_CARD_WIN',true],
    [['10','9','10','8','8','7'],'THREE_CARD_WIN',false],
    [['10','9','10','8','8','6','10'],'DEALER_BUST',true],
    [['6','9','10','6','8','7'],'DEALER_BUST',false],
  ])('settles%s from the actual end-of-round Blackjack result',(ranks,type,wins)=>{
    const f=hand(ranks);accepted(f,type);f.advance(RULES.revealMs);if(type==='THREE_CARD_WIN'&&wins)expect(f.send(f.host,'turn:hit').status).toBe('ok');finish(f);const outcome=f.view().claimOutcomes[0]!;expect(outcome).toMatchObject({claimType:type,settlement:'settled',winnerId:f.actors[wins?0:1],evidence:{claimTrue:wins}});expect(f.view().pendingClaims).toEqual([]);expect(f.view().players.map(p=>p.bluffWins)).toEqual(wins?[1,0]:[0,1]);expect(outcome.evidence).toHaveProperty('dealerTotal');expect(outcome).not.toHaveProperty('card');const after=structuredClone(f.room());expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('rejected');expect(f.room()).toEqual(after);assertRoom(f.room());
  });
  it('keeps the dealer-bust claim independent of a claimant bust and settles its actual matched pot',()=>{
    const f=hand(['10','9','10','6','8','6','K','10']);accepted(f,'DEALER_BUST');f.advance(RULES.revealMs);expect(f.send(f.host,'turn:hit').status).toBe('ok');expect(f.view().players[0]!.value!.bust).toBe(true);finish(f);expect(f.view().claimOutcomes[0]).toMatchObject({winnerId:f.host,evidence:{playerBust:true,dealerBust:true,claimTrue:true,playerOutcome:'loss'}});assertRoom(f.room());
  });
  it('expires without a forced draw, commitment or outcome while retaining the shared one-offer allowance',()=>{
    const f=hand(),cursor=f.room().cursor;expect(offer(f,'BEAT_DEALER').status).toBe('ok');f.advance(RULES.offerMs);expect(f.room().cursor).toBe(cursor);expect(f.view().pendingClaims).toEqual([]);expect(f.view().claimOutcomes).toEqual([]);expect(f.view().players[0]).toMatchObject({reserved:0,committed:100,bluffUsed:true});const before=structuredClone(f.room());expect(offer(f,'NEXT_HIT_EXACT_21').status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('rejects unfunded acceptance and scoped stale IDs atomically without releasing the claimant reservation',()=>{
    const f=hand();offer(f,'THREE_CARD_WIN',250);reserve(f.room().players[1]!.account,'other-obligation',850);const before=structuredClone(f.room());expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('rejected');expect(f.send(f.actors[1]!,'bluff:accept',undefined,{offerId:'old-offer'}).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().pendingClaims).toEqual([]);
  });
  it('protects both funded participants from Second Chance while preserving ordinary Hits and Stand',()=>{
    const f=hand();accepted(f,'BEAT_DEALER');f.advance(RULES.revealMs);expect(f.send(f.host,'turn:hit').status).toBe('ok');f.room().party!.chaos.inventories[f.host]=[{id:'protected-claimant',kind:'SECOND_CHANCE'}];let before=structuredClone(f.room());expect(f.send(f.host,'chaos:activate',{cardId:'protected-claimant'}).status).toBe('rejected');expect(f.room()).toEqual(before);f.send(f.host,'turn:stand');expect(f.send(f.actors[1]!,'turn:hit').status).toBe('ok');f.room().party!.chaos.inventories[f.actors[1]!]=[{id:'protected-caller',kind:'SECOND_CHANCE'}];before=structuredClone(f.room());expect(f.send(f.actors[1]!,'chaos:activate',{cardId:'protected-caller'}).status).toBe('rejected');expect(f.room()).toEqual(before);finish(f);expect(f.view().claimOutcomes).toHaveLength(1);assertRoom(f.room());
  });
  it('permits independent funded pending outcomes across players without overlapping offers or premature statistics',()=>{
    const f=hand(['6','7','9','10','6','7','8','7','3'],3);accepted(f,'BEAT_DEALER',50);f.advance(2000);f.send(f.host,'turn:stand');expect(offer(f,'DEALER_BUST',50).status).toBe('ok');expect(f.send(f.actors[2]!,'bluff:accept').status).toBe('ok');expect(f.view().pendingClaims).toHaveLength(2);expect(f.view().claimOutcomes).toEqual([]);f.advance(2000);finish(f);expect(f.view().pendingClaims).toEqual([]);expect(f.view().claimOutcomes).toHaveLength(2);assertRoom(f.room());
  });
});

describe('deferred claim lifecycle and once-only proof history',()=>{
  it('keeps the earliest accepted equal-size pot as Biggest Bluff even when a later immediate claim settles first',()=>{
    const f=hand(['6','7','9','10','6','7','8','7','3'],3);accepted(f,'BEAT_DEALER',100);const first=f.view().pendingClaims[0]!.id;f.advance(2000);f.send(f.host,'turn:stand');expect(offer(f,'NEXT_HIT_SAFE',100).status).toBe('ok');expect(f.send(f.actors[2]!,'bluff:accept').status).toBe('ok');const second=f.view().bluff!.id;expect(second).not.toBe(first);f.advance(2000);finish(f);expect(f.room().biggestBluff!.id).toBe(first);expect(f.view().claimOutcomes.map(o=>o.id)).toContain(second);assertRoom(f.room());
  });
  it('keeps accepted escrow binding after both participants leave and drains it before early results',()=>{
    const f=hand(['6','7','9','10','6','7','8','7','3'],3),roomId=f.room().instanceId;accepted(f,'BEAT_DEALER');expect(f.send(f.actors[1]!,'room:leave').status).toBe('ok');expect(f.send(f.host,'room:leave').status).toBe('ok');f.advance(180000);const r=f.manager.rooms.get(roomId)!;expect(r.phase).toBe('RESULTS');expect(r.pendingClaims).toEqual([]);expect(r.bluffOutcomes).toHaveLength(1);expect(r.players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(r.players.reduce((n,p)=>n+p.bluffWins,0)).toBe(1);assertRoom(r);
  });
  it('restores the same pending contract on reconnect, deduplicates acceptance, and resets obligations on replay',()=>{
    const f=hand();offer(f,'BEAT_DEALER');const c=f.command(f.actors[1]!,'bluff:accept'),ack=f.manager.command(f.actors[1]!,c);expect(ack.status).toBe('ok');const pending=structuredClone(f.view().pendingClaims);f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().pendingClaims).toEqual(pending);expect(f.manager.command(f.actors[1]!,c)).toEqual(ack);f.advance(2000);finish(f);expect(f.view().claimOutcomes).toHaveLength(1);for(let n=0;n<100&&f.view().phase!=='RESULTS';n++){const v=f.view();f.advance(v.deadline!-v.serverTime);}const old=f.command(f.host,'bluff:offer',{claimType:'DEALER_BUST',amount:50});expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.view().pendingClaims).toEqual([]);expect(f.view().claimOutcomes).toEqual([]);expect(f.view().players.every(p=>!p.doubled)).toBe(true);const before=structuredClone(f.room());expect(f.manager.command(f.host,old).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
});
