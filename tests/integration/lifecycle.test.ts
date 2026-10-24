import {describe,expect,it} from 'vitest';
import {RULES} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';

type Fixture=ReturnType<typeof fixture>;
function skipRound(f:Fixture){f.advance(RULES.bettingMs+RULES.resultMs);}
function finishMatch(f:Fixture){f.start();for(let n=0;n<3;n++)skipRound(f);expect(f.view().phase).toBe('RESULTS');}
function noEscrow(f:Fixture){expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);assertRoom(f.room());}
/** Seed a valid prior dealer loss to exercise boundaries unreachable by skipped wagers. */
function balances(f:Fixture,amounts:number[]){for(const [index,amount] of amounts.entries())f.room().players[index]!.account.balance=amount;f.room().dealerNet=amounts.reduce((a,b)=>a+b,0)-f.room().initialChips;assertRoom(f.room());}

describe('lobby seats and host ownership',()=>{
  it('transfers an absent lobby host at exactly thirty seconds without giving the crown back on reconnect',()=>{
    const f=fixture({players:3}),originalLobby=f.view().lobbyId;
    f.manager.presence(f.host,false);f.advance(29999);expect(f.view().hostId).toBe(f.host);
    f.advance(1);expect(f.view().hostId).toBe(f.actors[1]);f.manager.presence(f.host,true);
    expect(f.view().hostId).toBe(f.actors[1]);expect(f.view().lobbyId).toBe(originalLobby);
    expect(f.send(f.host,'match:start').code).toBe('NOT_HOST');
  });
  it('cancels the old host timer on reconnect and measures the next absence afresh',()=>{
    const f=fixture();f.manager.presence(f.host,false);f.advance(29000);f.manager.presence(f.host,true);
    f.advance(1001);expect(f.view().hostId).toBe(f.host);f.manager.presence(f.host,false);
    f.advance(29999);expect(f.view().hostId).toBe(f.host);f.advance(1);expect(f.view().hostId).toBe(f.actors[1]);
  });
  it('keeps an absent lobby seat for fifty-nine seconds, removes it at sixty, then permits a fresh join',()=>{
    const f=fixture(),guest=f.actors[1]!,code=f.view().code;
    f.manager.presence(guest,false);f.advance(59999);expect(f.view().players).toHaveLength(2);expect(f.manager.snapshot(guest)).not.toBeNull();
    f.advance(1);expect(f.view().players).toHaveLength(1);expect(f.manager.snapshot(guest)).toBeNull();
    expect(f.send(guest,'room:join',{username:'Player 2',roomCode:code}).status).toBe('ok');expect(f.view().players[1]).toMatchObject({id:guest,ready:false,balance:1000,connected:true});
  });
  it('does not remove a reconnected seat when its obsolete cleanup deadline arrives',()=>{
    const f=fixture(),guest=f.actors[1]!;f.manager.presence(guest,false);f.advance(59000);f.manager.presence(guest,true);f.advance(2000);
    expect(f.view().players).toHaveLength(2);expect(f.manager.snapshot(guest)?.viewerId).toBe(guest);
  });
  it('transfers immediately on intentional host departure and revokes recovery of that seat',()=>{
    const f=fixture({players:3}),instance=f.view().instanceId;
    expect(f.send(f.host,'room:leave').status).toBe('ok');expect(f.manager.snapshot(f.host)).toBeNull();
    expect(f.manager.rooms.get(instance)?.hostId).toBe(f.actors[1]);f.manager.presence(f.host,true);
    expect(f.manager.snapshot(f.host)).toBeNull();expect(f.manager.snapshot(f.actors[1]!)?.players).toHaveLength(2);
  });
  it('replaces the active-match host timer with the lobby grace period after returning from results',()=>{
    const f=fixture({players:3});f.start();skipRound(f);skipRound(f);f.manager.presence(f.host,false);skipRound(f);
    expect(f.view().phase).toBe('RESULTS');expect(f.send(f.actors[1]!,'results:return').status).toBe('ok');
    // The host is still absent, but a lobby has a thirty-second grace period.
    f.advance(29999);expect(f.view().hostId).toBe(f.host);f.advance(1);expect(f.view().hostId).toBe(f.actors[1]);
  });
});

