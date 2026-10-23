import {describe,expect,it} from 'vitest';
import {RULES,type Rank} from '@bluff-house/shared';
import {reserve} from '../../apps/server/src/game/ledger.js';
import {fixture} from '../fixtures/core.js';

function hand(first:Rank='6',second:Rank='6',hit:Rank='3'){
  const f=fixture({ranks:[first,'9','10',second,'8','7',hit]});
  f.start();f.bet();f.deal();return f;
}
const offer=(f:ReturnType<typeof fixture>,amount=100)=>f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount});

describe('funded Call My Bluff',()=>{
  it.each<[Rank,Rank]>([['6','6'],['10','2'],['10','10'],['A','A']])('allows hard eligible %s/%s when its actual total qualifies',(first,second)=>{
    const f=hand(first,second);const before=structuredClone(f.room());
    const outcome=offer(f);
    if(first==='A'){expect(outcome.code).toBe('INELIGIBLE_HAND');expect(f.room()).toEqual(before);}
    else{expect(outcome.status).toBe('ok');expect(f.view().players[0]).toMatchObject({balance:900,reserved:100,available:800,bluffUsed:true});expect(f.room().cursor).toBe(before.cursor);}
  });
  it.each<[Rank,Rank]>([['A','6'],['A','9'],['5','6'],['2','2']])('protects soft or low hand %s/%s',(first,second)=>{
    const f=hand(first,second),before=structuredClone(f.room());expect(offer(f).code).toBe('INELIGIBLE_HAND');expect(f.room()).toEqual(before);
  });
  it.each([0,49,51,300,100.5])('rejects invalid stake %s atomically',amount=>{
    const f=hand(),before=structuredClone(f.room());expect(offer(f,amount).code).toBe('INVALID_AMOUNT');expect(f.room()).toEqual(before);
  });
  it('rejects unsupported claims and an unfunded claimant without consuming the hand allowance',()=>{
    const f=hand();reserve(f.room().players[0]!.account,'other-obligation',900);const before=structuredClone(f.room());
    expect(f.send(f.host,'bluff:offer',{claimType:'ALWAYS_WIN',amount:100}).code).toBe('INVALID_CLAIM');
    expect(offer(f).code).toBe('INSUFFICIENT_AVAILABLE_CHIPS');expect(f.room()).toEqual(before);
  });
  it.each<[Rank,string,number[]]>([['3','player-1',[1050,750]],['K','player-2',[750,1050]]])('draws %s once and awards the full 300-chip pot to %s',(hit,winner,balances)=>{
    const f=hand('6','6',hit);expect(offer(f,150).status).toBe('ok');const cursor=f.room().cursor;
    const accept=f.command(f.actors[1]!,'bluff:accept'),ack=f.manager.command(f.actors[1]!,accept);
    expect(ack.status).toBe('ok');expect(f.view().phase).toBe('BLUFF_REVEAL');
    expect(f.room().cursor).toBe(cursor+1);expect(f.view().players.map(p=>p.balance)).toEqual(balances);
    expect(f.view().bluff).toMatchObject({status:'accepted',winnerId:winner,pot:300,card:{rank:hit}});
    expect(f.view().players.find(p=>p.id===winner)).toMatchObject({bluffWins:1,bluffLosses:0});
    expect(f.view().players.find(p=>p.id!==winner)).toMatchObject({bluffWins:0,bluffLosses:1});
    expect(f.view().players.every(p=>p.reserved===0&&p.committed===100)).toBe(true);
    const after=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,accept)).toEqual(ack);expect(f.room()).toEqual(after);
    expect(f.manager.command(f.actors[1]!,{...accept,requestId:'different-accept'}).code).toBe('OFFER_CLOSED');expect(f.room()).toEqual(after);
    expect(f.room().bluffOutcomes).toHaveLength(1);
  });
  it('serializes competing funded challengers and binds only the first',()=>{
    const f=fixture({players:3,ranks:['6','9','8','10','6','8','9','7','3']});f.start();f.bet();f.deal();offer(f,250);
    const a=f.command(f.actors[1]!,'bluff:accept'),b=f.command(f.actors[2]!,'bluff:accept');
    expect(f.manager.command(f.actors[1]!,a).status).toBe('ok');const settled=structuredClone(f.room());
    expect(f.manager.command(f.actors[2]!,b).code).toBe('OFFER_CLOSED');expect(f.room()).toEqual(settled);
    expect(f.view().players.map(p=>p.balance)).toEqual([1150,650,900]);expect(f.view().bluff?.challengerId).toBe(f.actors[1]);
  });
  it('rejects self, stale and unfunded calls with no partial draw, reservation or statistics',()=>{
    const f=hand();offer(f);reserve(f.room().players[1]!.account,'other-obligation',850);const before=structuredClone(f.room());
    expect(f.send(f.host,'bluff:accept').code).toBe('SELF_CHALLENGE');
    expect(f.send(f.actors[1]!,'bluff:accept',undefined,{offerId:'old-offer'}).code).toBe('STALE_OFFER');
    expect(f.send(f.actors[1]!,'bluff:accept').code).toBe('INSUFFICIENT_AVAILABLE_CHIPS');expect(f.room()).toEqual(before);
  });
  it.each(['stood','bust'] as const)('lets a connected %s player challenge later in the same round',status=>{
    const f=fixture({ranks:['10','6','10','8','6','7','K','2']});f.start();f.bet();f.deal();
    expect(f.send(f.host,status==='bust'?'turn:hit':'turn:stand').status).toBe('ok');expect(f.view().players[0]!.status).toBe(status);
    expect(f.send(f.actors[1]!,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:100}).status).toBe('ok');
    expect(f.send(f.host,'bluff:accept').status).toBe('ok');
  });
  it('lets a connected player who skipped Blackjack fund a challenge',()=>{
    const f=fixture({ranks:['6','10','6','7','3']});f.start();f.send(f.actors[1]!,'bet:submit',{amount:100});f.deal();
    expect(f.view().players[0]!.status).toBe('skipped');f.send(f.actors[1]!,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:100});
    expect(f.send(f.host,'bluff:accept').status).toBe('ok');expect(f.view().players[0]!.committed).toBe(0);
  });
  it('allows one offer per hand even when it expires',()=>{
    const f=hand();offer(f);f.advance(RULES.offerMs);const before=structuredClone(f.room());expect(offer(f).code).toBe('OFFER_ALREADY_USED');expect(f.room()).toEqual(before);
  });
});
