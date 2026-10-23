import {describe,expect,it} from 'vitest';
import {RULES} from '@bluff-house/shared';
import {fixture} from '../fixtures/core.js';

function finishRound(f:ReturnType<typeof fixture>){
  for(let transitions=0;transitions<20&&f.view().phase!=='ROUND_RESULT';transitions++){
    const state=f.view();
    if(state.phase==='PLAYER_TURN'&&state.players.some(p=>p.id===state.activePlayerId&&p.connected&&!p.departed))expect(f.send(state.activePlayerId!,'turn:stand').status).toBe('ok');
    else {expect(state.deadline).not.toBeNull();f.advance(state.deadline!-state.serverTime);}
  }
  expect(f.view().phase).toBe('ROUND_RESULT');f.advance(RULES.resultMs);
}

describe('three-round results and same-room replay',()=>{
  it('counts three all-skip rounds without drawing and reports all tied winners with no fabricated bluff',()=>{
    const f=fixture();f.start();
    for(let round=1;round<=3;round++){
      expect(f.view().round).toBe(round);f.advance(RULES.bettingMs);expect(f.room().cursor).toBe(0);expect(f.view().dealer).toEqual([]);f.advance(RULES.resultMs);
    }
    expect(f.view().phase).toBe('RESULTS');expect(f.view().results).toEqual({standings:f.actors.map((id,i)=>({id,name:`Player ${i+1}`,balance:1000,bluffWins:0,bluffLosses:0})),winners:f.actors,biggestBluff:null});
    const after=structuredClone(f.room());f.advance(10000);f.manager.reconcile();expect(f.room()).toEqual(after);
  });
  it('separates three Blackjack settlements from funded bluffs and keeps the earliest largest-pot tie',()=>{
    const f=fixture({ranks:['6','9','10','6','8','7','6']});f.start();let firstLargest:string|undefined;
    for(const [index,amount] of [100,200,200].entries()){
      f.bet();f.deal();expect(f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount}).status).toBe('ok');
      expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('ok');if(index===1)firstLargest=f.view().bluff!.id;
      expect(f.view().bluff!.pot).toBe(amount*2);f.advance(RULES.revealMs);finishRound(f);
    }
    expect(f.view().phase).toBe('RESULTS');expect(f.view().results?.winners).toEqual([f.host]);
    expect(f.view().results?.standings).toEqual([{id:f.host,name:'Player 1',balance:1800,bluffWins:3,bluffLosses:0},{id:f.actors[1],name:'Player 2',balance:500,bluffWins:0,bluffLosses:3}]);
    expect(f.view().results?.biggestBluff).toMatchObject({id:firstLargest,pot:400});expect(f.room().bluffOutcomes).toHaveLength(3);
    expect(f.room().dealerNet).toBe(300);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);
    for(const actor of f.actors)expect(f.view(actor).results).toEqual(f.view().results);
  });
  it('keeps a departed participant in settled final results',()=>{
    const f=fixture({players:3,ranks:['10','10','10','10','8','9','7','7']});f.start();
    for(let round=1;round<=3;round++){
      f.bet();f.deal();if(round===3)expect(f.send(f.actors[2]!,'room:leave').status).toBe('ok');finishRound(f);
    }
    expect(f.view().phase).toBe('RESULTS');expect(f.view().results!.standings).toHaveLength(3);expect(f.view().results!.standings.find(p=>p.id===f.actors[2])?.balance).toBe(1000);
  });
  it('returns to the same room with fresh readiness, match context and bankroll while retaining scoped retry outcomes',()=>{
    const f=fixture({ranks:['6','9','10','6','8','7','6']});f.start();f.bet();f.deal();f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:100});
    const accept=f.command(f.actors[1]!,'bluff:accept'),ack=f.manager.command(f.actors[1]!,accept),old=f.view();f.advance(RULES.revealMs);finishRound(f);
    for(let n=0;n<2;n++){f.advance(RULES.bettingMs);f.advance(RULES.resultMs);}
    const back=f.command(f.host,'results:return');expect(f.manager.command(f.host,back).status).toBe('ok');
    const lobby=structuredClone(f.room());expect(f.view()).toMatchObject({phase:'LOBBY',code:old.code,instanceId:old.instanceId,round:0,bluff:null,results:null,deadline:null});
    expect(f.view().lobbyId).not.toBe(old.lobbyId);expect(f.view().matchId).toBeUndefined();expect(f.room().bluffOutcomes).toEqual([]);
    for(const player of f.view().players)expect(player).toMatchObject({ready:false,balance:1000,reserved:0,committed:0,hand:[],bluffUsed:false,bluffWins:0,bluffLosses:0});
    expect(f.manager.command(f.actors[1]!,accept)).toEqual(ack);expect(f.room()).toEqual(lobby);
    expect(f.manager.command(f.host,back).status).toBe('ok');expect(f.room()).toEqual(lobby);
    expect(f.manager.settlementArchive.get(old.instanceId)?.some(a=>Object.values(a).length>0)).toBe(true);
    expect(f.send(f.host,'match:start').code).toBe('NOT_READY');f.start();expect(f.view().matchId).not.toBe(old.matchId);
    expect(f.manager.command(f.actors[1]!,{...accept,requestId:'old-context-new-request'}).code).toBe('STALE_MATCH');expect(f.view().round).toBe(1);
  });
});
