import {describe,expect,it} from 'vitest';
import {RULES} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';

describe('conserved whole-match Party ledger sequences',()=>{
  it('conserves multiplied natural returns, optional Pot Twist, finite reserve awards and the final Vault in one completed match',()=>{
    const f=fixture({mode:'PARTY',players:3,ranks:['10','A','10','10','7','K','8','7']});f.start();expect(f.send(f.host,'house:bid',{amount:100}).status).toBe('ok');f.advance(22000);
    const inject=(seat:number,kind:'TRIPLE_DOWN'|'POT_TWIST'|'EMERGENCY_FUND')=>{const id=`sequence-${f.view().round}-${seat}-${kind}`;f.room().party!.chaos.inventories[f.actors[seat]!]=[{id,kind}];return id;};
    const finish=()=>{for(let n=0;n<30&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);assertRoom(f.room());}expect(f.view().phase).toBe('ROUND_RESULT');};
    f.bet(100);expect(f.send(f.actors[1]!,'chaos:activate',{cardId:inject(1,'TRIPLE_DOWN')}).status).toBe('ok');f.deal();finish();expect(f.view().players.map(p=>p.balance)).toEqual([916,1450,1100]);expect(f.room().dealerNet).toBe(566);f.advance(RULES.resultMs+20000);
    expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.send(f.host,'chaos:activate',{cardId:inject(0,'EMERGENCY_FUND')}).status).toBe('ok');expect(f.view().party!.bonusReserve).toBe(200);
    f.bet(100);expect(f.send(f.actors[1]!,'bet:submit',{amount:200}).status).toBe('ok');expect(f.send(f.actors[1]!,'chaos:activate',{cardId:inject(1,'POT_TWIST')}).status).toBe('ok');f.advance(RULES.bettingMs);expect(f.view().phase).toBe('POT_TWIST');const opt=f.command(f.actors[1]!,'chaos:optin'),ack=f.manager.command(f.actors[1]!,opt);expect(ack.status).toBe('ok');expect(f.send(f.actors[2]!,'chaos:optin').status).toBe('ok');f.advance(5000+RULES.dealingMs);finish();
    expect(f.view().players.map(p=>p.balance)).toEqual([1040,2050,1300]);expect(f.room().dealerNet).toBe(1390);f.advance(RULES.resultMs+20000);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.view().phase).toBe('RESULTS');expect(f.view().players.map(p=>p.balance)).toEqual([1074,2083,1333]);expect(f.view().party).toMatchObject({vault:0,bonusReserve:200});expect(f.view().party!.transfers.filter(t=>t.kind==='bonus')).toHaveLength(1);expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);assertRoom(f.room());
    const before=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,opt)).toEqual(ack);expect(f.room()).toEqual(before);expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.view().party!.chaos.inventories.every(p=>p.cards.length===0)).toBe(true);expect(f.view().party!.chaos).toMatchObject({emergencyUsed:false,usedThisRound:false,potTwist:null,multipliers:[]});expect(f.view().party!.bonusReserve).toBe(300);
  });
  it('accounts for auction funding, full Blackjack returns, bank commission, two duels and final Vault distribution exactly once',()=>{
    const f=fixture({mode:'PARTY',players:3,ranks:['10','10','10','10','8','9','10','7']});f.start();f.send(f.host,'house:bid',{amount:300});f.advance(22000);f.bet();f.deal();
    for(let step=0;step<20&&f.view().phase!=='ROUND_RESULT';step++){
      const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);assertRoom(f.room());
    }
    expect(f.view().phase).toBe('ROUND_RESULT');expect(f.view().players.map(p=>p.balance)).toEqual([806,1100,1100]);expect(f.room().dealerNet).toBe(306);f.advance(RULES.resultMs);
    expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:150}).status).toBe('ok');const coinInvite=f.view().party!.social!.invites[0]!,coin=f.command(f.actors[1]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:coinInvite.id});const coinAck=f.manager.command(f.actors[1]!,coin);expect(coinAck.status).toBe('ok');f.advance(2000);
    expect(f.view().players.map(p=>p.balance)).toEqual([656,1250,1100]);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:50}).status).toBe('ok');const rpsInvite=f.view().party!.social!.invites[0]!;expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:rpsInvite.id}).status).toBe('ok');
    for(let n=0;n<3;n++){expect(f.send(f.host,'duel:choose',{choice:'ROCK'}).status).toBe('ok');expect(f.send(f.actors[1]!,'duel:choose',{choice:'SCISSORS'}).status).toBe('ok');assertRoom(f.room());}
    expect(f.view().players.map(p=>p.balance)).toEqual([706,1200,1100]);f.advance(2000);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.view().phase).toBe('RESULTS');expect(f.room().players.map(p=>p.account.balance)).toEqual([806,1300,1200]);expect(f.room().dealerNet).toBe(306);expect(f.view().party).toMatchObject({vault:0,bonusReserve:300});
    expect(f.view().party!.duelHistory).toHaveLength(2);expect(f.view().party!.transfers.filter(t=>t.kind==='auction')).toHaveLength(1);expect(f.view().party!.transfers.filter(t=>t.kind==='commission')).toHaveLength(2);expect(f.view().party!.transfers.filter(t=>t.kind==='vault_distribution')).toHaveLength(3);
    expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);assertRoom(f.room());
    const settled=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,coin)).toEqual(coinAck);f.advance(10000);f.manager.reconcile();expect(f.room()).toEqual(settled);
  });
});
