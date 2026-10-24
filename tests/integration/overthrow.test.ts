import {describe,expect,it,vi} from 'vitest';
import {RULES,type DuelGame,type RpsChoice} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {payCommission} from '../../apps/server/src/game/house.js';
import {resolveBallot} from '../../apps/server/src/game/overthrow.js';
import {fixture} from '../fixtures/core.js';

type F=ReturnType<typeof fixture>;
function social(players=3,house=0,randomIndex:(length:number)=>number=()=>0){
  const f=fixture({mode:'PARTY',players,randomIndex});f.start();
  expect(f.send(f.actors[house]!,'house:bid',{amount:50}).status).toBe('ok');
  f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);
  expect(f.view()).toMatchObject({phase:'SOCIAL',round:1});expect(f.view().party!.houseId).toBe(f.actors[house]);return f;
}
function open(f:F,actor=f.actors.find(id=>id!==f.view().party!.houseId)!){expect(f.send(actor,'house:ballot').status).toBe('ok');return f.view().party!.social!.ballot!;}
function vote(f:F,actor:string,yes=true){expect(f.send(actor,'house:vote',{yes}).status).toBe('ok');}
function select(f:F,game:DuelGame='RPS',coinSide='HEADS'){
  const house=f.view().party!.social!.ballot!.houseId;
  expect(f.send(house,'house:choose',{game,...(game==='COIN'?{coinSide}:{})}).status).toBe('ok');return f.view().party!.social!.duel!;
}
function threshold(f:F){const b=open(f);for(const id of b.eligibleVoterIds.slice(0,b.requiredVotes))vote(f,id);expect(f.view().phase).toBe('LAST_STAND_CHOICE');return f.view().party!.social!.ballot!;}
function choices(f:F,challenger:RpsChoice,house:RpsChoice){const d=f.view().party!.social!.duel!;expect(f.send(d.inviterId,'duel:choose',{choice:challenger}).status).toBe('ok');expect(f.send(d.defenderId,'duel:choose',{choice:house}).status).toBe('ok');}
function clean(f:F){expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);assertRoom(f.room());}

