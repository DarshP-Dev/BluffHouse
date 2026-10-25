import {describe,expect,it} from 'vitest';
import {RULES,type DuelGame,type CoinSide,type Command} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {reserve} from '../../apps/server/src/game/ledger.js';
import {fixture} from '../fixtures/core.js';

type F=ReturnType<typeof fixture>;
function social(players=3,rounds:3|6=6){const f=fixture({mode:'PARTY',rounds,players});f.start();f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('SOCIAL');return f;}
function fund(f:F,from=0,to=1,amount=100){expect(f.send(f.actors[from]!,'bounty:contribute',{targetId:f.actors[to],amount}).status).toBe('ok');return f.view().party!.bounties.find(b=>b.targetId===f.actors[to]&&b.status==='active')!;}
function challenge(f:F,bountyId:string,from=0){expect(f.send(f.actors[from]!,'bounty:invite',{bountyId}).status).toBe('ok');return f.view().party!.social!.invites.at(-1)!;}
function accept(f:F,inviteId:string,target=1,game:DuelGame='COIN',coinSide:CoinSide='HEADS'){expect(f.send(f.actors[target]!,'duel:accept',{game,...(game==='COIN'?{coinSide}:{})},{inviteId}).status).toBe('ok');}
function roundSocial(f:F,round:number){for(let n=0;n<40;n++){const v=f.view();if(v.phase==='SOCIAL'&&v.round===round)return;if(v.phase==='RESULTS')throw new Error('Ended before expected social interval');expect(v.deadline).not.toBeNull();f.advance(v.deadline!-v.serverTime);}throw new Error('Social interval did not open');}
function complete(f:F){for(let n=0;n<100&&f.view().phase!=='RESULTS';n++){const v=f.view();expect(v.deadline).not.toBeNull();f.advance(v.deadline!-v.serverTime);}expect(f.view().phase).toBe('RESULTS');assertRoom(f.room());}
function clean(f:F){expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);assertRoom(f.room());}

describe('host-selected immutable match round count',()=>{
  it('resets all readiness and lobby identity when the host selects six rounds',()=>{
    const f=fixture({mode:'PARTY'});for(const actor of f.actors)f.send(actor,'lobby:ready',{ready:true});const stale=f.command(f.host,'match:start'),lobby=f.view().lobbyId;
    expect(f.send(f.host,'lobby:rounds',{rounds:6}).status).toBe('ok');expect(f.view().roundLimit).toBe(6);expect(f.view().lobbyId).not.toBe(lobby);expect(f.view().players.every(p=>!p.ready)).toBe(true);const before=structuredClone(f.room());expect(f.manager.command(f.host,stale).status).toBe('rejected');expect(f.room()).toEqual(before);f.start();expect(f.view().roundLimit).toBe(6);
  });
  it('rejects nonhost, malformed and in-match settings, while Classic defaults to three rounds',()=>{
    const f=fixture({mode:'PARTY'}),before=structuredClone(f.room());expect(f.send(f.actors[1]!,'lobby:rounds',{rounds:6}).status).toBe('rejected');for(const rounds of [0,21,5.5,6.5,'6',null]){expect(f.send(f.host,'lobby:rounds',{rounds}).status).toBe('rejected');expect(f.room()).toEqual(before);}f.start();const started=structuredClone(f.room());expect(f.send(f.host,'lobby:rounds',{rounds:6}).status).toBe('rejected');expect(f.room()).toEqual(started);
    const classic=fixture();expect(classic.view().roundLimit).toBe(3);expect(classic.send(classic.host,'lobby:rounds',{rounds:4}).status).toBe('ok');classic.start();classic.advance((RULES.bettingMs+RULES.resultMs)*4);expect(classic.view()).toMatchObject({phase:'RESULTS',round:4,roundLimit:4});clean(classic);
  });
});