describe('active-match host and recovery deadlines',()=>{
  it('does not admit an absent lobby guest into a match that started without them',()=>{
    const f=fixture({players:3}),absent=f.actors[2]!;f.manager.presence(absent,false);
    for(const actor of f.actors.slice(0,2))f.send(actor,'lobby:ready',{ready:true});expect(f.send(f.host,'match:start').status).toBe('ok');
    f.manager.presence(absent,true);expect(f.view(absent).players[2]?.status).toBe('observer');
    expect(f.send(absent,'bet:submit',{amount:100}).code).toBe('NOT_PARTICIPATING');
    skipRound(f);skipRound(f);skipRound(f);expect(f.view().results?.standings).toHaveLength(2);
    expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.room().players.every(p=>p.participating)).toBe(true);
  });
  it('transfers an active host at sixty seconds, preserves the match and never restores former authority',()=>{
    const f=fixture({players:3});f.start();f.bet();const match=f.view().matchId;
    f.manager.presence(f.host,false);f.advance(59999);expect(f.view().hostId).toBe(f.host);expect(f.view().phase).not.toBe('RESULTS');
    f.advance(1);expect(f.view().hostId).toBe(f.actors[1]);f.manager.presence(f.host,true);
    expect(f.view().hostId).toBe(f.actors[1]);expect(f.view().matchId).toBe(match);expect(f.view().players[0]!.balance).toBe(900);
  });
  it('waits at a settled boundary, resumes at fifty-nine seconds and cancels the pending end',()=>{
    const f=fixture(),guest=f.actors[1]!;f.start();f.manager.presence(guest,false);skipRound(f);
    expect(f.view().phase).toBe('WAITING_FOR_PLAYERS');expect(f.view().round).toBe(1);expect(f.view().results).toBeNull();
    f.advance(35000);f.manager.presence(guest,true);expect(f.view().phase).toBe('BETTING');expect(f.view().round).toBe(2);expect(f.view().recoveryDeadline).toBeNull();
    f.advance(1000);expect(f.view().phase).toBe('BETTING');expect(f.room().terminationConfirmed).toBe(false);
  });
  it('confirms termination at exactly sixty seconds and cannot resume a new round after reconnect',()=>{
    const f=fixture(),guest=f.actors[1]!;f.start();f.manager.presence(guest,false);f.advance(59999);
    expect(f.view().phase).toBe('WAITING_FOR_PLAYERS');f.advance(1);expect(f.view().phase).toBe('RESULTS');
    expect(f.view().results?.reason).toContain('recovery window');expect(f.view().results?.standings).toHaveLength(2);const results=structuredClone(f.view().results);
    f.manager.presence(guest,true);f.advance(10000);expect(f.view().phase).toBe('RESULTS');expect(f.view().results).toEqual(results);noEscrow(f);
  });
  it('finishes committed wagers after the recovery window expires, even if enough players subsequently return',()=>{
    const f=fixture({players:3});f.start();f.bet();for(const guest of f.actors.slice(1))f.manager.presence(guest,false);
    f.advance(60000);expect(f.room().terminationConfirmed).toBe(true);expect(f.view().phase).toBe('PLAYER_TURN');
    expect(f.room().players.some(p=>Object.keys(p.account.escrows).length)).toBe(true);
    for(const guest of f.actors.slice(1))f.manager.presence(guest,true);expect(f.room().terminationConfirmed).toBe(true);
    f.advance(30000);expect(f.view().phase).toBe('RESULTS');expect(f.view().round).toBe(1);expect(f.view().results?.reason).toContain('recovery window');
    expect(f.view().results?.standings).toHaveLength(3);noEscrow(f);
  });
  it('does not refund a submitted wager when its owner intentionally leaves before betting closes',()=>{
    const f=fixture(),guest=f.actors[1]!;f.start();f.bet();const wager=f.room().players[1]!.wagerId!;
    expect(f.send(guest,'room:leave').status).toBe('ok');expect(f.manager.snapshot(guest)).toBeNull();expect(f.room().players[1]!.account.reservations[wager]).toBe(100);
    f.deal();expect(f.room().players[1]!.account.escrows[wager]).toBe(100);f.manager.presence(guest,true);expect(f.room().players[1]!.connected).toBe(false);
    f.advance(60000);expect(f.view().phase).toBe('RESULTS');expect(f.view().results?.standings.find(p=>p.id===guest)?.balance).toBe(900);noEscrow(f);
  });
  it('preserves an accepted bluff and final absent-player statistics on explicit departure',()=>{
    const f=fixture({ranks:['6','9','10','6','8','7','6']}),guest=f.actors[1]!;f.start();f.bet();f.deal();
    expect(f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:100}).status).toBe('ok');expect(f.send(guest,'bluff:accept').status).toBe('ok');const outcome=structuredClone(f.view().bluff);
    f.send(guest,'room:leave');f.advance(70000);expect(f.view().phase).toBe('RESULTS');expect(f.view().results?.biggestBluff).toEqual(outcome);
    expect(f.view().results?.standings.find(p=>p.id===guest)).toMatchObject({bluffWins:0,bluffLosses:1,balance:900});noEscrow(f);
  });
});

