import {describe,expect,it} from 'vitest';
import {RULES,type DealChoice} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {reserve} from '../../apps/server/src/game/ledger.js';
import {fixture} from '../fixtures/core.js';

type F=ReturnType<typeof fixture>;
function social(players=3,rounds:3|6=6,house=false){const f=fixture({mode:'PARTY',players,rounds});f.start();if(house)expect(f.send(f.host,'house:bid',{amount:50}).status).toBe('ok');f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('SOCIAL');return f;}
function offer(f:F,from=0,to=1,amount=100){expect(f.send(f.actors[from]!,'deal:offer',{defenderId:f.actors[to],amount}).status).toBe('ok');return f.view().party!.social!.dealInvites.at(-1)!;}
function accept(f:F,id:string,defender=1){const ack=f.send(f.actors[defender]!,'deal:accept',undefined,{dealOfferId:id});expect(ack.status).toBe('ok');expect(f.view().phase).toBe('DEAL');return ack;}
function choosing(players=3,rounds:3|6=6,amount=100){const f=social(players,rounds),o=offer(f,0,1,amount);accept(f,o.id);return f;}
function lock(f:F,seat:number,choice:DealChoice){expect(f.send(f.actors[seat]!,'deal:choose',{choice}).status).toBe('ok');}
function finish(f:F){for(let n=0;n<100&&f.view().phase!=='RESULTS';n++){const v=f.view();expect(v.deadline).not.toBeNull();f.advance(v.deadline!-v.serverTime);}expect(f.view().phase).toBe('RESULTS');assertRoom(f.room());}
function clean(f:F){expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);assertRoom(f.room());}