describe('frozen House ballots and admission ownership',()=>{
  it.each([[2,1],[3,2],[4,3],[5,3],[6,4]])('requires the ceiling threshold with %s participants',(players,required)=>{
    const f=social(players),b=open(f);expect(b.eligibleVoterIds).toEqual(f.actors.slice(1));expect(b.requiredVotes).toBe(required);expect(b.votes).toEqual([]);
    for(const id of b.eligibleVoterIds.slice(0,required-1)){vote(f,id);expect(f.view().phase).toBe('SOCIAL');}
    vote(f,b.eligibleVoterIds[required-1]!);expect(f.view().phase).toBe('LAST_STAND_CHOICE');expect(f.view().party!.social!.ballot!.votes).toHaveLength(required);clean(f);
  });
  it('keeps the voter denominator after disconnect and permits an eligible voter to reconnect and vote',()=>{
    const f=social(5),b=open(f);f.manager.presence(f.actors[4]!,false);vote(f,f.actors[1]!);vote(f,f.actors[2]!);
    expect(f.view().party!.social!.ballot).toMatchObject({eligibleVoterIds:b.eligibleVoterIds,requiredVotes:3,status:'open'});
    f.manager.presence(f.actors[4]!,true);vote(f,f.actors[4]!);expect(f.view().phase).toBe('LAST_STAND_CHOICE');clean(f);
  });
  it('does not add an absent player to an already frozen ballot after reconnection',()=>{
    const f=social(4);f.manager.presence(f.actors[3]!,false);const b=open(f);expect(b.eligibleVoterIds).toEqual(f.actors.slice(1,3));
    f.manager.presence(f.actors[3]!,true);const before=structuredClone(f.room());expect(f.send(f.actors[3]!,'house:vote',{yes:true}).status).toBe('rejected');expect(f.room()).toEqual(before);
    vote(f,f.actors[1]!);vote(f,f.actors[2]!);expect(f.view().phase).toBe('LAST_STAND_CHOICE');clean(f);
  });
  it('records one yes or no per voter and makes identical request retries harmless',()=>{
    const f=social(4);open(f);const cmd=f.command(f.actors[1]!,'house:vote',{yes:false}),ack=f.manager.command(f.actors[1]!,cmd);expect(ack.status).toBe('ok');
    const before=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,cmd)).toEqual(ack);expect(f.send(f.actors[1]!,'house:vote',{yes:true}).status).toBe('rejected');expect(f.manager.command(f.actors[1]!,{...cmd,payload:{yes:true}}).code).toBe('REQUEST_CONFLICT');expect(f.room()).toEqual(before);
    vote(f,f.actors[2]!);vote(f,f.actors[3]!);f.advance(10000);expect(f.view().party!.social!.ballot!.status).toBe('failed');expect(f.view().phase).toBe('SOCIAL');clean(f);
  });
  it('enforces House exclusion, valid payloads and exact ballot/social contexts without mutation',()=>{
    const f=social(4);expect(f.send(f.host,'house:ballot').status).toBe('rejected');open(f);const before=structuredClone(f.room());
    for(const [actor,payload,extra] of [[f.host,{yes:true},{}],[f.actors[1],{yes:'true'},{}],[f.actors[1],{yes:true,winnerId:f.actors[1]},{}],[f.actors[1],{yes:true},{ballotId:'stale'}],[f.actors[1],{yes:true},{socialId:'stale'}]] as const){expect(f.send(actor!,'house:vote',payload,extra).status).toBe('rejected');expect(f.room()).toEqual(before);}
    expect(f.send(f.actors[2]!,'house:ballot').status).toBe('rejected');expect(f.room()).toEqual(before);clean(f);
  });
  it('caps late ballots at admission close, rejects deadline votes and never reopens a failed ballot',()=>{
    const f=social(4),end=f.view().party!.social!.admissionDeadline;f.advance(19000);const b=open(f);expect(b.deadline).toBe(end);
    const late=f.command(f.actors[1]!,'house:vote',{yes:true});f.advance(1000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});const before=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,late).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().party!.overthrowHistory).toHaveLength(1);clean(f);
    const g=social(4),original=g.view().party!.social!.admissionDeadline;open(g);g.advance(10000);expect(g.view().party!.social!.ballot!.status).toBe('failed');expect(g.view().deadline).toBe(original);
    const failed=structuredClone(g.room());expect(g.send(g.actors[2]!,'house:ballot').status).toBe('rejected');expect(g.room()).toEqual(failed);g.advance(10000);expect(g.view().phase).toBe('BETTING');clean(g);
  });
  it('uses only connected affirmative voters for random challenger selection',()=>{
    const random=vi.fn((n:number)=>n-1),f=social(5,0,random);random.mockClear();open(f);vote(f,f.actors[1]!);f.manager.presence(f.actors[1]!,false);vote(f,f.actors[2]!);vote(f,f.actors[3]!);
    expect(random).toHaveBeenCalledExactlyOnceWith(2);expect(f.view().party!.social!.ballot!.challengerId).toBe(f.actors[3]);expect(f.view().party!.social!.ballot!.votes).toHaveLength(3);clean(f);
  });
  it('retains the House without a new duel when no affirmative voter remains connected at resolution',()=>{
    const random=vi.fn(()=>0),f=social(5,0,random);random.mockClear();open(f);const r=f.room(),b=r.party!.social!.ballot!;
    // This recovery boundary cannot interleave within a normal atomic final-vote
    // command. Inject the historical threshold state before its resolution.
    b.votes=b.eligibleVoterIds.map((playerId,index)=>({playerId,yes:index<3}));
    for(const p of r.players.slice(1,4))p.connected=false;
    resolveBallot(r,f.manager.e,f.manager.e.now());
    expect(r.phase).toBe('SOCIAL');expect(r.party!.houseId).toBe(f.host);expect(r.party!.social!.duel).toBeNull();expect(b).toMatchObject({status:'failed',reason:expect.stringContaining('No affirmative voter')});expect(r.party!.overthrowHistory).toHaveLength(1);expect(random).not.toHaveBeenCalled();clean(f);
  });
  it('rolls back a threshold-reaching vote if random selection cannot produce a valid candidate index',()=>{
    const f=social(4);open(f);vote(f,f.actors[1]!);vote(f,f.actors[2]!);f.manager.e.randomIndex=()=>99;const before=structuredClone(f.room());
    expect(f.send(f.actors[3]!,'house:vote',{yes:true}).code).toBe('INVALID_RANDOM_INDEX');expect(f.room()).toEqual(before);
    f.manager.e.randomIndex=()=>0;vote(f,f.actors[3]!);expect(f.view().phase).toBe('LAST_STAND_CHOICE');clean(f);
  });
  it('allows a normal funded duel in the remaining original admission after a failed ballot',()=>{
    const f=social(4);open(f);vote(f,f.actors[1]!,false);f.advance(10000);expect(f.view().phase).toBe('SOCIAL');
    expect(f.send(f.actors[1]!,'duel:invite',{defenderId:f.actors[2],amount:50}).status).toBe('ok');const i=f.view().party!.social!.invites[0]!;
    expect(f.send(f.actors[2]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:i.id}).status).toBe('ok');expect(f.view().party!.duelHistory).toHaveLength(1);expect(f.view().party!.overthrowHistory).toHaveLength(1);clean(f);
  });
  it('cancels pending funded offers when a threshold reserves the slot, and blocks every competing admission',()=>{
    const f=social(4);expect(f.send(f.actors[1]!,'duel:invite',{defenderId:f.actors[2],amount:250}).status).toBe('ok');const invitation=f.view().party!.social!.invites[0]!;threshold(f);
    expect(f.view().party!.social!.invites[0]!.status).toBe('cancelled');clean(f);const before=structuredClone(f.room());
    expect(f.send(f.actors[2]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:invitation.id}).status).toBe('rejected');expect(f.send(f.actors[2]!,'duel:invite',{defenderId:f.actors[3],amount:50}).status).toBe('rejected');expect(f.send(f.actors[3]!,'house:ballot').status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('lets the first accepted direct duel own the slot and prevents a ballot creating an overlapping Last Stand',()=>{
    const f=social(4);open(f);vote(f,f.actors[1]!);expect(f.send(f.actors[1]!,'duel:invite',{defenderId:f.actors[2],amount:50}).status).toBe('ok');const invite=f.view().party!.social!.invites[0]!;
    expect(f.send(f.actors[2]!,'duel:accept',{game:'RPS'},{inviteId:invite.id}).status).toBe('ok');const before=structuredClone(f.room());expect(f.send(f.actors[2]!,'house:vote',{yes:true}).status).toBe('rejected');expect(f.send(f.actors[3]!,'house:vote',{yes:true}).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().party!.social!.duel!.purpose).not.toBe('LAST_STAND');assertRoom(f.room());
  });
  it('requires an actual House and a completed round of tenure, without borrowing host permissions',()=>{
    const f=social(3,1);expect(f.view().hostId).toBe(f.host);expect(f.view().party!.houseId).toBe(f.actors[1]);open(f,f.host);vote(f,f.host);vote(f,f.actors[2]!);
    const before=structuredClone(f.room());expect(f.send(f.host,'house:choose',{game:'RPS'}).status).toBe('rejected');expect(f.room()).toEqual(before);select(f);expect(f.view().hostId).toBe(f.host);clean(f);
    const g=social();g.room().party!.houseSinceRound=g.view().round;const current=structuredClone(g.room());expect(g.send(g.actors[1]!,'house:ballot').status).toBe('rejected');expect(g.room()).toEqual(current);
    g.room().party!.houseId=null;expect(g.send(g.actors[1]!,'house:ballot').status).toBe('rejected');clean(g);
  });
});

