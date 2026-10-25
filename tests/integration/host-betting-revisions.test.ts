import {describe,expect,it,vi} from 'vitest';
import {BET_CHIPS,RULES,validAmount,validBetAmount} from '@bluff-house/shared';
import {assertRoom,results} from '../../apps/server/src/game/engine.js';
import {payout} from '../../apps/server/src/game/blackjack.js';
import {reserve} from '../../apps/server/src/game/ledger.js';
import {fixture,shoe} from '../fixtures/core.js';

type F=ReturnType<typeof fixture>;
function config(f:F,patch:Record<string,unknown>={}){const v=f.view();return {settings:v.settings,rounds:v.roundLimit,finale:v.finaleEnabled,visibility:v.visibility,startingChips:v.startingChips,bettingSeconds:v.bettingSeconds,turnSeconds:v.turnSeconds,...patch};}
function finish(f:F){for(let n=0;n<500&&f.view().phase!=='RESULTS';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else {expect(v.deadline).not.toBeNull();f.advance(v.deadline!-v.serverTime);}}expect(f.view().phase).toBe('RESULTS');assertRoom(f.room());}

describe('additive whole-chip Blackjack funding',()=>{
  it('advertises regular chip denominations without changing social-stake validation',()=>{
    expect(BET_CHIPS).toEqual([10,20,50,100,500,1000]);for(const amount of BET_CHIPS)expect(validBetAmount(amount)).toBe(true);
    expect(validBetAmount(1)).toBe(true);expect(validBetAmount(173)).toBe(true);for(const amount of [10,20,500,1000,173])expect(validAmount(amount)).toBe(false);expect(validAmount(250)).toBe(true);
  });
  it('funds a mixed-chip pot beyond the old fixed choices, replaces it, withdraws it, and accepts an all-in remainder',()=>{
    const f=fixture();f.start();const amount=500+100+50+20+10+10;
    expect(f.send(f.host,'bet:submit',{amount}).status).toBe('ok');expect(f.view().players[0]).toMatchObject({balance:1000,reserved:690,available:310,wager:690});
    const command=f.command(f.host,'bet:submit',{amount:1000}),ack=f.manager.command(f.host,command);expect(ack.status).toBe('ok');expect(f.manager.command(f.host,command)).toEqual(ack);expect(f.view().players[0]).toMatchObject({reserved:1000,available:0,wager:1000});
    expect(f.send(f.host,'bet:withdraw').status).toBe('ok');expect(f.view().players[0]).toMatchObject({reserved:0,available:1000,wager:0});
    reserve(f.room().players[0]!.account,'unrelated-reservation',827);expect(f.send(f.host,'bet:submit',{amount:173}).status).toBe('ok');const before=structuredClone(f.room());expect(f.send(f.host,'bet:submit',{amount:174}).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it.each([0,-1,1.5,'100',null,NaN,Infinity,Number.MAX_SAFE_INTEGER])('rejects malformed or unsafe Blackjack amount %s atomically',amount=>{
    const f=fixture();f.start();f.bet(10);const before=structuredClone(f.room());expect(f.send(f.host,'bet:submit',{amount}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('settles an odd all-in natural in whole chips while conserving the room ledger',()=>{
    const f=fixture({ranks:['A','10','10','K','7','8']});f.start();expect(f.send(f.host,'bet:submit',{amount:173}).status).toBe('ok');expect(f.send(f.actors[1]!,'bet:submit',{amount:10}).status).toBe('ok');f.deal();finish(f);
    expect(f.view().players[0]!.balance).toBe(1259);expect(f.room().dealerNet).toBe(249);expect(payout(shoe(['A','K']).slice(0,2),shoe(['10','8']).slice(0,2),1)).toEqual({outcome:'blackjack',returned:2,profit:1});assertRoom(f.room());
  });
  it('allows an ordinary funded Double beyond the old 250-chip wager limit',()=>{
    const f=fixture({mode:'PARTY'});f.start();f.advance(22000);f.bet(500);f.deal();expect(f.send(f.host,'turn:double').status).toBe('ok');expect(f.view().players[0]).toMatchObject({wager:1000,committed:1000,balance:0,doubled:true});assertRoom(f.room());
  });
  it('retains the existing 750-chip Chaos multiplier cap for larger ordinary wagers',()=>{
    const f=fixture({mode:'PARTY'});f.start();f.advance(22000);f.bet(500);f.room().party!.chaos.inventories[f.host]=[{id:'large-wager-chaos',kind:'DOUBLE_DOWN'}];const before=structuredClone(f.room());expect(f.send(f.host,'chaos:activate',{cardId:'large-wager-chaos'}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
});

describe('host controls and same-room history',()=>{
  it('applies starting chips and configured betting/turn clocks on the server, with readiness invalidation and replay retention',()=>{
    const f=fixture();for(const actor of f.actors)f.send(actor,'lobby:ready',{ready:true});const old=f.view().lobbyId;
    expect(f.send(f.host,'lobby:settings',config(f,{rounds:4,startingChips:5000,bettingSeconds:7,turnSeconds:9})).status).toBe('ok');expect(f.view()).toMatchObject({roundLimit:4,startingChips:5000,bettingSeconds:7,turnSeconds:9});expect(f.view().lobbyId).not.toBe(old);expect(f.view().players.every(p=>!p.ready&&p.balance===5000)).toBe(true);
    f.start();expect(f.room().initialChips).toBe(10000);expect(f.view().deadline!-f.view().serverTime).toBe(7000);f.bet(1000);f.advance(7000+RULES.dealingMs);expect(f.view().phase).toBe('PLAYER_TURN');expect(f.view().deadline!-f.view().serverTime).toBe(9000);f.advance(8999);expect(f.view().activePlayerId).toBe(f.host);f.advance(1);expect(f.view().activePlayerId).toBe(f.actors[1]);finish(f);
    expect(f.send(f.host,'results:return').status).toBe('ok');expect(f.view()).toMatchObject({roundLimit:4,startingChips:5000,bettingSeconds:7,turnSeconds:9});expect(f.view().players.every(p=>p.balance===5000)).toBe(true);
  });
  it.each([{rounds:0},{rounds:21},{rounds:1.5},{startingChips:99},{startingChips:100001},{startingChips:105},{startingChips:null},{bettingSeconds:4},{bettingSeconds:121},{bettingSeconds:'20'},{turnSeconds:5.5},{turnSeconds:null}])('rejects invalid custom host configuration %j atomically',patch=>{
    const f=fixture();const before=structuredClone(f.room());expect(f.send(f.host,'lobby:settings',config(f,patch)).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('enforces host-only controls and immutable numeric settings during a match',()=>{
    const f=fixture(),before=structuredClone(f.room());expect(f.send(f.actors[1]!,'lobby:settings',config(f,{startingChips:5000})).status).toBe('rejected');expect(f.room()).toEqual(before);f.start();const started=structuredClone(f.room());expect(f.send(f.host,'lobby:settings',config(f,{turnSeconds:30})).status).toBe('rejected');expect(f.room()).toEqual(started);
  });
  it('starts newly joined guests with the configured stack and prevents custom tables being mistaken for default Quick Play',()=>{
    const f=fixture();expect(f.send(f.host,'lobby:settings',config(f,{startingChips:5000,visibility:'PUBLIC'})).status).toBe('ok');expect(f.send('new-guest','room:join',{username:'New Guest',roomCode:f.view().code}).status).toBe('ok');expect(f.view().players.find(p=>p.id==='new-guest')!.balance).toBe(5000);expect(f.send('quick-guest','room:quickplay',{username:'Quick Guest',preset:'CLASSIC'}).status).toBe('ok');expect(f.manager.snapshot('quick-guest')!.instanceId).not.toBe(f.view().instanceId);
  });
  it('kicks only another same-lobby guest, clears readiness, notifies them once, and permits a new authorized join',()=>{
    const f=fixture({players:3}),kicked=f.actors[1]!,onKick=vi.fn();f.manager.onKick=onKick;for(const actor of f.actors)f.send(actor,'lobby:ready',{ready:true});const old=f.view().lobbyId,command=f.command(f.host,'lobby:kick',{playerId:kicked}),ack=f.manager.command(f.host,command);expect(ack.status).toBe('ok');expect(f.manager.snapshot(kicked)).toBeNull();expect(f.view().players.map(p=>p.id)).toEqual([f.host,f.actors[2]]);expect(f.view().players.every(p=>!p.ready)).toBe(true);expect(f.view().lobbyId).not.toBe(old);expect(onKick).toHaveBeenCalledExactlyOnceWith(kicked);expect(f.manager.command(f.host,command)).toEqual(ack);expect(onKick).toHaveBeenCalledTimes(1);expect(f.send(kicked,'room:join',{username:'Returning Guest',roomCode:f.view().code}).status).toBe('ok');assertRoom(f.room());
  });
  it('rejects nonhost, stale, self, foreign-room and live-match kick attempts without mutating membership',()=>{
    const f=fixture({players:3});for(const [actor,playerId] of [[f.actors[1]!,f.actors[2]!],[f.host,f.host],[f.host,'outsider']]){const before=structuredClone(f.room());expect(f.send(actor,'lobby:kick',{playerId}).status).toBe('rejected');expect(f.room()).toEqual(before);}expect(f.send(f.host,'lobby:kick',{playerId:f.actors[1]},{lobbyId:'stale-lobby'}).status).toBe('rejected');f.start();const before=structuredClone(f.room());expect(f.send(f.host,'lobby:kick',{playerId:f.actors[1]}).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.manager.roomFor(f.actors[1]!)).toBe(f.room());
  });
  it('records tied winners exactly once and retains totals through replay and a same-cookie leave/rejoin',()=>{
    const f=fixture();expect(f.send(f.host,'lobby:rounds',{rounds:1}).status).toBe('ok');f.start();finish(f);expect(f.view().players.map(p=>p.lobbyWins)).toEqual([1,1]);results(f.room(),f.manager.e,f.view().serverTime);expect(f.view().players.map(p=>p.lobbyWins)).toEqual([1,1]);expect(f.send(f.host,'results:return').status).toBe('ok');const guest=f.actors[1]!;expect(f.send(guest,'room:leave').status).toBe('ok');expect(f.send(guest,'room:join',{username:'Returning Winner',roomCode:f.view().code}).status).toBe('ok');expect(f.view().players.map(p=>p.lobbyWins)).toEqual([1,1]);f.start();finish(f);expect(f.view().players.map(p=>p.lobbyWins)).toEqual([2,2]);
  });
  it('accepts funded House bids up to 900 and continues sealing other bids until reveal',()=>{
    const f=fixture({mode:'PARTY'});f.start();expect(f.send(f.host,'house:bid',{amount:900}).status).toBe('ok');expect(f.view(f.actors[1]).party!.auction.bids[0]).toEqual({playerId:f.host,submitted:true});const before=structuredClone(f.room());expect(f.send(f.host,'house:bid',{amount:950}).status).toBe('rejected');expect(f.room()).toEqual(before);f.advance(20000);expect(f.view().party!.auction).toMatchObject({winningBid:900,winnerId:f.host});expect(f.view().players[0]!.balance).toBe(100);assertRoom(f.room());
  });
});