describe('social offers and atomic equal contract funding',()=>{
  it('reserves the inviter contribution, discloses the missing-choice rule, and commits both contributions only on acceptance',()=>{
    const f=social(),o=offer(f,0,1,250);expect(o).toMatchObject({amount:250,status:'pending',slot:1,deadline:f.view().serverTime+8000});expect(f.view().players[0]).toMatchObject({balance:1000,reserved:250,available:750,committed:0});expect(f.view().events.at(-1)!.text).toMatch(/missing decision.*Steal/i);accept(f,o.id);expect(f.view().players.map(p=>[p.balance,p.reserved,p.committed])).toEqual([[750,0,250],[750,0,250],[1000,0,0]]);expect(f.view().party!.social!.deal).toMatchObject({id:o.id,amount:250,status:'choosing',lockedPlayerIds:[],defaultedPlayerIds:[],bonusEach:0,returns:{},vaultAmount:0});expect(f.view().deadline!-f.view().serverTime).toBe(10000);assertRoom(f.room());
  });
  it.each([0,49,51,300,-50,100.5,'100',null])('rejects invalid equal contribution %s without reserving chips',amount=>{
    const f=social(),before=structuredClone(f.room());expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('rejects self, unavailable, foreign and client-selected outcome fields atomically',()=>{
    const f=social();f.manager.presence(f.actors[2]!,false);const before=structuredClone(f.room());for(const payload of [{defenderId:f.host,amount:100},{defenderId:'unknown-player',amount:100},{defenderId:f.actors[2],amount:100},{defenderId:f.actors[1],amount:100,winnerId:f.host}]){expect(f.send(f.host,'deal:offer',payload).status).toBe('rejected');expect(f.room()).toEqual(before);}const classic=fixture();classic.start();const initial=structuredClone(classic.room());expect(classic.send(classic.host,'deal:offer',{defenderId:classic.actors[1],amount:100}).status).toBe('rejected');expect(classic.room()).toEqual(initial);
  });
  it('rejects an unfunded offer and preserves every pending offer when acceptance cannot be funded',()=>{
    const f=social(4);reserve(f.room().players[0]!.account,'unavailable-inviter-funds',951);let before=structuredClone(f.room());expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);
    const o=offer(f,2,1,100);expect(f.send(f.actors[3]!,'duel:invite',{defenderId:f.actors[2],amount:150}).status).toBe('ok');reserve(f.room().players[1]!.account,'unavailable-defender-funds',951);before=structuredClone(f.room());expect(f.send(f.actors[1]!,'deal:accept',undefined,{dealOfferId:o.id}).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('releases the defender’s outgoing offer before funding the accepted incoming contract',()=>{
    const f=social(),p=f.room().players[1]!;f.room().party!.bank.balance+=p.account.balance-50;f.room().dealerNet=f.room().party!.bank.initial-f.room().party!.bank.balance;p.account.balance=50;const outgoing=offer(f,1,2,50),incoming=offer(f,0,1,50);expect(f.view().players[1]).toMatchObject({balance:50,available:0,reserved:50});accept(f,incoming.id);expect(f.view().party!.social!.dealInvites.find(o=>o.id===outgoing.id)!.status).toBe('cancelled');expect(f.view().players[1]).toMatchObject({balance:0,reserved:0,committed:50});assertRoom(f.room());
  });
  it('allows only one pending outgoing invitation across duels and contracts',()=>{
    const f=social(),o=offer(f);let before=structuredClone(f.room());expect(f.send(f.host,'duel:invite',{defenderId:f.actors[2],amount:50}).status).toBe('rejected');expect(f.send(f.host,'deal:offer',{defenderId:f.actors[2],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.actors[1]!,'deal:reject',undefined,{dealOfferId:o.id}).status).toBe('ok');expect(f.send(f.host,'duel:invite',{defenderId:f.actors[2],amount:50}).status).toBe('ok');before=structuredClone(f.room());expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('releases declined and expired reservations without using the pair’s match allowance',()=>{
    const f=social(),declined=offer(f);expect(f.send(f.actors[1]!,'deal:reject',undefined,{dealOfferId:declined.id}).status).toBe('ok');expect(f.view().players[0]!.reserved).toBe(0);const expired=offer(f);f.advance(8000);expect(f.view().party!.social!.dealInvites.find(o=>o.id===expired.id)!.status).toBe('expired');expect(f.view().players[0]!.reserved).toBe(0);const accepted=offer(f);accept(f,accepted.id);assertRoom(f.room());
  });
  it('caps late offers at admission close and rejects an exact-deadline acceptance',()=>{
    const f=social(),admission=f.view().party!.social!.admissionDeadline;f.advance(19000);const o=offer(f);expect(o.deadline).toBe(admission);const late=f.command(f.actors[1]!,'deal:accept',undefined,{dealOfferId:o.id});f.advance(1000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});const closed=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,late).status).toBe('rejected');expect(f.room()).toEqual(closed);clean(f);
  });
  it('cancels pending invitations on departure without cancelling an accepted contract',()=>{
    const f=social(),o=offer(f);f.manager.presence(f.actors[1]!,false);expect(f.view().party!.social!.dealInvites.find(i=>i.id===o.id)!.status).toBe('cancelled');expect(f.view().players[0]!.reserved).toBe(0);f.manager.presence(f.actors[1]!,true);const accepted=offer(f);accept(f,accepted.id);f.manager.presence(f.actors[1]!,false);expect(f.view().phase).toBe('DEAL');expect(f.view().players[1]!.committed).toBe(100);assertRoom(f.room());
  });
});

describe('private locked decisions and the exact ten-second default',()=>{
  it('shares only lock status until simultaneous reveal, with refresh restoring only the owner’s private decision',()=>{
    const f=choosing(4);lock(f,0,'SPLIT');const owner=f.view().party!.social!.deal!;expect(owner).toMatchObject({ownChoice:'SPLIT',lockedPlayerIds:[f.host]});expect(owner).not.toHaveProperty('choices');
    for(const actor of f.actors.slice(1)){const snapshot=f.view(actor),d=snapshot.party!.social!.deal!;expect(d).not.toHaveProperty('ownChoice');expect(d).not.toHaveProperty('choices');expect(d.returns).toEqual({});expect(d.bonusEach).toBe(0);expect(d.vaultAmount).toBe(0);expect(JSON.stringify(snapshot)).not.toContain('"SPLIT"');expect(snapshot.party!.dealHistory).toEqual([]);}f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().party!.social!.deal!.ownChoice).toBe('SPLIT');expect(f.view(f.actors[1]).party!.social!.deal).not.toHaveProperty('ownChoice');lock(f,1,'STEAL');
    for(const actor of f.actors)expect(f.view(actor).party!.social!.deal!.choices).toEqual({[f.host]:'SPLIT',[f.actors[1]!]: 'STEAL'});expect(f.view().players.map(p=>p.balance)).toEqual([900,1100,1000,1000]);assertRoom(f.room());
  });
  it('rejects changed locked choices, spectator commands and invalid authority fields without leaking either choice',()=>{
    const f=choosing(),c=f.command(f.host,'deal:choose',{choice:'STEAL'}),ack=f.manager.command(f.host,c);expect(ack.status).toBe('ok');const after=structuredClone(f.room());expect(f.manager.command(f.host,c)).toEqual(ack);expect(f.manager.command(f.host,{...c,payload:{choice:'SPLIT'}}).code).toBe('REQUEST_CONFLICT');for(const [actor,payload] of [[f.host,{choice:'SPLIT'}],[f.actors[2],{choice:'SPLIT'}],[f.actors[1],{choice:'COOPERATE'}],[f.actors[1],{choice:'SPLIT',bonusEach:1000}]] as const){expect(f.send(actor!,'deal:choose',payload).status).toBe('rejected');expect(f.room()).toEqual(after);}
  });
  it.each<[number,DealChoice,number[],number]>([[0,'SPLIT',[900,1100,1000],0],[1,'SPLIT',[1100,900,1000],0],[0,'STEAL',[900,900,1000],200]])('defaults one missing decision to Steal with seat %i locked %s',(seat,choice,balances,vault)=>{
    const f=choosing();lock(f,seat,choice);const deadline=f.view().deadline;f.advance(9999);expect(f.view().phase).toBe('DEAL');expect(f.view().deadline).toBe(deadline);expect(f.view().party!.social!.deal).not.toHaveProperty('choices');f.advance(1);expect(f.view().phase).toBe('DEAL_RESULT');expect(f.view().players.map(p=>p.balance)).toEqual(balances);expect(f.view().party!.vault).toBe(vault);expect(f.view().party!.social!.deal!.defaultedPlayerIds).toEqual([f.actors[seat===0?1:0]]);expect(f.view().party!.social!.deal!.reason).toMatch(/defaulted to Steal/);assertRoom(f.room());
  });
  it('defaults both missing decisions at ten seconds and transfers the full pot once to the Vault',()=>{
    const f=choosing(),deadline=f.view().deadline;f.advance(9999);expect(f.view().phase).toBe('DEAL');f.advance(1);expect(f.view().party!.social!.deal).toMatchObject({choices:{[f.host]:'STEAL',[f.actors[1]!]: 'STEAL'},defaultedPlayerIds:f.actors.slice(0,2),vaultAmount:200});expect(f.view().party!.vault).toBe(200);const late=f.command(f.host,'deal:choose',{choice:'SPLIT'}),after=structuredClone(f.room());expect(f.manager.command(f.host,late).status).toBe('rejected');expect(f.room()).toEqual(after);expect(f.view().deadline).toBe(deadline!+2000);assertRoom(f.room());
  });
  it('accepts a final-millisecond decision and rejects a decision at the exact deadline',()=>{
    const f=choosing();f.advance(9999);lock(f,0,'SPLIT');const late=f.command(f.actors[1]!,'deal:choose',{choice:'SPLIT'});f.advance(1);const after=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,late).status).toBe('rejected');expect(f.room()).toEqual(after);expect(f.view().players.map(p=>p.balance)).toEqual([900,1100,1000]);expect(f.view().party!.bonusReserve).toBe(300);
  });
  it('settles early when both lock and preserves the immutable original choice deadline in history',()=>{
    const f=choosing(),started=f.view().serverTime,deadline=f.view().deadline;f.advance(1000);lock(f,0,'SPLIT');f.advance(500);lock(f,1,'SPLIT');expect(f.view()).toMatchObject({phase:'DEAL_RESULT',deadline:started+3500});expect(f.view().party!.dealHistory[0]!.deadline).toBe(deadline);expect(f.view().party!.social!.deal!.deadline).toBe(deadline);f.advance(2000);expect(f.view().phase).toBe('SOCIAL');expect(f.view().party!.social!.slot).toBe(2);expect(f.view().party!.dealHistory).toHaveLength(1);clean(f);
  });
});

describe('one accepted pair per match and scoped command replay',()=>{
  it('never funds a repeated or reversed accepted pair, but allows a new pair in the next slot',()=>{
    const f=choosing();lock(f,0,'SPLIT');lock(f,1,'SPLIT');f.advance(2000);const before=structuredClone(f.room());for(const [from,to] of [[0,1],[1,0]]){expect(f.send(f.actors[from!]!,'deal:offer',{defenderId:f.actors[to!],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);}const other=offer(f,0,2,50);accept(f,other.id,2);lock(f,0,'STEAL');lock(f,2,'SPLIT');expect(f.view().party!.dealHistory).toHaveLength(2);expect(f.view().party!.bonusReserve).toBe(280);assertRoom(f.room());
  });
  it('deduplicates offer, acceptance and settlement requests without another reservation, debit or bonus',()=>{
    const f=social(),o=f.command(f.host,'deal:offer',{defenderId:f.actors[1],amount:100}),offerAck=f.manager.command(f.host,o);expect(offerAck.status).toBe('ok');expect(f.manager.command(f.host,o)).toEqual(offerAck);const id=f.view().party!.social!.dealInvites[0]!.id,a=f.command(f.actors[1]!,'deal:accept',undefined,{dealOfferId:id}),acceptAck=f.manager.command(f.actors[1]!,a);expect(acceptAck.status).toBe('ok');lock(f,0,'SPLIT');const choose=f.command(f.actors[1]!,'deal:choose',{choice:'SPLIT'}),settledAck=f.manager.command(f.actors[1]!,choose);expect(settledAck.status).toBe('ok');const after=structuredClone(f.room());expect(f.manager.command(f.host,o)).toEqual(offerAck);expect(f.manager.command(f.actors[1]!,a)).toEqual(acceptAck);expect(f.manager.command(f.actors[1]!,choose)).toEqual(settledAck);expect(f.room()).toEqual(after);expect(f.view().party!.dealHistory).toHaveLength(1);expect(f.view().party!.transfers.filter(t=>t.kind==='deal_bonus')).toHaveLength(2);
  });
  it('rejects stale room, match, interval, offer and current contract contexts without consuming an action',()=>{
    const f=social(),o=offer(f);for(const key of ['roomInstanceId','matchId','roundId','socialId','socialSlotId','dealOfferId'] as const){const before=structuredClone(f.room());expect(f.send(f.actors[1]!,'deal:accept',undefined,{dealOfferId:o.id,[key]:'old-context'}).status).toBe('rejected');expect(f.room()).toEqual(before);}accept(f,o.id);const before=structuredClone(f.room());expect(f.send(f.host,'deal:choose',{choice:'SPLIT'},{dealId:'old-contract'}).status).toBe('rejected');expect(f.send(f.host,'deal:choose',{choice:'SPLIT'},{socialId:'old-social'}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('rejects delayed first-slot offers after a settled contract opens the second admission',()=>{
    const f=social(),old=f.command(f.actors[2]!,'deal:offer',{defenderId:f.host,amount:50}),o=offer(f);accept(f,o.id);lock(f,0,'SPLIT');lock(f,1,'SPLIT');f.advance(2000);const after=structuredClone(f.room());expect(f.manager.command(f.actors[2]!,old)).toMatchObject({status:'rejected',code:'STALE_SOCIAL_SLOT'});expect(f.room()).toEqual(after);
  });
});

describe('room-wide contract, duel, bounty and Last Stand admission',()=>{
  it('lets an accepted contract cancel a pending duel and prevents its late acceptance',()=>{
    const f=social(4);expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:250}).status).toBe('ok');const duel=f.view().party!.social!.invites[0]!,o=offer(f,2,3,100);accept(f,o.id,3);expect(f.view().party!.social!.invites[0]!.status).toBe('cancelled');expect(f.view().players[0]!.reserved).toBe(0);const after=structuredClone(f.room());expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:duel.id}).status).toBe('rejected');expect(f.send(f.host,'turn:hit').status).toBe('rejected');expect(f.room()).toEqual(after);assertRoom(f.room());
  });
  it('lets an accepted duel cancel a pending contract and prevents a second room event',()=>{
    const f=social(4),o=offer(f,2,3,250);expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:50}).status).toBe('ok');const i=f.view().party!.social!.invites[0]!;expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:i.id}).status).toBe('ok');expect(f.view().party!.social!.dealInvites.find(i=>i.id===o.id)!.status).toBe('cancelled');expect(f.view().players[2]!.reserved).toBe(0);const after=structuredClone(f.room());expect(f.send(f.actors[3]!,'deal:accept',undefined,{dealOfferId:o.id}).status).toBe('rejected');expect(f.room()).toEqual(after);assertRoom(f.room());
  });
  it('cancels an incompatible bounty invitation while preserving its committed contribution escrow',()=>{
    const f=social(4);expect(f.send(f.actors[3]!,'bounty:contribute',{targetId:f.actors[1],amount:100}).status).toBe('ok');const b=f.view().party!.bounties[0]!;expect(f.send(f.host,'bounty:invite',{bountyId:b.id}).status).toBe('ok');const invitation=f.view().party!.social!.invites[0]!,o=offer(f,2,3,50);accept(f,o.id,3);expect(f.view().party!.social!.invites[0]!.status).toBe('cancelled');expect(f.view().party!.bounties[0]).toMatchObject({status:'active',total:100,defendedIntervalIds:[]});expect(f.view().players[3]!.committed).toBe(150);const after=structuredClone(f.room());expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:invitation.id}).status).toBe('rejected');expect(f.room()).toEqual(after);assertRoom(f.room());
  });
  it('cancels an open overthrow ballot when a contract is first accepted',()=>{
    const f=social(4,6,true);expect(f.send(f.actors[1]!,'house:ballot').status).toBe('ok');expect(f.send(f.actors[1]!,'house:vote',{yes:true}).status).toBe('ok');const o=offer(f,2,3,50);accept(f,o.id,3);expect(f.view().party!.social!.ballot!.status).toBe('failed');const after=structuredClone(f.room());expect(f.send(f.actors[2]!,'house:vote',{yes:true}).status).toBe('rejected');expect(f.room()).toEqual(after);expect(f.view().party!.social!.duel).toBeNull();assertRoom(f.room());
  });
  it('releases contract reservations when a threshold-reaching ballot reserves Last Stand selection',()=>{
    const f=social(4,6,true),o=offer(f,2,3,100);expect(f.send(f.actors[1]!,'house:ballot').status).toBe('ok');const b=f.view().party!.social!.ballot!;for(const actor of b.eligibleVoterIds)expect(f.send(actor,'house:vote',{yes:true}).status).toBe('ok');expect(f.view().phase).toBe('LAST_STAND_CHOICE');expect(f.view().party!.social!.dealInvites.find(i=>i.id===o.id)!.status).toBe('cancelled');expect(f.view().players[2]!.reserved).toBe(0);const before=structuredClone(f.room());expect(f.send(f.actors[3]!,'deal:accept',undefined,{dealOfferId:o.id}).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('uses the same bounded two sequential slots across a contract and a duel, then resumes Blackjack',()=>{
    const f=choosing(),social=f.view().party!.social!;lock(f,0,'SPLIT');lock(f,1,'SPLIT');f.advance(2000);expect(f.view().party!.social).toMatchObject({slot:2,id:social.id,openedAt:social.openedAt,hardDeadline:social.hardDeadline});expect(f.view().party!.social!.deal).toBeNull();expect(f.send(f.actors[2]!,'duel:invite',{defenderId:f.host,amount:50}).status).toBe('ok');const i=f.view().party!.social!.invites.at(-1)!;expect(f.send(f.host,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:i.id}).status).toBe('ok');f.advance(2000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.view().party!.dealHistory).toHaveLength(1);expect(f.view().party!.duelHistory).toHaveLength(1);clean(f);
  });
});

