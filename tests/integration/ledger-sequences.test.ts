import {describe,expect,it} from 'vitest';
import {RULES} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';

describe('conserved whole-match Party ledger sequences',()=>{
  it('conserves cooperation bonuses, betrayed pots, deal-funded Vault chips and bounty refunds across six rounds',()=>{
    const f=fixture({mode:'PARTY',rounds:6,players:3});f.start();expect(f.send(f.host,'house:bid',{amount:100}).status).toBe('ok');f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.send(f.actors[2]!,'bounty:contribute',{targetId:f.actors[1],amount:150}).status).toBe('ok');
    const deal=(from:number,to:number,amount:number,a:'SPLIT'|'STEAL',b:'SPLIT'|'STEAL')=>{
      expect(f.send(f.actors[from]!,'deal:offer',{defenderId:f.actors[to],amount}).status).toBe('ok');const offer=f.view().party!.social!.dealInvites.at(-1)!;
      expect(f.send(f.actors[to]!,'deal:accept',undefined,{dealOfferId:offer.id}).status).toBe('ok');
      expect(f.send(f.actors[from]!,'deal:choose',{choice:a}).status).toBe('ok');expect(f.send(f.actors[to]!,'deal:choose',{choice:b}).status).toBe('ok');assertRoom(f.room());
    };
    deal(0,1,100,'SPLIT','SPLIT');expect(f.view().players.map(p=>p.balance)).toEqual([910,1010,850]);expect(f.view().party!.bonusReserve).toBe(280);f.advance(2000);
    expect(f.view().party!.social!.slot).toBe(2);deal(1,2,50,'STEAL','STEAL');expect(f.view().party!.vault).toBe(200);f.advance(2000);f.advance(RULES.bettingMs+RULES.resultMs);
    const before=structuredClone(f.room());expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);
    deal(0,2,50,'SPLIT','STEAL');expect(f.view().players.map(p=>p.balance)).toEqual([860,960,850]);
    for(let n=0;n<50&&f.view().phase!=='RESULTS';n++){const v=f.view();f.advance(v.deadline!-v.serverTime);assertRoom(f.room());}
    expect(f.view()).toMatchObject({phase:'RESULTS',round:6});expect(f.view().players.map(p=>p.balance)).toEqual([927,1027,1066]);
    expect(f.room().dealerNet).toBe(0);expect(f.view().party).toMatchObject({bonusReserve:280,vault:0});expect(f.view().party!.bounties[0]!.status).toBe('refunded');
    expect(f.view().party!.dealHistory).toHaveLength(3);expect(f.view().party!.transfers.filter(t=>t.kind==='deal_bonus').reduce((n,t)=>n+t.amount,0)).toBe(20);expect(f.view().party!.transfers.filter(t=>t.kind==='deal_vault').reduce((n,t)=>n+t.amount,0)).toBe(100);
    expect(f.view().party!.transfers.filter(t=>t.kind==='commission')).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);assertRoom(f.room());
    expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.view().party!.dealHistory).toEqual([]);expect(f.view().party!.bonusReserve).toBe(300);
  });
  it('conserves six-round bounty rewards, sequential duel stakes, bonus funding and contributor refunds through final rankings',()=>{
    const f=fixture({mode:'PARTY',rounds:6,players:4,ranks:['10','10','10','10','10','8','8','8','8','7']});
    f.start();expect(f.send(f.host,'house:bid',{amount:100}).status).toBe('ok');f.advance(22000);f.bet();f.deal();
    for(let n=0;n<20&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);assertRoom(f.room());}
    expect(f.view().players.map(p=>p.balance)).toEqual([1009,1100,1100,1100]);expect(f.room().dealerNet).toBe(409);f.advance(RULES.resultMs);
    expect(f.send(f.host,'bounty:contribute',{targetId:f.actors[1],amount:150}).status).toBe('ok');
    expect(f.send(f.actors[3]!,'bounty:contribute',{targetId:f.actors[2],amount:50}).status).toBe('ok');
    const [defeated,refunded]=f.view().party!.bounties;
    expect(f.send(f.host,'bounty:invite',{bountyId:defeated!.id}).status).toBe('ok');
    const invite=f.view().party!.social!.invites.find(i=>i.status==='pending')!;
    const accepted=f.command(f.actors[1]!,'duel:accept',{game:'COIN',coinSide:'TAILS'},{inviteId:invite.id}),ack=f.manager.command(f.actors[1]!,accepted);
    expect(ack.status).toBe('ok');expect(f.view().party!.bounties[0]).toMatchObject({status:'defeated',winnerId:f.host,total:150,streak:0});
    expect(f.view().players.map(p=>p.balance)).toEqual([1036,1050,1100,1050]);expect(f.view().party!.vault).toBe(123);assertRoom(f.room());
    const interval=f.view().party!.social!.id,hard=f.view().party!.social!.hardDeadline;f.advance(2000);
    expect(f.view().party!.social).toMatchObject({id:interval,slot:2,hardDeadline:hard});
    expect(f.send(f.actors[2]!,'duel:invite',{defenderId:f.actors[3],amount:50}).status).toBe('ok');
    const second=f.view().party!.social!.invites.find(i=>i.status==='pending')!;
    expect(f.send(f.actors[3]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:second.id}).status).toBe('ok');f.advance(2000);
    expect(f.view()).toMatchObject({phase:'BETTING',round:2,roundLimit:6});
    f.room().party!.chaos.inventories[f.host]=[{id:'ledger-emergency',kind:'EMERGENCY_FUND'}];
    expect(f.send(f.host,'chaos:activate',{cardId:'ledger-emergency'}).status).toBe('ok');expect(f.view().party!.bonusReserve).toBe(300);
    for(let n=0;n<40&&f.view().phase!=='RESULTS';n++){const v=f.view();f.advance(v.deadline!-v.serverTime);assertRoom(f.room());}
    expect(f.view()).toMatchObject({phase:'RESULTS',round:6});
    expect(f.view().players.map(p=>p.balance)).toEqual([1167,1081,1081,1180]);expect(f.view().results!.winners).toEqual([f.actors[3]]);
    expect(f.view().party!.bounties.find(b=>b.id===refunded!.id)).toMatchObject({status:'refunded',total:50});
    expect(f.view().party).toMatchObject({vault:0,bonusReserve:300});expect(f.room().dealerNet).toBe(409);
    for(const kind of ['bounty_award','bounty_vault','bounty_refund'] as const)expect(f.view().party!.transfers.filter(t=>t.kind===kind)).toHaveLength(1);
    expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);
    const final=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,accepted)).toEqual(ack);f.advance(5000);expect(f.room()).toEqual(final);
    expect(f.send(f.host,'results:return').status).toBe('ok');expect(f.view()).toMatchObject({roundLimit:6,phase:'LOBBY',party:null});f.start();expect(f.view().party!.bounties).toEqual([]);assertRoom(f.room());
  });
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
