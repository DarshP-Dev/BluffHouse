import {describe,expect,it,vi} from 'vitest';
import {RULES} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {reserve} from '../../apps/server/src/game/ledger.js';
import {validBondReservation} from '../../apps/server/src/game/house-bank.js';
import {fixture} from '../fixtures/core.js';

type Fixture=ReturnType<typeof fixture>;
function bid(f:Fixture,seat:number,amount:number){expect(f.send(f.actors[seat]!,'house:bid',{amount}).status).toBe('ok');assertRoom(f.room());}
function finishRound(f:Fixture){
  for(let n=0;n<30&&f.view().phase!=='ROUND_RESULT';n++){
    const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');
    else {expect(v.deadline).not.toBeNull();f.advance(v.deadline!-v.serverTime);}
  }
  expect(f.view().phase).toBe('ROUND_RESULT');assertRoom(f.room());
}
function noPending(f:Fixture){expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);for(const p of f.room().players)expect(Object.keys(p.account.reservations).every(key=>validBondReservation(f.room(),p,key))).toBe(true);assertRoom(f.room());}

describe('Party mode authority and sealed auction',()=>{
  it('defaults to Classic, restricts mode changes to the host in the lobby and resets readiness',()=>{
    const f=fixture();expect(f.view().mode).toBe('CLASSIC');expect(f.view().party).toBeNull();
    f.actors.forEach(a=>f.send(a,'lobby:ready',{ready:true}));const before=structuredClone(f.room());
    expect(f.send(f.actors[1]!,'lobby:mode',{mode:'PARTY'}).status).toBe('rejected');expect(f.room()).toEqual(before);
    expect(f.send(f.host,'lobby:mode',{mode:'EXPERIMENTAL'}).status).toBe('rejected');expect(f.room()).toEqual(before);
    expect(f.send(f.host,'lobby:mode',{mode:'PARTY'}).status).toBe('ok');expect(f.view().players.every(p=>!p.ready)).toBe(true);
    expect(f.send(f.host,'match:start').code).toBe('NOT_READY');f.start();expect(f.view().phase).toBe('HOUSE_AUCTION');
    const started=structuredClone(f.room());expect(f.send(f.host,'lobby:mode',{mode:'CLASSIC'}).status).toBe('rejected');expect(f.room()).toEqual(started);
  });
  it('keeps every other bid and reservation hidden while restoring the owner’s exact bid after reconnect',()=>{
    const f=fixture({mode:'PARTY',players:3});f.start();bid(f,0,300);bid(f,1,150);bid(f,2,0);
    for(const viewer of f.actors){const v=f.view(viewer);expect(v.party!.auction.winnerId).toBeNull();expect(v.party!.auction.winningBid).toBeNull();
      for(const b of v.party!.auction.bids){expect(b.submitted).toBe(true);if(b.playerId!==viewer)expect(b).not.toHaveProperty('amount');}
      for(const p of v.players.filter(p=>p.id!==viewer)){expect(p.balance).toBe(1000);expect(p.reserved).toBe(0);expect(p.available).toBe(1000);expect(p.committed).toBe(0);}
    }
    expect(f.view().players[0]).toMatchObject({reserved:300,available:700});
    f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().party!.auction.bids.find(b=>b.playerId===f.host)?.amount).toBe(300);
    f.advance(20000);for(const viewer of f.actors)expect(f.view(viewer).party!.auction.bids.map(b=>b.amount)).toEqual([300,150,0]);
    expect(f.view().phase).toBe('HOUSE_REVEAL');expect(f.view().party!.vault).toBe(300);expect(f.view().players.map(p=>p.balance)).toEqual([700,1000,1000]);noPending(f);
    f.advance(1999);expect(f.view().phase).toBe('HOUSE_REVEAL');f.advance(1);expect(f.view().phase).toBe('BETTING');
  });
  it('invalidates in-flight readiness and start commands from the previous lobby mode',()=>{
    const f=fixture(),ready=f.command(f.actors[1]!,'lobby:ready',{ready:true}),start=f.command(f.host,'match:start'),oldLobby=f.view().lobbyId;
    expect(f.send(f.host,'lobby:mode',{mode:'PARTY'}).status).toBe('ok');expect(f.view().lobbyId).not.toBe(oldLobby);
    const changed=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,ready).code).toBe('STALE_LOBBY');expect(f.manager.command(f.host,start).code).toBe('STALE_LOBBY');expect(f.room()).toEqual(changed);
  });
  it('edits, withdraws and resubmits a reservation without creating or losing money',()=>{
    const f=fixture({mode:'PARTY'});f.start();bid(f,0,300);bid(f,0,100);expect(f.view().players[0]).toMatchObject({reserved:100,available:900});
    bid(f,0,0);expect(f.view().players[0]).toMatchObject({reserved:0,available:1000});bid(f,0,50);bid(f,1,100);f.advance(20000);
    expect(f.view().party).toMatchObject({houseId:f.actors[1],vault:100});expect(f.view().players.map(p=>p.balance)).toEqual([1000,900]);
    expect(f.view().party!.transfers.filter(t=>t.kind==='auction')).toHaveLength(1);noPending(f);
  });
  it.each([-1,1,49,75,901,950,50.5,'100',null])('rejects malformed or out-of-range bid %s without replacing an existing reservation',(amount)=>{
    const f=fixture({mode:'PARTY'});f.start();bid(f,0,100);const before=structuredClone(f.room());
    expect(f.send(f.host,'house:bid',{amount}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('accepts the final pre-deadline edit, rejects edits at the deadline, and replays an old successful acknowledgement without changing the outcome',()=>{
    const f=fixture({mode:'PARTY'});f.start();bid(f,1,150);f.advance(19999);
    const command=f.command(f.host,'house:bid',{amount:200}),ack=f.manager.command(f.host,command);expect(ack.status).toBe('ok');
    f.advance(1);const closed=structuredClone(f.room());expect(f.send(f.host,'house:bid',{amount:300}).status).toBe('rejected');expect(f.room()).toEqual(closed);
    expect(f.manager.command(f.host,command)).toEqual(ack);expect(f.room()).toEqual(closed);expect(f.view().party!.houseId).toBe(f.host);
  });
  it('rejects stale auction identifiers and client-selected settlement fields atomically',()=>{
    const f=fixture({mode:'PARTY'});f.start();const before=structuredClone(f.room());
    expect(f.send(f.host,'house:bid',{amount:100},{auctionId:'wrong-auction'}).status).toBe('rejected');
    expect(f.send(f.host,'house:bid',{amount:100,winnerId:f.host}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('rejects an unaffordable edit atomically while preserving the previous binding bid',()=>{
    const f=fixture({mode:'PARTY'});f.start();bid(f,0,100);reserve(f.room().players[0]!.account,'independent-reservation',800);
    const before=structuredClone(f.room());expect(f.send(f.host,'house:bid',{amount:300}).status).toBe('rejected');expect(f.room()).toEqual(before);
    expect(f.view().party!.auction.bids.find(b=>b.playerId===f.host)?.amount).toBe(100);assertRoom(f.room());
  });
  it('uses injected random selection only among tied highest positive bids',()=>{
    const random=vi.fn(()=>1),f=fixture({mode:'PARTY',players:4,randomIndex:random});f.start();[300,50,300,200].forEach((a,i)=>bid(f,i,a));f.advance(20000);
    expect(random).toHaveBeenCalledExactlyOnceWith(2);expect(f.view().party!.houseId).toBe(f.actors[2]);expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000,700,1000]);noPending(f);
  });
  it('does not select a House or debit chips when everyone passes or submits nothing',()=>{
    const random=vi.fn(()=>0),f=fixture({mode:'PARTY',randomIndex:random});f.start();bid(f,0,0);f.advance(22000);
    expect(random).not.toHaveBeenCalled();expect(f.view().party).toMatchObject({houseId:null,vault:0,bonusReserve:200});expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000]);noPending(f);
  });
  it.each(['disconnect','leave'])('keeps a submitted winning bid binding through %s',(loss)=>{
    const f=fixture({mode:'PARTY',players:3}),bidder=f.actors[2]!;f.start();bid(f,0,100);bid(f,2,300);
    if(loss==='disconnect')f.manager.presence(bidder,false);else expect(f.send(bidder,'room:leave').status).toBe('ok');
    f.advance(20000);expect(f.view().party).toMatchObject({houseId:bidder,vault:300});expect(f.room().players[2]!.account.balance).toBe(700);noPending(f);
  });
  it('rejects an observer who was absent when the match began',()=>{
    const f=fixture({mode:'PARTY',players:3}),observer=f.actors[2]!;f.manager.presence(observer,false);
    for(const actor of f.actors.slice(0,2))f.send(actor,'lobby:ready',{ready:true});f.send(f.host,'match:start');f.manager.presence(observer,true);
    const before=structuredClone(f.room());expect(f.send(observer,'house:bid',{amount:300}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
});

describe('funded Party settlement, fallback and replay',()=>{
  it('pays a full 100-chip normal win from the dealer stake then House bond without passive commission',()=>{
    const f=fixture({mode:'PARTY',ranks:['10','10','8','7']});f.start();bid(f,0,50);f.advance(22000);f.bet();f.deal();finishRound(f);
    expect(f.view().players.map(p=>p.balance)).toEqual([850,1100]);expect(f.room().dealerNet).toBe(0);
    expect(f.view().roundPayouts).toEqual([expect.objectContaining({playerId:f.actors[1],stake:100,returned:200,profit:100,houseCommission:0})]);expect(f.view().party!.bank.rounds.at(-1)).toMatchObject({dealerStake:10,stakeLoss:10,bondLoss:90,bankLoss:0});noPending(f);
  });
  it('pays a 50-chip natural in full from funded dealer backing',()=>{
    const f=fixture({mode:'PARTY',ranks:['A','10','K','7']});f.start();bid(f,0,50);f.advance(22000);f.bet(50);f.deal();finishRound(f);
    expect(f.view().players.map(p=>p.balance)).toEqual([875,1075]);expect(f.room().dealerNet).toBe(0);
    expect(f.view().roundPayouts[0]).toMatchObject({stake:50,returned:125,profit:75,houseCommission:0});noPending(f);
  });
  it('nets five natural payouts before consuming the bond and Bank even when player storage is reordered',()=>{
    const f=fixture({mode:'PARTY',players:6,ranks:['A','A','A','A','A','10','K','K','K','K','K','7']});
    f.start();bid(f,0,300);f.advance(22000);f.bet(250);f.room().players.reverse();f.deal();finishRound(f);
    expect(f.view().roundPayouts.map(p=>p.houseCommission)).toEqual([0,0,0,0,0]);
    expect(f.room().players.find(p=>p.id===f.host)!.account.balance).toBe(440);
    expect(f.room().players.filter(p=>p.id!==f.host).every(p=>p.account.balance===1375)).toBe(true);expect(f.room().dealerNet).toBe(1615);noPending(f);
  });
  it('does not tax a funded peer bluff pot or credit the bank during its reveal',()=>{
    const f=fixture({mode:'PARTY',ranks:['6','9','6','8','7']});f.start();bid(f,1,50);f.advance(22000);f.bet();f.deal();
    expect(f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:100}).status).toBe('ok');expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('ok');
    expect(f.view().phase).toBe('BLUFF_REVEAL');expect(f.view().bluff).toMatchObject({pot:200,winnerId:f.host});
    expect(f.view().players.map(p=>p.balance)).toEqual([1000,840]);expect(f.room().dealerNet).toBe(0);expect(f.view().party!.transfers.filter(t=>t.kind==='commission')).toEqual([]);assertRoom(f.room());
  });
  it('distributes the funded Vault once before final standings, leaves the bonus reserve unspent, and resets Party state on replay',()=>{
    const f=fixture({mode:'PARTY',players:3});f.start();const firstMatch=f.view().matchId;bid(f,0,50);f.advance(22000);
    for(let i=0;i<3;i++){f.advance(RULES.bettingMs+RULES.resultMs);if(i<2){expect(f.view().phase).toBe('SOCIAL');f.advance(20000);}}
    expect(f.view().phase).toBe('RESULTS');expect(f.view().results!.standings.map(p=>p.balance)).toEqual([1017,1016,967]);expect(f.view().party).toMatchObject({vault:0,bonusReserve:300});noPending(f);
    const settled=structuredClone(f.room());f.advance(10000);expect(f.room()).toEqual(settled);
    expect(f.send(f.host,'results:return').status).toBe('ok');expect(f.view()).toMatchObject({phase:'LOBBY',mode:'PARTY',party:null,roundPayouts:[]});
    expect(f.view().players.every(p=>p.balance===1000&&!p.ready)).toBe(true);f.start();expect(f.view().matchId).not.toBe(firstMatch);expect(f.view().party).toMatchObject({houseId:null,vault:0,bonusReserve:300,transfers:[]});
  });
  it('drains the Vault on early termination without excluding the departed winning bidder',()=>{
    const f=fixture({mode:'PARTY'}),guest=f.actors[1]!;f.start();bid(f,1,50);f.send(guest,'room:leave');f.advance(60000);
    expect(f.view().phase).toBe('RESULTS');expect(f.view().results?.reason).toContain('recovery window');expect(f.view().party).toMatchObject({vault:0,bonusReserve:200});
    expect(f.view().results!.standings.map(p=>p.balance)).toEqual([1025,975]);noPending(f);
  });
  it('leaves identical Classic payouts and no Party ledger',()=>{
    const f=fixture({ranks:['10','10','10','8','9','7']});f.start();expect(f.view().phase).toBe('BETTING');f.bet();f.deal();finishRound(f);
    expect(f.view().players.map(p=>p.balance)).toEqual([1100,1100]);expect(f.room().dealerNet).toBe(200);expect(f.view().party).toBeNull();noPending(f);
  });
});