describe('accepted obligations survive disconnect, ending and replay',()=>{
  it('retains an offline participant’s private locked choice and lets the shared timer resolve the other choice',()=>{
    const f=choosing(),deadline=f.view().deadline;lock(f,0,'SPLIT');f.manager.presence(f.host,false);f.advance(5000);f.manager.presence(f.host,true);expect(f.view().party!.social!.deal!.ownChoice).toBe('SPLIT');expect(f.view().deadline).toBe(deadline);f.manager.presence(f.actors[1]!,false);f.advance(5000);expect(f.view().players.map(p=>p.balance)).toEqual([900,1100,1000]);expect(f.view().party!.dealHistory[0]!.defaultedPlayerIds).toEqual([f.actors[1]]);assertRoom(f.room());
  });
  it('keeps an explicit departing player’s committed stake and settles its missing choice before rankings',()=>{
    const f=choosing();lock(f,0,'SPLIT');expect(f.send(f.actors[1]!,'room:leave').status).toBe('ok');expect(f.view().players[1]!.committed).toBe(100);f.advance(10000);expect(f.view().players[1]!.balance).toBe(1100);expect(f.view().party!.dealHistory[0]!.choices).toEqual({[f.host]:'SPLIT',[f.actors[1]!]: 'STEAL'});finish(f);expect(f.view().results!.standings.find(p=>p.id===f.actors[1])!.balance).toBe(1100);clean(f);
  });
  it('drains an accepted contract through low-player recovery without refunding a losing contribution',()=>{
    const f=choosing(2,3);lock(f,0,'SPLIT');f.manager.presence(f.actors[1]!,false);f.advance(60000);expect(f.view().phase).toBe('RESULTS');expect(f.view().results!.standings.map(p=>p.balance)).toEqual([1100,900]);expect(f.view().party!.dealHistory).toHaveLength(1);expect(f.view().party!.dealHistory[0]!.defaultedPlayerIds).toEqual([f.actors[1]]);clean(f);
  });
  it('settles both departed choices to Steal and distributes its funded Vault only after the accepted contract closes',()=>{
    const f=choosing(3,3);f.manager.presence(f.host,false);expect(f.send(f.actors[1]!,'room:leave').status).toBe('ok');f.advance(60000);const room=f.manager.rooms.get(f.room().instanceId)!;expect(room.phase).toBe('RESULTS');expect(room.party!.dealHistory[0]!.vaultAmount).toBe(200);expect(room.party!.dealHistory[0]!.defaultedPlayerIds).toEqual(f.actors.slice(0,2));expect(room.party!.vault).toBe(0);expect(room.players.map(p=>p.account.balance)).toEqual([967,967,1066]);assertRoom(room);
  });
  it('ranks cooperation bonuses and resets history, pair caps and reserve in a same-room replay',()=>{
    const f=choosing(3,3);lock(f,0,'SPLIT');lock(f,1,'SPLIT');finish(f);expect(f.view().results!.standings.map(p=>p.balance)).toEqual([1010,1010,1000]);expect(f.view().party!.bonusReserve).toBe(280);expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.view().party!.dealHistory).toEqual([]);expect(f.view().party!.bonusReserve).toBe(300);f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);const again=offer(f);accept(f,again.id);lock(f,0,'SPLIT');lock(f,1,'SPLIT');expect(f.view().players.map(p=>p.balance)).toEqual([1010,1010,1000]);clean(f);
  });
});
