import {describe,expect,it} from 'vitest';
import {RULES,type Rank} from '@bluff-house/shared';
import {doubleReason} from '../../apps/server/src/game/blackjack.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {reserve} from '../../apps/server/src/game/ledger.js';
import {fixture} from '../fixtures/core.js';

function hand(ranks:Rank[]=['6','9','10','6','8','7','3','2'],amount=100){const f=fixture({mode:'PARTY',ranks});f.start();f.advance(22000);f.bet(amount);f.deal();return f;}
function finish(f:ReturnType<typeof fixture>){for(let n=0;n<25&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')f.send(v.activePlayerId!,'turn:stand');else f.advance(v.deadline!-v.serverTime);}expect(f.view().phase).toBe('ROUND_RESULT');assertRoom(f.room());}

describe('funded ordinary Party Double Down',()=>{
  it.each([50,100,250])('commits one equal extra%i-chip stake and draws exactly one forced card before standing',amount=>{
    const f=hand(undefined,amount),before=structuredClone(f.room()),p=f.room().players[0]!,c=f.command(f.host,'turn:double'),ack=f.manager.command(f.host,c);expect(doubleReason(before,before.players[0]!)).toBeNull();expect(ack.status).toBe('ok');expect(f.view().players[0]).toMatchObject({balance:1000-2*amount,wager:2*amount,committed:2*amount,doubled:true,status:'stood'});expect(f.room().players[0]!.account.escrows[p.wagerId!]).toBe(2*amount);expect(f.room().players[0]!.hand).toHaveLength(3);expect(f.room().cursor).toBe(before.cursor+1);expect(f.view().activePlayerId).toBe(f.actors[1]);const after=structuredClone(f.room());expect(f.manager.command(f.host,c)).toEqual(ack);expect(f.send(f.host,'turn:double').status).toBe('rejected');expect(f.room()).toEqual(after);finish(f);expect(f.view().roundPayouts[0]).toMatchObject({stake:2*amount,returned:0,profit:-2*amount});
  });
  it('allows an initial soft hand but settles its forced21 as a normal doubled win',()=>{
    const f=hand(['A','10','10','7','8','7','3'],250);expect(f.view().players[0]!.value).toMatchObject({soft:true,total:18});expect(f.send(f.host,'turn:double').status).toBe('ok');finish(f);expect(f.view().roundPayouts[0]).toMatchObject({stake:500,returned:1000,profit:500});expect(f.view().players[0]!.balance).toBe(1500);assertRoom(f.room());
  });
  it('ends a doubled bust without allowing another action or undoing its extra funded stake',()=>{
    const f=hand(['10','9','10','6','8','7','K']);expect(f.send(f.host,'turn:double').status).toBe('ok');expect(f.view().players[0]).toMatchObject({status:'bust',doubled:true,value:{total:26,bust:true},wager:200,balance:800});const before=structuredClone(f.room());expect(f.send(f.host,'turn:hit').status).toBe('rejected');expect(f.room()).toEqual(before);finish(f);expect(f.view().roundPayouts[0]!.returned).toBe(0);
  });
  it('rejects an unfunded or stale double and rolls back both money and cards when the shoe is exhausted',()=>{
    const f=hand();reserve(f.room().players[0]!.account,'other-obligation',850);let before=structuredClone(f.room());expect(f.send(f.host,'turn:double').status).toBe('rejected');expect(f.room()).toEqual(before);const g=hand();before=structuredClone(g.room());expect(g.send(g.host,'turn:double',undefined,{decisionId:'old-decision'}).status).toBe('rejected');expect(g.room()).toEqual(before);g.room().shoe.length=g.room().cursor;before=structuredClone(g.room());expect(g.send(g.host,'turn:double')).toMatchObject({status:'rejected',code:'SHOE_EXHAUSTED'});expect(g.room()).toEqual(before);
  });
  it('rejects Classic, a disabled setting, initial naturals, prior ordinary hits and any earlier offer',()=>{
    const classic=fixture();classic.start();classic.bet();classic.deal();const original=structuredClone(classic.room());expect(classic.send(classic.host,'turn:double').status).toBe('rejected');expect(classic.room()).toEqual(original);const f=hand();f.send(f.host,'turn:hit');expect(doubleReason(f.room(),f.room().players[0]!)).not.toBeNull();expect(f.send(f.host,'turn:double').status).toBe('rejected');const offered=hand();offered.send(offered.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:50});offered.advance(RULES.offerMs);const after=structuredClone(offered.room());expect(offered.send(offered.host,'turn:double').status).toBe('rejected');expect(offered.room()).toEqual(after);const natural=hand(['A','9','10','K','8','7']);expect(doubleReason(natural.room(),natural.room().players[0]!)).not.toBeNull();const disabled=fixture({mode:'PARTY'});disabled.send(disabled.host,'lobby:settings',{settings:{...disabled.view().settings,doubleDown:false},rounds:3,finale:false,visibility:'PRIVATE'});disabled.start();disabled.advance(22000);disabled.bet();disabled.deal();expect(disabled.send(disabled.host,'turn:double').status).toBe('rejected');
  });
  it('does not stack ordinary doubling with a Chaos multiplier, even after replacing that wager',()=>{
    const f=fixture({mode:'PARTY'});f.start();f.advance(22000);f.bet();f.room().party!.chaos.inventories[f.host]=[{id:'chaos-before-double',kind:'DOUBLE_DOWN'}];expect(f.send(f.host,'chaos:activate',{cardId:'chaos-before-double'}).status).toBe('ok');expect(f.send(f.host,'bet:submit',{amount:100}).status).toBe('ok');f.deal();const before=structuredClone(f.room());expect(f.send(f.host,'turn:double').status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('protects movement recipients from ordinary doubling without consuming their independent Chaos allowance',()=>{
    const f=fixture({mode:'PARTY'});f.start();f.advance(22000);f.bet();f.advance(RULES.bettingMs+RULES.dealingMs);f.room().party!.chaos.inventories[f.actors[1]!]=[{id:'movement-before-double',kind:'HAND_SWAP'}];expect(f.send(f.actors[1]!,'chaos:activate',{cardId:'movement-before-double',targetId:f.host}).status).toBe('ok');f.advance(5000);expect(f.view().party!.chaos.usedThisRound).toBe(false);const before=structuredClone(f.room());expect(f.send(f.host,'turn:double').status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
});
