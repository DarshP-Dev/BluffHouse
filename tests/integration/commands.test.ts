import {describe,expect,it} from 'vitest';
import {RULES} from '@bluff-house/shared';
import {fixture} from '../fixtures/core.js';

describe('authoritative command decisions',()=>{
  it('retains a rejected request outcome even after the room becomes eligible',()=>{
    const f=fixture();const command=f.command(f.host,'match:start');
    const rejected=f.manager.command(f.host,command);expect(rejected.code).toBe('NOT_READY');
    for(const actor of f.actors)f.send(actor,'lobby:ready',{ready:true});
    const before=structuredClone(f.room());
    expect(f.manager.command(f.host,command)).toEqual(rejected);expect(f.room()).toEqual(before);
    expect(f.send(f.host,'match:start').status).toBe('ok');
  });
  it('replays an identical successful command without another mutation and rejects a changed fingerprint',()=>{
    const f=fixture();f.start();
    const cmd=f.command(f.host,'bet:submit',{amount:100});
    const first=f.manager.command(f.host,cmd),after=structuredClone(f.room());
    expect(first.status).toBe('ok');
    expect(f.manager.command(f.host,structuredClone(cmd))).toEqual(first);
    expect(f.room()).toEqual(after);
    expect(f.manager.command(f.host,{...cmd,payload:{amount:200}})).toMatchObject({status:'rejected',code:'REQUEST_CONFLICT'});
    expect(f.room()).toEqual(after);
  });

  it('does not draw twice when distinct request IDs race for the same decision',()=>{
    const f=fixture();f.start();f.bet();f.deal();
    const hit=f.command(f.host,'turn:hit');
    const first=f.manager.command(f.host,hit);
    const after=structuredClone(f.room());
    expect(first.status).toBe('ok');
    expect(f.view().players[0]!.hand).toHaveLength(3);
    expect(f.manager.command(f.host,{...hit,requestId:'different-request'})).toMatchObject({status:'rejected',code:'STALE_DECISION'});
    expect(f.room()).toEqual(after);
    expect(f.manager.command(f.host,hit)).toEqual(first);
    expect(f.room()).toEqual(after);
  });

  it('rejects another player and stale context without consuming cards or changing balances',()=>{
    const f=fixture();f.start();f.bet();f.deal();
    const before=structuredClone(f.room());
    expect(f.send(f.actors[1]!,'turn:hit')).toMatchObject({status:'rejected',code:'NOT_YOUR_TURN'});
    for(const [key,code] of [['roomInstanceId','STALE_ROOM'],['matchId','STALE_MATCH'],['roundId','STALE_ROUND'],['decisionId','STALE_DECISION']] as const){
      expect(f.send(f.host,'turn:hit',undefined,{[key]:'earlier-context'})).toMatchObject({status:'rejected',code});
      expect(f.room()).toEqual(before);
    }
  });

  it('rejects malformed requests, extra authority fields, invalid wagers and forbidden actions atomically',()=>{
    const f=fixture();f.start();
    const before=structuredClone(f.room());
    const base=f.command(f.host,'bet:submit',{amount:100});
    const invalid:unknown[]=[null,[],{...base,requestId:'short'},{...base,type:'admin:chips'},{...base,playerId:f.actors[1]},
      {...base,payload:{amount:100,balance:100000}},{...base,payload:[]},
      ...[0,-50,49,51,300,100.5,NaN,Infinity,'100',null].map(amount=>({...base,payload:{amount}}))];
    for(const command of invalid){expect(f.manager.command(f.host,command).status).toBe('rejected');expect(f.room()).toEqual(before);}
    expect(f.send(f.host,'turn:hit')).toMatchObject({status:'rejected',code:'PHASE_LOCKED'});
    expect(f.room()).toEqual(before);
  });

  it('reserves, replaces and withdraws a wager without minting or committing chips early',()=>{
    const f=fixture();f.start();
    expect(f.send(f.host,'bet:submit',{amount:100}).status).toBe('ok');
    expect(f.view().players[0]).toMatchObject({balance:1000,reserved:100,available:900,committed:0});
    expect(f.send(f.host,'bet:submit',{amount:250}).status).toBe('ok');
    expect(f.view().players[0]).toMatchObject({balance:1000,reserved:250,available:750,committed:0});
    const withdrawal=f.command(f.host,'bet:withdraw');
    expect(f.manager.command(f.host,withdrawal).status).toBe('ok');
    expect(f.manager.command(f.host,withdrawal).status).toBe('ok');
    expect(f.send(f.host,'bet:withdraw').status).toBe('ok');
    expect(f.view().players[0]).toMatchObject({balance:1000,reserved:0,available:1000,committed:0});
    f.advance(RULES.bettingMs);
    expect(f.view().players[0]!.hand).toEqual([]);
    expect(f.view().players[0]!.balance).toBe(1000);
  });

  it('commits only the final reservation at betting close and rejects late edits/withdrawals',()=>{
    const f=fixture();f.start();
    f.send(f.host,'bet:submit',{amount:50});f.send(f.host,'bet:submit',{amount:250});
    const late=f.command(f.host,'bet:withdraw');
    f.advance(RULES.bettingMs);
    expect(f.view().phase).toBe('DEALING');
    expect(f.view().players[0]).toMatchObject({balance:750,reserved:0,available:750,committed:250});
    expect(f.view().players[1]).toMatchObject({balance:1000,committed:0,status:'skipped',hand:[]});
    const after=structuredClone(f.room());
    expect(f.manager.command(f.host,late)).toMatchObject({status:'rejected',code:'STALE_BETTING'});
    expect(f.send(f.host,'bet:submit',{amount:50})).toMatchObject({status:'rejected',code:'STALE_BETTING'});
    expect(f.room()).toEqual(after);
  });

  it('settles funded wagers once and keeps dealer funding separate from player transfers',()=>{
    const f=fixture({ranks:['10','10','10','10','8','7']});f.start();f.bet(250);f.deal();
    expect(f.send(f.host,'turn:stand').status).toBe('ok');
    expect(f.send(f.actors[1]!,'turn:stand').status).toBe('ok');
    f.advance(RULES.dealerMs);
    expect(f.view().phase).toBe('ROUND_RESULT');
    expect(f.view().players.map(p=>p.balance)).toEqual([1250,1250]);
    expect(f.room().dealerNet).toBe(500);
    expect(f.view().players.every(p=>p.reserved===0&&p.committed===0)).toBe(true);
    const settled=structuredClone(f.room());
    for(let n=0;n<5;n++)f.manager.reconcile();
    expect(f.room()).toEqual(settled);
    expect(f.room().players.map(p=>Object.keys(p.account.settlements).length)).toEqual([1,1]);
  });

  it('checks dealer natural before ordinary decisions and conceals its hole card until reveal',()=>{
    const f=fixture({ranks:['A','9','A','K','7','K']});f.start();f.bet();f.advance(RULES.bettingMs);
    for(const actor of f.actors){
      const view=f.view(actor);
      expect(view.phase).toBe('DEALING');expect(view.dealer).toEqual([{id:'test-card-2',rank:'A',suit:'S'},null]);
      expect(view.dealerValue).toBeNull();expect(view.decisionId).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain('test-card-5');
      expect(view).not.toHaveProperty('shoe');expect(view).not.toHaveProperty('cursor');
    }
    f.advance(RULES.dealingMs);
    expect(f.view().phase).toBe('ROUND_RESULT');expect(f.view().dealerValue).toMatchObject({natural:true,total:21});
    expect(f.view().players.map(p=>p.balance)).toEqual([1000,900]);
    expect(f.send(f.host,'turn:hit').status).toBe('rejected');
  });

  it('a skipped player cannot act and a decision timeout stands only the due hand',()=>{
    const f=fixture({players:3,ranks:['5','6','10','5','6','7']});f.start();
    f.send(f.host,'bet:submit',{amount:100});f.send(f.actors[1]!,'bet:submit',{amount:100});f.deal();
    expect(f.view().activePlayerId).toBe(f.host);
    expect(f.send(f.actors[2]!,'turn:stand')).toMatchObject({status:'rejected',code:'NOT_YOUR_TURN'});
    f.advance(RULES.decisionMs);
    expect(f.view().players[0]!.status).toBe('stood');expect(f.view().activePlayerId).toBe(f.actors[1]);
    expect(f.view().players[1]!.status).toBe('playing');
  });

  it('cannot reuse old round commands in a subsequent betting round',()=>{
    const f=fixture();f.start();const stale=f.command(f.host,'bet:submit',{amount:100});
    f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.view().round).toBe(2);expect(f.view().phase).toBe('BETTING');
    const before=structuredClone(f.room());
    expect(f.manager.command(f.host,stale)).toMatchObject({status:'rejected',code:'STALE_ROUND'});
    expect(f.room()).toEqual(before);
  });

  it('never double-charges replacements across three rounds or accepts wagers after results',()=>{
    // Three maximum losses leave 250; using the real ledger throughout catches duplicate debits/credits.
    const f=fixture({ranks:['10','10','10','6','6','9']});f.start();
    for(let round=1;round<=3;round++){
      f.bet(250);f.send(f.host,'bet:submit',{amount:50});f.send(f.host,'bet:submit',{amount:250});f.deal();
      f.send(f.host,'turn:stand');f.send(f.actors[1]!,'turn:stand');f.advance(RULES.dealerMs);
      expect(f.view().players.map(p=>p.balance)).toEqual([1000-round*250,1000-round*250]);
      expect(f.view().players.every(p=>p.available===p.balance&&p.committed===0)).toBe(true);
      f.advance(RULES.resultMs);
    }
    expect(f.view().phase).toBe('RESULTS');
    expect(f.view().results!.standings.map(p=>p.balance)).toEqual([250,250]);
    const after=structuredClone(f.room());
    expect(f.send(f.host,'bet:submit',{amount:250}).status).toBe('rejected');
    expect(f.room()).toEqual(after);
  });
});