describe('funded bounty contributions and opportunity limits',()=>{
  it('commits real contribution escrow immediately and restores its ownership on reconnect',()=>{
    const f=social(),b=fund(f,0,1,150);expect(b).toMatchObject({targetId:f.actors[1],total:150,streak:0,status:'active',defendedIntervalIds:[]});expect(b.contributions).toEqual([{id:expect.any(String),playerId:f.host,amount:150}]);expect(f.view().players[0]).toMatchObject({balance:850,available:850,reserved:0,committed:150});expect(f.view().party!.bountyOpportunities).toBe(5);expect(f.room().players[0]!.account.escrows[b.contributions[0]!.id]).toBe(150);
    f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().party!.bounties).toEqual([b]);assertRoom(f.room());
  });
  it('retains a successful contribution request exactly once and rejects payload changes',()=>{
    const f=social(),c=f.command(f.host,'bounty:contribute',{targetId:f.actors[1],amount:250}),ack=f.manager.command(f.host,c);expect(ack.status).toBe('ok');const after=structuredClone(f.room());expect(f.manager.command(f.host,c)).toEqual(ack);expect(f.manager.command(f.host,{...c,payload:{targetId:f.actors[1],amount:50}}).code).toBe('REQUEST_CONFLICT');expect(f.room()).toEqual(after);expect(f.view().party!.bounties[0]!.total).toBe(250);
  });
  it.each([0,-50,49,51,300,50.5,'50',null])('rejects invalid contribution %s atomically',amount=>{
    const f=social(),before=structuredClone(f.room());expect(f.send(f.host,'bounty:contribute',{targetId:f.actors[1],amount}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('rejects self-funding, unavailable targets, client authority fields and insufficient available funds',()=>{
    const f=social();f.manager.presence(f.actors[2]!,false);reserve(f.room().players[0]!.account,'other-obligation',951);const before=structuredClone(f.room());for(const payload of [{targetId:f.host,amount:50},{targetId:'unknown-player',amount:50},{targetId:f.actors[2],amount:50},{targetId:f.actors[1],amount:50,winnerId:f.host},{targetId:f.actors[1],amount:50}]){expect(f.send(f.host,'bounty:contribute',payload).status).toBe('rejected');expect(f.room()).toEqual(before);}
  });
  it('serializes competing last-cap contributions and never diverts escrow between target bounties',()=>{
    const f=social();fund(f,0,1,250);fund(f,0,1,250);fund(f,2,1,250);const b=fund(f,0,1,200);expect(b.total).toBe(950);
    const first=f.command(f.host,'bounty:contribute',{targetId:f.actors[1],amount:50}),second=f.command(f.actors[2]!,'bounty:contribute',{targetId:f.actors[1],amount:50});expect(f.manager.command(f.host,first).status).toBe('ok');const full=structuredClone(f.room());expect(f.manager.command(f.actors[2]!,second).status).toBe('rejected');expect(f.room()).toEqual(full);expect(f.view().party!.bounties[0]!.total).toBe(1000);expect(f.view().players.map(p=>p.balance)).toEqual([250,1000,750]);assertRoom(f.room());
    const other=fund(f,1,2,50);expect(other.id).not.toBe(b.id);expect(f.view().party!.bounties.map(b=>b.total)).toEqual([1000,50]);assertRoom(f.room());
  });
  it('requires three future social opportunities for a new bounty but permits funding an existing late bounty',()=>{
    const f=social(),b=fund(f);roundSocial(f,3);expect(f.view().party!.bountyOpportunities).toBe(3);const latest=fund(f,1,2,50);expect(latest.status).toBe('active');roundSocial(f,4);expect(f.view().party!.bountyOpportunities).toBe(2);expect(f.send(f.actors[2]!,'bounty:contribute',{targetId:f.host,amount:50}).status).toBe('rejected');expect(fund(f,2,1,50).id).toBe(b.id);assertRoom(f.room());
    const short=social(3,3),before=structuredClone(short.room());expect(short.view().party!.bountyOpportunities).toBe(2);expect(short.send(short.host,'bounty:contribute',{targetId:short.actors[1],amount:50}).status).toBe('rejected');expect(short.room()).toEqual(before);
  });
  it('permits contribution only during live admission and freezes all funding during an accepted bounty duel',()=>{
    const f=social(),b=fund(f),i=challenge(f,b.id);accept(f,i.id,1,'RPS');const before=structuredClone(f.room());expect(f.send(f.actors[2]!,'bounty:contribute',{targetId:f.actors[1],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
    const early=fixture({mode:'PARTY',rounds:6});early.start();const auction=structuredClone(early.room());expect(early.send(early.host,'bounty:contribute',{targetId:early.actors[1],amount:50}).status).toBe('rejected');expect(early.room()).toEqual(auction);
  });
});

describe('bounty challenges, defense streaks and exact funded awards',()=>{
  it('plays a complete six-round journey with three qualifying target wins and one full bounty award',()=>{
    const f=social(),b=fund(f,0,1,250);for(let defense=1;defense<=3;defense++){
      roundSocial(f,defense);const interval=f.view().party!.social!.id,i=challenge(f,b.id);expect(i).toMatchObject({amount:50,purpose:'BOUNTY',bountyId:b.id});accept(f,i.id);const current=f.view().party!.bounties[0]!;expect(current.streak).toBe(defense);expect(current.defendedIntervalIds).toContain(interval);expect(current.status).toBe(defense===3?'claimed':'active');expect(f.view().party!.duelHistory.at(-1)).toMatchObject({purpose:'BOUNTY',bountyId:b.id,winnerId:f.actors[1]});assertRoom(f.room());
    }
    expect(f.view().players.map(p=>p.balance)).toEqual([600,1400,1000]);expect(f.view().party!.transfers.filter(t=>t.kind==='bounty_award')).toEqual([expect.objectContaining({amount:250,to:f.actors[1]})]);expect(f.room().dealerNet).toBe(0);complete(f);expect(f.view()).toMatchObject({round:6,roundLimit:6});expect(f.view().results!.standings.map(p=>p.balance)).toEqual([1400,1000,600]);expect(f.view().party!.bounties[0]!.status).toBe('claimed');clean(f);
  });
  it.each([50,150,250])('pays floor85%% of a %i-chip defeated bounty and puts the exact remainder into the Vault',amount=>{
    const f=social(),b=fund(f,2,1,amount),i=challenge(f,b.id);accept(f,i.id,1,'COIN','TAILS');const award=Math.floor(85*amount/100),vault=amount-award;
    expect(f.view().party!.bounties[0]).toMatchObject({status:'defeated',streak:0,winnerId:f.host});expect(f.view().players.map(p=>p.balance)).toEqual([1050+award,950,1000-amount]);expect(f.view().party!.vault).toBe(vault);expect(f.view().party!.bonusReserve).toBe(300);expect(f.room().dealerNet).toBe(0);expect(f.view().party!.transfers.filter(t=>t.kind==='bounty_award')).toEqual([expect.objectContaining({amount:award,to:f.host})]);expect(f.view().party!.transfers.filter(t=>t.kind==='bounty_vault')).toEqual([expect.objectContaining({amount:vault,to:'VAULT'})]);const settled=structuredClone(f.room());expect(f.send(f.host,'duel:resign').status).toBe('rejected');expect(f.room()).toEqual(settled);assertRoom(f.room());
  });
  it('rejects a second qualifying defense for the same target in one interval even after a new bounty is funded',()=>{
    const f=social(),b=fund(f,2,1,50),i=challenge(f,b.id);accept(f,i.id,1,'COIN','TAILS');f.advance(2000);expect(f.view().party!.social!.slot).toBe(2);const again=fund(f,2,1,50);expect(again.id).not.toBe(b.id);const before=structuredClone(f.room());expect(f.send(f.host,'bounty:invite',{bountyId:again.id}).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('leaves the streak unchanged after a draw, refusal and expiry, and counts only accepted intervals',()=>{
    const f=social(),b=fund(f),win=challenge(f,b.id);accept(f,win.id);expect(f.view().party!.bounties[0]!.streak).toBe(1);roundSocial(f,2);const draw=challenge(f,b.id);accept(f,draw.id,1,'RPS');for(let n=0;n<5;n++){expect(f.send(f.host,'duel:choose',{choice:'PAPER'}).status).toBe('ok');expect(f.send(f.actors[1]!,'duel:choose',{choice:'PAPER'}).status).toBe('ok');}expect(f.view().party!.bounties[0]!.streak).toBe(1);f.advance(2000);expect(f.send(f.host,'bounty:invite',{bountyId:b.id}).status).toBe('rejected');roundSocial(f,3);
    const declined=challenge(f,b.id);expect(f.send(f.actors[1]!,'duel:reject',undefined,{inviteId:declined.id}).status).toBe('ok');expect(f.view().party!.bounties[0]!.streak).toBe(1);const expired=challenge(f,b.id);f.advance(8000);expect(f.view().party!.social!.invites.find(i=>i.id===expired.id)!.status).toBe('expired');expect(f.view().party!.bounties[0]!.streak).toBe(1);expect(f.view().party!.bounties[0]!.defendedIntervalIds).toHaveLength(2);assertRoom(f.room());
  });
  it('keeps accepted bounty and duel funds binding through target disconnect and missing-action forfeit',()=>{
    const f=social(),b=fund(f,2,1,150),i=challenge(f,b.id);accept(f,i.id,1,'RPS');f.manager.presence(f.actors[1]!,false);const escrow=structuredClone(f.room().players[1]!.account.escrows);expect(Object.values(escrow)).toEqual([50]);for(let n=0;n<3;n++){expect(f.send(f.host,'duel:choose',{choice:'ROCK'}).status).toBe('ok');f.advance(8000);}expect(f.view().party!.bounties[0]).toMatchObject({status:'defeated',winnerId:f.host});expect(f.view().players.map(p=>p.balance)).toEqual([1177,950,850]);expect(f.view().party!.vault).toBe(23);f.manager.presence(f.actors[1]!,true);expect(f.view(f.actors[1]).party!.bounties).toEqual(f.view().party!.bounties);assertRoom(f.room());
  });
  it('settles resignation and duplicate acceptance once without exposing bounty funding as available chips',()=>{
    const f=social(),b=fund(f,2,1,100),i=challenge(f,b.id),c=f.command(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:i.id}),ack=f.manager.command(f.actors[1]!,c);expect(ack.status).toBe('ok');expect(f.view().players[2]).toMatchObject({balance:900,available:900,committed:100});expect(f.send(f.actors[1]!,'duel:resign').status).toBe('ok');const after=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,c)).toEqual(ack);expect(f.room()).toEqual(after);expect(f.view().party!.bounties[0]!.status).toBe('defeated');assertRoom(f.room());
  });
  it('rejects self, stale and unfunded bounty invitations without changing the active contribution escrow',()=>{
    const f=social(),b=fund(f);reserve(f.room().players[2]!.account,'reserved-for-other-use',951);const before=structuredClone(f.room());for(const [actor,payload] of [[f.actors[1],{bountyId:b.id}],[f.host,{bountyId:'stale-bounty'}],[f.actors[2],{bountyId:b.id}],[f.host,{bountyId:b.id,amount:250}]] as const){expect(f.send(actor!,'bounty:invite',payload).status).toBe('rejected');expect(f.room()).toEqual(before);}
  });
  it('releases a target’s conflicting outgoing reservation before funding the accepted bounty defense',()=>{
    const f=social(),b=fund(f),target=f.room().players[1]!;f.room().dealerNet-=target.account.balance-50;target.account.balance=50;assertRoom(f.room());expect(f.send(target.id,'duel:invite',{defenderId:f.actors[2],amount:50}).status).toBe('ok');const outgoing=f.view().party!.social!.invites.at(-1)!;expect(f.view().players[1]).toMatchObject({balance:50,available:0,reserved:50});const incoming=challenge(f,b.id);accept(f,incoming.id,1,'RPS');expect(f.view().party!.social!.invites.find(i=>i.id===outgoing.id)!.status).toBe('cancelled');expect(f.view().players[1]).toMatchObject({balance:0,reserved:0,committed:50});expect(f.view().party!.social!.duel).toMatchObject({purpose:'BOUNTY',bountyId:b.id,amount:50});assertRoom(f.room());
  });
});

describe('two sequential social slots within a fixed six-round budget',()=>{
  it('plays exactly two contests with no overlap and preserves the original interval and hard deadline',()=>{
    const f=social(),original=f.view().party!.social!,b=fund(f),first=challenge(f,b.id);expect(original.hardDeadline-original.openedAt).toBe(180000);expect(original.slot).toBe(1);accept(f,first.id);const busy=structuredClone(f.room());expect(f.send(f.actors[2]!,'duel:invite',{defenderId:f.host,amount:50}).status).toBe('rejected');expect(f.room()).toEqual(busy);f.advance(2000);
    const second=f.view().party!.social!;expect(second).toMatchObject({id:original.id,openedAt:original.openedAt,hardDeadline:original.hardDeadline,slot:2});expect(second.slotOpenedAt).toBe(f.view().serverTime);expect(second.admissionDeadline-second.slotOpenedAt).toBe(20000);expect(second.duel).toBeNull();expect(f.send(f.actors[2]!,'duel:invite',{defenderId:f.host,amount:50}).status).toBe('ok');const i=f.view().party!.social!.invites.at(-1)!;accept(f,i.id,0);f.advance(2000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.view().party!.duelHistory).toHaveLength(2);assertRoom(f.room());
  });
  it('does not open an empty second slot when the first admission was unused',()=>{
    const f=social(),start=f.view().serverTime;f.advance(20000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.view().serverTime-start).toBe(20000);expect(f.view().party!.social).toBeNull();
  });
  it('rejects delayed first-slot admission commands in the second slot while keeping the interval identity',()=>{
    const f=social(),b=fund(f),first=f.view().party!.social!,old:Command[]=[f.command(f.actors[2]!,'bounty:contribute',{targetId:f.actors[1],amount:50}),f.command(f.actors[2]!,'bounty:invite',{bountyId:b.id}),f.command(f.actors[2]!,'duel:invite',{defenderId:f.host,amount:50}),f.command(f.actors[2]!,'house:ballot')];const i=challenge(f,b.id);accept(f,i.id);f.advance(2000);expect(f.view().party!.social!.id).toBe(first.id);expect(f.view().party!.social!.slotId).not.toBe(first.slotId);
    const before=structuredClone(f.room());for(const command of old){expect(f.manager.command(f.actors[2]!,command)).toMatchObject({status:'rejected',code:'STALE_SOCIAL_SLOT'});expect(f.room()).toEqual(before);}assertRoom(f.room());
  });
  it('keeps three-round Party at one ninety-second slot',()=>{
    const f=social(3,3),s=f.view().party!.social!;expect(s.hardDeadline-s.openedAt).toBe(90000);expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:50}).status).toBe('ok');accept(f,f.view().party!.social!.invites.at(-1)!.id);f.advance(2000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});
  });
  it('caps bounty invitations to admission and never extends it after refusals or expiry',()=>{
    const f=social(),s=f.view().party!.social!,deadline=s.admissionDeadline,hard=s.hardDeadline;f.advance(15000);const b=fund(f),i=challenge(f,b.id);expect(i.deadline).toBe(deadline);expect(f.send(f.actors[1]!,'duel:reject',undefined,{inviteId:i.id}).status).toBe('ok');expect(f.view().party!.social!.admissionDeadline).toBe(deadline);const pending=challenge(f,b.id);expect(pending.deadline).toBe(deadline);f.advance(5000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.view().serverTime).toBe(deadline);expect(hard-s.openedAt).toBe(180000);assertRoom(f.room());
  });
  it('runs a Last Stand in the first slot and an ordinary duel in the second without reopening its ballot',()=>{
    const f=fixture({mode:'PARTY',rounds:6,players:4});f.start();expect(f.send(f.host,'house:bid',{amount:50}).status).toBe('ok');f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);const original=f.view().party!.social!;
    expect(f.send(f.actors[1]!,'house:ballot').status).toBe('ok');const ballot=f.view().party!.social!.ballot!;for(const actor of ballot.eligibleVoterIds)expect(f.send(actor,'house:vote',{yes:true}).status).toBe('ok');expect(f.view().phase).toBe('LAST_STAND_CHOICE');expect(f.send(f.host,'house:choose',{game:'COIN',coinSide:'HEADS'}).status).toBe('ok');expect(f.view().phase).toBe('DUEL_RESULT');f.advance(2000);
    expect(f.view().party!.social).toMatchObject({slot:2,id:original.id,hardDeadline:original.hardDeadline});const before=structuredClone(f.room());expect(f.send(f.actors[1]!,'house:ballot').status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.actors[1]!,'duel:invite',{defenderId:f.actors[2],amount:50}).status).toBe('ok');const invite=f.view().party!.social!.invites.at(-1)!;accept(f,invite.id,2);f.advance(2000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.view().party!.duelHistory.map(d=>d.purpose)).toEqual(['LAST_STAND',undefined]);expect(f.view().party!.overthrowHistory).toHaveLength(1);expect(f.view().party!.houseId).toBe(f.host);assertRoom(f.room());
  });
  it('caps a second-slot House ballot at its original admission deadline and rejects a deadline vote',()=>{
    const f=fixture({mode:'PARTY',rounds:6,players:3});f.start();expect(f.send(f.host,'house:bid',{amount:50}).status).toBe('ok');f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);const hard=f.view().party!.social!.hardDeadline;expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:50}).status).toBe('ok');accept(f,f.view().party!.social!.invites.at(-1)!.id);f.advance(2000);const deadline=f.view().party!.social!.admissionDeadline;f.advance(15000);expect(f.send(f.actors[1]!,'house:ballot').status).toBe('ok');expect(f.view().party!.social!.ballot!.deadline).toBe(deadline);expect(f.send(f.actors[1]!,'house:vote',{yes:false}).status).toBe('ok');expect(f.view().party!.social!.admissionDeadline).toBe(deadline);expect(f.view().party!.social!.hardDeadline).toBe(hard);
    const late=f.command(f.actors[2]!,'house:vote',{yes:true});f.advance(5000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});const before=structuredClone(f.room());expect(f.manager.command(f.actors[2]!,late).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().party!.overthrowHistory[0]!.status).toBe('failed');assertRoom(f.room());
  });
  it('cancels incompatible pending ordinary and bounty offers at the first accepted contest',()=>{
    const f=social(4),b=fund(f,3,1,100),a=challenge(f,b.id,0);expect(f.send(f.actors[2]!,'duel:invite',{defenderId:f.actors[3],amount:250}).status).toBe('ok');const ordinary=f.view().party!.social!.invites.at(-1)!;accept(f,a.id,1,'RPS');expect(f.view().party!.social!.invites.find(i=>i.id===ordinary.id)!.status).toBe('cancelled');expect(f.view().players[2]!.reserved).toBe(0);const before=structuredClone(f.room());expect(f.send(f.actors[3]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:ordinary.id}).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
});

