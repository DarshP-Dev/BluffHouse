import {describe,expect,it} from 'vitest';
import {RULES} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture,shoe} from '../fixtures/core.js';

describe('conserved whole-match Party ledger sequences',()=>{
  it('conserves ordinary doubling, deferred dealer claims, finite dealer backing, social pots and final Vault shares',()=>{
    const f=fixture({mode:'PARTY',rounds:6,players:4,ranks:['6','10','9','10','6','8','8','6','8','3','10']});f.start();expect(f.send(f.actors[3]!,'house:bid',{amount:100}).status).toBe('ok');f.advance(22000);f.bet();f.deal();
    expect(f.send(f.host,'bluff:offer',{claimType:'DEALER_BUST',amount:150}).status).toBe('ok');const call=f.command(f.actors[2]!,'bluff:accept'),ack=f.manager.command(f.actors[2]!,call);expect(ack.status).toBe('ok');expect(f.view().players.map(p=>p.bluffWins)).toEqual([0,0,0,0]);const cursor=f.room().cursor;expect(f.view().pendingClaims).toHaveLength(1);f.advance(2000);expect(f.room().cursor).toBe(cursor);expect(f.send(f.host,'turn:hit').status).toBe('ok');expect(f.send(f.host,'turn:stand').status).toBe('ok');expect(f.send(f.actors[1]!,'turn:double').status).toBe('ok');
    for(let n=0;n<20&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);assertRoom(f.room());}
    expect(f.view().players.map(p=>p.balance)).toEqual([1250,1200,950,650]);expect(f.room().dealerNet).toBe(150);expect(f.view().pendingClaims).toEqual([]);expect(f.view().claimOutcomes[0]).toMatchObject({winnerId:f.host,evidence:{dealerBust:true,claimTrue:true}});expect(f.view().roundPayouts[1]).toMatchObject({stake:200,returned:400,profit:200,houseCommission:0});expect(f.view().party!.bank.rounds[0]).toMatchObject({net:-400,bondLoss:250,bankLoss:150});assertRoom(f.room());f.advance(RULES.resultMs);
    expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount:50}).status).toBe('ok');const deal=f.view().party!.social!.dealInvites.at(-1)!;expect(f.send(f.actors[1]!,'deal:accept',undefined,{dealOfferId:deal.id}).status).toBe('ok');for(const actor of f.actors.slice(0,2))expect(f.send(actor,'deal:choose',{choice:'SPLIT'}).status).toBe('ok');f.advance(2000);expect(f.send(f.actors[2]!,'duel:invite',{defenderId:f.actors[3],amount:50}).status).toBe('ok');const duel=f.view().party!.social!.invites.at(-1)!;expect(f.send(f.actors[3]!,'duel:accept',{game:'COIN',coinSide:'TAILS'},{inviteId:duel.id}).status).toBe('ok');
    for(let n=0;n<100&&f.view().phase!=='RESULTS';n++){const v=f.view();f.advance(v.deadline!-v.serverTime);assertRoom(f.room());}expect(f.view().players.map(p=>p.balance)).toEqual([1285,1235,1025,625]);expect(f.view().party).toMatchObject({vault:0,bonusReserve:380});expect(f.room().dealerNet).toBe(150);expect(f.view().claimOutcomes).toHaveLength(1);const settled=structuredClone(f.room());expect(f.manager.command(f.actors[2]!,call)).toEqual(ack);expect(f.room()).toEqual(settled);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.view().claimOutcomes).toEqual([]);expect(f.view().pendingClaims).toEqual([]);expect(f.room().players.every(p=>!p.doubled&&!p.chaosAffected)).toBe(true);assertRoom(f.room());
  });
  it('funds a Shadow Draw jackpot from auction and betrayal, refunds bounty owners, and honors a successful busted claim',()=>{
    const f=fixture({mode:'PARTY',rounds:6,finale:true,players:3});f.start();expect(f.send(f.host,'house:bid',{amount:150}).status).toBe('ok');f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.send(f.actors[2]!,'bounty:contribute',{targetId:f.actors[1],amount:100}).status).toBe('ok');
    expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount:50}).status).toBe('ok');const offer=f.view().party!.social!.dealInvites.at(-1)!;expect(f.send(f.actors[1]!,'deal:accept',undefined,{dealOfferId:offer.id}).status).toBe('ok');for(const actor of f.actors.slice(0,2))expect(f.send(actor,'deal:choose',{choice:'STEAL'}).status).toBe('ok');
    f.manager.e.shoe=()=>shoe(['K','10','10','9','8','7','K']);
    for(let n=0;n<60&&f.view().phase!=='SHADOW_DRAW';n++){const v=f.view();f.advance(v.deadline!-v.serverTime);assertRoom(f.room());}
    expect(f.view()).toMatchObject({phase:'SHADOW_DRAW',round:6});expect(f.view().party!.shadow!.pot).toBe(250);expect(f.view().party!.bounties[0]!.status).toBe('refunded');expect(f.view().players.map(p=>p.balance)).toEqual([800,950,1000]);
    expect(f.send(f.host,'shadow:draw').status).toBe('ok');for(const actor of f.actors.slice(1))expect(f.send(actor,'shadow:stand').status).toBe('ok');
    expect(f.send(f.host,'shadow:claim',{declaredTotal:21}).status).toBe('ok');f.advance(8000);for(const actor of f.actors.slice(1))expect(f.send(actor,'shadow:pass').status).toBe('ok');
    const settled=f.view().party!.shadow!;expect(settled).toMatchObject({status:'settled',winnerIds:[f.host],vaultThiefIds:[f.host],fallback:false});expect(settled.entrants[0]).toMatchObject({value:{total:29,bust:true},score:22});
    expect(f.view().players.map(p=>p.balance)).toEqual([1050,950,1000]);expect(f.view().party!.vault).toBe(0);expect(f.room().dealerNet).toBe(0);expect(f.view().party!.bonusReserve).toBe(300);
    for(let n=0;n<5&&f.view().phase!=='RESULTS';n++){const v=f.view();f.advance(v.deadline!-v.serverTime);}
    expect(f.view().results!.winners).toEqual([f.host]);expect(f.view().party!.transfers.filter(t=>t.kind==='shadow_award').reduce((n,t)=>n+t.amount,0)).toBe(250);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);assertRoom(f.room());
    const final=structuredClone(f.room());expect(f.send(f.host,'shadow:claim',{declaredTotal:21}).status).toBe('rejected');expect(f.room()).toEqual(final);expect(f.send(f.host,'results:return').status).toBe('ok');expect(f.view().party).toBeNull();expect(f.view().finaleEnabled).toBe(true);
  });
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
    const f=fixture({mode:'PARTY',rounds:6,players:4,ranks:['10','10','10','10','8','8','8','7']});
    f.start();expect(f.send(f.host,'house:bid',{amount:100}).status).toBe('ok');f.advance(22000);f.bet();f.deal();
    for(let n=0;n<20&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);assertRoom(f.room());}
    expect(f.view().players.map(p=>p.balance)).toEqual([650,1100,1100,1100]);expect(f.room().dealerNet).toBe(50);f.advance(RULES.resultMs);
    expect(f.send(f.host,'bounty:contribute',{targetId:f.actors[1],amount:150}).status).toBe('ok');
    expect(f.send(f.actors[3]!,'bounty:contribute',{targetId:f.actors[2],amount:50}).status).toBe('ok');
    const [defeated,refunded]=f.view().party!.bounties;
    expect(f.send(f.host,'bounty:invite',{bountyId:defeated!.id}).status).toBe('ok');
    const invite=f.view().party!.social!.invites.find(i=>i.status==='pending')!;
    const accepted=f.command(f.actors[1]!,'duel:accept',{game:'COIN',coinSide:'TAILS'},{inviteId:invite.id}),ack=f.manager.command(f.actors[1]!,accepted);
    expect(ack.status).toBe('ok');expect(f.view().party!.bounties[0]).toMatchObject({status:'defeated',winnerId:f.host,total:150,streak:0});
    expect(f.view().players.map(p=>p.balance)).toEqual([677,1050,1100,1050]);expect(f.view().party!.vault).toBe(123);assertRoom(f.room());
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
    expect(f.view().players.map(p=>p.balance)).toEqual([808,1081,1081,1180]);expect(f.view().results!.winners).toEqual([f.actors[3]]);
    expect(f.view().party!.bounties.find(b=>b.id===refunded!.id)).toMatchObject({status:'refunded',total:50});
    expect(f.view().party).toMatchObject({vault:0,bonusReserve:300});expect(f.room().dealerNet).toBe(50);
    for(const kind of ['bounty_award','bounty_vault','bounty_refund'] as const)expect(f.view().party!.transfers.filter(t=>t.kind===kind)).toHaveLength(1);
    expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);
    const final=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,accepted)).toEqual(ack);f.advance(5000);expect(f.room()).toEqual(final);
    expect(f.send(f.host,'results:return').status).toBe('ok');expect(f.view()).toMatchObject({roundLimit:6,phase:'LOBBY',party:null});f.start();expect(f.view().party!.bounties).toEqual([]);assertRoom(f.room());
  });
  it('conserves multiplied natural returns, optional Pot Twist, finite reserve awards and the final Vault in one completed match',()=>{
    const f=fixture({mode:'PARTY',players:3,ranks:['A','10','10','K','8','7']});f.start();expect(f.send(f.host,'house:bid',{amount:100}).status).toBe('ok');f.advance(22000);
    const inject=(seat:number,kind:'TRIPLE_DOWN'|'POT_TWIST'|'EMERGENCY_FUND')=>{const id=`sequence-${f.view().round}-${seat}-${kind}`;f.room().party!.chaos.inventories[f.actors[seat]!]=[{id,kind}];return id;};
    const finish=()=>{for(let n=0;n<30&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);assertRoom(f.room());}expect(f.view().phase).toBe('ROUND_RESULT');};
    f.bet(100);expect(f.send(f.actors[1]!,'chaos:activate',{cardId:inject(1,'TRIPLE_DOWN')}).status).toBe('ok');f.deal();finish();expect(f.view().players.map(p=>p.balance)).toEqual([650,1450,1100]);expect(f.room().dealerNet).toBe(300);f.advance(RULES.resultMs+20000);
    expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.send(f.host,'chaos:activate',{cardId:inject(0,'EMERGENCY_FUND')}).status).toBe('ok');expect(f.view().party!.bonusReserve).toBe(200);
    f.bet(100);expect(f.send(f.actors[1]!,'bet:submit',{amount:200}).status).toBe('ok');expect(f.send(f.actors[1]!,'chaos:activate',{cardId:inject(1,'POT_TWIST')}).status).toBe('ok');f.advance(RULES.bettingMs);expect(f.view().phase).toBe('POT_TWIST');const opt=f.command(f.actors[1]!,'chaos:optin'),ack=f.manager.command(f.actors[1]!,opt);expect(ack.status).toBe('ok');expect(f.send(f.actors[2]!,'chaos:optin').status).toBe('ok');f.advance(5000+RULES.dealingMs);finish();
    expect(f.view().players.map(p=>p.balance)).toEqual([750,2050,1300]);expect(f.room().dealerNet).toBe(1100);f.advance(RULES.resultMs+20000);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.view().phase).toBe('RESULTS');expect(f.view().players.map(p=>p.balance)).toEqual([784,2083,1333]);expect(f.view().party).toMatchObject({vault:0,bonusReserve:200});expect(f.view().party!.transfers.filter(t=>t.kind==='bonus')).toHaveLength(1);expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);assertRoom(f.room());
    const before=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,opt)).toEqual(ack);expect(f.room()).toEqual(before);expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.view().party!.chaos.inventories.every(p=>p.cards.length===0)).toBe(true);expect(f.view().party!.chaos).toMatchObject({emergencyUsed:false,usedThisRound:false,potTwist:null,multipliers:[]});expect(f.view().party!.bonusReserve).toBe(300);
  });
  it('accounts for auction funding, full Blackjack returns, dealer bond losses, two duels and final Vault distribution exactly once',()=>{
    const f=fixture({mode:'PARTY',players:3,ranks:['10','10','10','8','9','7']});f.start();f.send(f.host,'house:bid',{amount:300});f.advance(22000);f.bet();f.deal();
    for(let step=0;step<20&&f.view().phase!=='ROUND_RESULT';step++){
      const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);assertRoom(f.room());
    }
    expect(f.view().phase).toBe('ROUND_RESULT');expect(f.view().players.map(p=>p.balance)).toEqual([500,1100,1100]);expect(f.room().dealerNet).toBe(0);f.advance(RULES.resultMs);
    expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:150}).status).toBe('ok');const coinInvite=f.view().party!.social!.invites[0]!,coin=f.command(f.actors[1]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:coinInvite.id});const coinAck=f.manager.command(f.actors[1]!,coin);expect(coinAck.status).toBe('ok');f.advance(2000);
    expect(f.view().players.map(p=>p.balance)).toEqual([350,1250,1100]);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:50}).status).toBe('ok');const rpsInvite=f.view().party!.social!.invites[0]!;expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:rpsInvite.id}).status).toBe('ok');
    for(let n=0;n<3;n++){expect(f.send(f.host,'duel:choose',{choice:'ROCK'}).status).toBe('ok');expect(f.send(f.actors[1]!,'duel:choose',{choice:'SCISSORS'}).status).toBe('ok');assertRoom(f.room());}
    expect(f.view().players.map(p=>p.balance)).toEqual([400,1200,1100]);f.advance(2000);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.view().phase).toBe('RESULTS');expect(f.room().players.map(p=>p.account.balance)).toEqual([500,1300,1200]);expect(f.room().dealerNet).toBe(0);expect(f.view().party).toMatchObject({vault:0,bonusReserve:300});
    expect(f.view().party!.duelHistory).toHaveLength(2);expect(f.view().party!.transfers.filter(t=>t.kind==='auction')).toHaveLength(1);expect(f.view().party!.transfers.filter(t=>t.kind==='commission')).toHaveLength(0);expect(f.view().party!.transfers.filter(t=>t.kind==='vault_distribution')).toHaveLength(3);
    expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);assertRoom(f.room());
    const settled=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,coin)).toEqual(coinAck);f.advance(10000);f.manager.reconcile();expect(f.room()).toEqual(settled);
  });
});
