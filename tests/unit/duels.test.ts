import {describe,expect,it} from 'vitest';
import {type RpsChoice,RULES} from '@bluff-house/shared';
import {closeSocial,rpsWinner} from '../../apps/server/src/game/duels.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';

describe('complete RPS comparison including missing simultaneous choices',()=>{
  const cases:[RpsChoice|null,RpsChoice|null,number][]=[
    ['ROCK','ROCK',-1],['ROCK','PAPER',1],['ROCK','SCISSORS',0],
    ['PAPER','ROCK',0],['PAPER','PAPER',-1],['PAPER','SCISSORS',1],
    ['SCISSORS','ROCK',1],['SCISSORS','PAPER',0],['SCISSORS','SCISSORS',-1],
    ['ROCK',null,0],['PAPER',null,0],['SCISSORS',null,0],
    [null,'ROCK',1],[null,'PAPER',1],[null,'SCISSORS',1],[null,null,-1],
  ];
  it.each(cases)('resolves %s against %s as %s',(a,b,winner)=>expect(rpsWinner(a,b)).toBe(winner));
});

describe('duel boundary obligation safety',()=>{
  it('cannot close a social interval while an accepted pot is live',()=>{
    const f=fixture({mode:'PARTY'});f.start();f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:100}).status).toBe('ok');const invite=f.view().party!.social!.invites[0]!;
    expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:invite.id}).status).toBe('ok');const before=structuredClone(f.room());
    expect(()=>closeSocial(f.room())).toThrow('LIVE_DUEL_OBLIGATION');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('enforces an absolute play limit even when a throw would otherwise run longer',()=>{
    const f=fixture({mode:'PARTY'});f.start();f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:100});
    f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:f.view().party!.social!.invites[0]!.id});
    // A shorter remaining phase budget exercises the hard-limit path separately
    // from the ordinary five-throw cap (which normally ends RPS in 40 seconds).
    const d=f.room().party!.social!.duel!;d.hardDeadline=d.startedAt+8000;
    f.advance(8000);expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel).toMatchObject({winnerId:null,reason:'Play deadline reached.'});expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000]);assertRoom(f.room());
  });
});