describe('safe-boundary ordering and affordability',()=>{
  it('shows normal third-round results without an extra recovery wait if termination was not confirmed',()=>{
    const f=fixture();f.start();skipRound(f);skipRound(f);f.manager.presence(f.actors[1]!,false);skipRound(f);
    expect(f.view().phase).toBe('RESULTS');expect(f.room().terminationConfirmed).toBe(false);expect(f.view().results?.reason).toBeUndefined();expect(f.view().recoveryDeadline).toBeNull();
  });
  it('keeps the early-ending reason when recovery expires during round three before wagers settle',()=>{
    const f=fixture({players:3});f.start();skipRound(f);skipRound(f);f.bet();for(const guest of f.actors.slice(1))f.manager.presence(guest,false);
    f.advance(60000);expect(f.view().round).toBe(3);expect(f.room().terminationConfirmed).toBe(true);expect(f.view().phase).not.toBe('RESULTS');
    f.advance(30000);expect(f.view().phase).toBe('RESULTS');expect(f.view().results?.reason).toContain('recovery window');noEscrow(f);
  });
  it.each([[1000,25],[25,25]])('ends after settlement when fewer than two players can afford 50 (%j)',(first,second)=>{
    const f=fixture();f.start();balances(f,[first,second]);skipRound(f);
    expect(f.view().phase).toBe('RESULTS');expect(f.view().results?.reason).toContain('minimum wager');expect(f.view().round).toBe(1);noEscrow(f);
  });
  it('treats exactly fifty as affordable and voluntarily skipped wagers as an ordinary round',()=>{
    const f=fixture();f.start();balances(f,[50,50]);skipRound(f);expect(f.view().phase).toBe('BETTING');expect(f.view().round).toBe(2);expect(f.view().results).toBeNull();
  });
  it('honors connection recovery before affordability, then checks money immediately when guests return',()=>{
    const f=fixture();f.start();balances(f,[1000,25]);f.manager.presence(f.actors[1]!,false);skipRound(f);
    expect(f.view().phase).toBe('WAITING_FOR_PLAYERS');expect(f.view().results).toBeNull();f.advance(35000);f.manager.presence(f.actors[1]!,true);
    expect(f.view().phase).toBe('RESULTS');expect(f.view().results?.reason).toContain('minimum wager');
  });
});

describe('safe room disposal',()=>{
  it('disposes an empty lobby at ten minutes and releases room code, memberships and scoped requests',()=>{
    const f=fixture(),instance=f.view().instanceId,code=f.view().code;for(const actor of f.actors)f.manager.presence(actor,false);
    f.advance(599999);expect(f.manager.rooms.has(instance)).toBe(true);f.advance(1);expect(f.manager.rooms.has(instance)).toBe(false);
    expect(f.manager.codes.has(code)).toBe(false);expect(f.manager.membership.size).toBe(0);expect([...f.manager.records.values()].some(record=>record.roomId===instance)).toBe(false);
  });
  it('cancels empty-lobby cleanup when a fresh guest arrives',()=>{
    const f=fixture(),instance=f.view().instanceId,code=f.view().code;for(const actor of f.actors)f.manager.presence(actor,false);f.advance(599999);
    expect(f.send('new-player','room:join',{username:'New Player',roomCode:code}).status).toBe('ok');f.advance(1);expect(f.manager.rooms.has(instance)).toBe(true);expect(f.manager.snapshot('new-player')?.hostId).toBe('new-player');
  });
  it('disposes settled inactive results at exactly fifteen minutes, never before',()=>{
    const f=fixture();finishMatch(f);noEscrow(f);const instance=f.view().instanceId;f.advance(899999);expect(f.manager.rooms.has(instance)).toBe(true);
    f.advance(1);expect(f.manager.rooms.has(instance)).toBe(false);expect(f.manager.snapshot(f.host)).toBeNull();
  });
  it('starts the results inactivity window again on an authenticated reaction',()=>{
    const f=fixture();finishMatch(f);const instance=f.view().instanceId;f.advance(840000);expect(f.send(f.host,'reaction:send',{emoji:'🔥'}).status).toBe('ok');
    f.advance(60000);expect(f.manager.rooms.has(instance)).toBe(true);f.advance(839999);expect(f.manager.rooms.has(instance)).toBe(true);
    f.advance(1);expect(f.manager.rooms.has(instance)).toBe(false);
  });
  it('retains an all-disconnected room while wagers are unsettled and only begins results cleanup after settlement',()=>{
    const f=fixture({players:3});f.start();f.bet();for(const actor of f.actors)f.manager.presence(actor,false);const instance=f.view().instanceId;
    f.advance(60000);expect(f.manager.rooms.has(instance)).toBe(true);expect(f.view().phase).toBe('PLAYER_TURN');expect(f.room().players.every(p=>Object.keys(p.account.escrows).length===1)).toBe(true);
    f.advance(30000);expect(f.view().phase).toBe('RESULTS');noEscrow(f);const remaining=f.room().resultsSince!+900000-f.view().serverTime;
    f.advance(remaining-1);expect(f.manager.rooms.has(instance)).toBe(true);f.advance(1);expect(f.manager.rooms.has(instance)).toBe(false);
  });
});