describe('unclaimed bounty refunds before all ending rankings',()=>{
  it('refunds each original contributor in a normal ending and resets bounty state on same-room replay',()=>{
    const f=social(),b=fund(f,0,1,150);fund(f,2,1,50);complete(f);expect(f.view().party!.bounties[0]).toMatchObject({id:b.id,status:'refunded',total:200});expect(f.view().results!.standings.map(p=>p.balance)).toEqual([1000,1000,1000]);expect(f.view().party!.transfers.filter(t=>t.kind==='bounty_refund').map(t=>t.amount).sort((a,b)=>a-b)).toEqual([50,150]);clean(f);expect(f.send(f.host,'results:return').status).toBe('ok');expect(f.view().roundLimit).toBe(6);f.start();expect(f.view().party!.bounties).toEqual([]);expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000,1000]);clean(f);
  });
  it('returns unresolved contributions during low-player recovery including a departed contributor',()=>{
    const f=social(),b=fund(f,2,1,250);expect(f.send(f.actors[2]!,'room:leave').status).toBe('ok');f.manager.presence(f.actors[1]!,false);f.advance(60000);expect(f.view().phase).toBe('RESULTS');expect(f.view().party!.bounties[0]).toMatchObject({id:b.id,status:'refunded'});expect(f.view().results!.standings.find(p=>p.id===f.actors[2])!.balance).toBe(1000);clean(f);
  });
  it('preserves an accepted contest through termination, settles its bounty, then ranks the final funded balances',()=>{
    const f=social(),b=fund(f,2,1,50),i=challenge(f,b.id);accept(f,i.id,1,'RPS');f.manager.presence(f.actors[1]!,false);f.manager.presence(f.actors[2]!,false);for(let n=0;n<3;n++){expect(f.send(f.host,'duel:choose',{choice:'ROCK'}).status).toBe('ok');f.advance(8000);}f.advance(60000);expect(f.view().phase).toBe('RESULTS');expect(f.view().party!.bounties[0]).toMatchObject({status:'defeated'});expect(f.view().results!.standings.find(p=>p.id===f.host)!.balance).toBe(1095);expect(f.view().party!.vault).toBe(0);clean(f);
  });
});