describe('zero-stake Last Stand and crown settlement',()=>{
  it('allows insolvent challengers and House to play without any escrow, fee or bank funding',()=>{
    const f=social();for(const p of f.room().players){f.room().dealerNet-=p.account.balance;p.account.balance=0;}const before=f.view().players.map(p=>p.balance),vault=f.view().party!.vault,reserve=f.view().party!.bonusReserve,bank=f.room().dealerNet;
    threshold(f);const d=select(f);expect(d).toMatchObject({purpose:'LAST_STAND',amount:0,inviterId:f.actors[1],defenderId:f.host});clean(f);
    for(let n=0;n<3;n++)choices(f,'ROCK','SCISSORS');expect(f.view().party!.houseId).toBe(f.actors[1]);expect(f.view().players.map(p=>p.balance)).toEqual(before);expect(f.view().party).toMatchObject({vault,bonusReserve:reserve});expect(f.room().dealerNet).toBe(bank);clean(f);
  });
  it('transfers the crown once on a challenger win, resets tenure and directs the next eligible commission to that winner',()=>{
    const f=social(4),b=threshold(f);select(f);for(let n=0;n<2;n++)choices(f,'ROCK','SCISSORS');const d=f.view().party!.social!.duel!,last=f.command(d.defenderId,'duel:choose',{choice:'SCISSORS'});
    expect(f.send(d.inviterId,'duel:choose',{choice:'ROCK'}).status).toBe('ok');const ack=f.manager.command(d.defenderId,last);expect(ack.status).toBe('ok');
    expect(f.view().party).toMatchObject({houseId:d.inviterId,houseSinceRound:1});expect(f.view().hostId).toBe(f.host);expect(f.view().party!.overthrowHistory).toHaveLength(1);expect(f.view().party!.duelHistory).toHaveLength(1);
    expect(f.view().party!.duelStats.find(s=>s.playerId===d.inviterId)).toMatchObject({wins:1,losses:0,draws:0});const after=structuredClone(f.room());expect(f.manager.command(d.defenderId,last)).toEqual(ack);expect(f.send(d.defenderId,'duel:resign').status).toBe('rejected');expect(f.room()).toEqual(after);
    const newHouse=f.room().players.find(p=>p.id===d.inviterId)!,oldHouse=f.room().players[0]!,balance=newHouse.account.balance;expect(payCommission(f.room(),oldHouse,100)).toBe(3);expect(newHouse.account.balance).toBe(balance+3);
    f.advance(2000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.send(f.actors[2]!,'house:ballot',undefined,{ballotId:b.id}).status).toBe('rejected');
    f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('SOCIAL');const next=open(f,f.host);expect(next.houseId).toBe(d.inviterId);clean(f);
  });
  it.each(['HOUSE','DRAW'] as const)('retains the existing crown when the outcome is %s',(outcome)=>{
    const f=social(),old=f.view().party!.houseId;threshold(f);select(f);for(let n=0;n<(outcome==='DRAW'?5:3);n++)choices(f,'ROCK',outcome==='DRAW'?'ROCK':'PAPER');
    expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party).toMatchObject({houseId:old,houseSinceRound:0});expect(f.view().party!.social!.duel!.winnerId).toBe(outcome==='DRAW'?null:old);expect(f.view().party!.overthrowHistory).toHaveLength(1);clean(f);
  });
  it.each(['RPS','COIN','CONNECT4','CHESS'] as const)('reuses the released %s game and ordinary resignation for a crown-only contest',(game)=>{
    const f=social();threshold(f);const d=select(f,game);expect(d).toMatchObject({purpose:'LAST_STAND',amount:0});
    if(game==='COIN'){expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.houseId).toBe(f.host);}else{expect(f.view().phase).toBe('DUEL');expect(f.send(f.host,'duel:resign').status).toBe('ok');expect(f.view().party!.houseId).toBe(d.inviterId);}
    expect(f.view().party!.duelHistory).toHaveLength(1);expect(f.view().party!.overthrowHistory).toHaveLength(1);clean(f);
  });
  it('forfeits selection after exactly eight seconds even while the House is disconnected',()=>{
    const f=social(4),b=threshold(f),before=f.view().players.map(p=>p.balance);f.manager.presence(f.host,false);f.advance(7999);expect(f.view().phase).toBe('LAST_STAND_CHOICE');f.advance(1);
    expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party).toMatchObject({houseId:b.challengerId,houseSinceRound:1});expect(f.view().party!.social!.duel).toBeNull();expect(f.view().party!.duelHistory).toEqual([]);expect(f.view().party!.overthrowHistory).toHaveLength(1);expect(f.view().players.map(p=>p.balance)).toEqual(before);
    f.manager.presence(f.host,true);const after=structuredClone(f.room());expect(f.send(f.host,'house:choose',{game:'COIN',coinSide:'HEADS'}).status).toBe('rejected');expect(f.room()).toEqual(after);clean(f);
  });
  it('rejects a House selection at the exact consumed deadline without starting or recording a duel',()=>{
    const f=social(4),b=threshold(f),late=f.command(f.host,'house:choose',{game:'CHESS'});f.advance(8000);const before=structuredClone(f.room());
    expect(f.manager.command(f.host,late).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().party!.houseId).toBe(b.challengerId);expect(f.view().party!.duelHistory).toHaveLength(0);expect(f.view().party!.overthrowHistory).toHaveLength(1);clean(f);
  });
  it('retains the crown when the chosen challenger is no longer available at selection timeout',()=>{
    const f=social(4),b=threshold(f),house=f.view().party!.houseId;f.manager.presence(b.challengerId!,false);f.advance(8000);
    expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.houseId).toBe(house);expect(f.view().party!.social!.duel).toBeNull();expect(f.view().party!.overthrowHistory).toHaveLength(1);clean(f);
  });
  it('rejects invalid, stale and unauthorized selections without consuming the selection window',()=>{
    const f=social(4);threshold(f);const before=structuredClone(f.room());
    for(const [actor,payload,extra] of [[f.actors[1],{game:'RPS'},{}],[f.host,{game:'UNRELEASED'},{}],[f.host,{game:'COIN'},{}],[f.host,{game:'RPS',amount:100},{}],[f.host,{game:'RPS'},{ballotId:'stale'}],[f.host,{game:'RPS'},{socialId:'stale'}]] as const){expect(f.send(actor!,'house:choose',payload,extra).status).toBe('rejected');expect(f.room()).toEqual(before);}select(f);clean(f);
  });
  it('continues accepted play deadlines through disconnect and drains obligations before low-player recovery',()=>{
    const f=social(2);threshold(f);select(f);f.manager.presence(f.actors[1]!,false);f.advance(40000);expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel!.throws).toHaveLength(5);expect(f.view().party!.houseId).toBe(f.host);clean(f);
    f.advance(2000);expect(f.view().phase).toBe('WAITING_FOR_PLAYERS');f.advance(18000);expect(f.view().phase).toBe('RESULTS');clean(f);
  });
  it('keeps the original ninety-second social budget and starts no second contest after Last Stand',()=>{
    const f=social(4),s=f.view().party!.social!;f.advance(19999);threshold(f);expect(f.view().party!.social!.hardDeadline).toBe(s.openedAt+90000);f.advance(7999);const d=select(f,'CHESS');expect(d.hardDeadline+2000).toBeLessThanOrEqual(s.hardDeadline);
    expect(f.send(d.inviterId,'duel:resign').status).toBe('ok');const before=structuredClone(f.room());expect(f.send(f.actors[2]!,'house:ballot').status).toBe('rejected');expect(f.send(f.actors[2]!,'duel:invite',{defenderId:f.actors[3],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);f.advance(2000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});clean(f);
  });
  it('clears crown history and derived duel statistics on same-room replay',()=>{
    const f=social();threshold(f);select(f,'COIN');f.advance(2000);f.advance(RULES.bettingMs+RULES.resultMs);f.advance(20000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('RESULTS');expect(f.view().party!.overthrowHistory).toHaveLength(1);
    expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.view().party).toMatchObject({houseId:null,houseSinceRound:0,overthrowHistory:[],duelHistory:[],social:null});expect(f.view().party!.duelStats.every(s=>s.wins===0&&s.losses===0&&s.draws===0)).toBe(true);clean(f);
  });
});
