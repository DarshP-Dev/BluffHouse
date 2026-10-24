import {describe,expect,it} from 'vitest';
import {RULES,type BountyView} from '@bluff-house/shared';
import {remainingBountyIntervals,projectBounties,assertBounties,refundBounties,settleBountyDefense} from '../../apps/server/src/game/bounties.js';
import {socialDeadline,duelCommand} from '../../apps/server/src/game/duels.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import type {DuelState} from '../../apps/server/src/game/state.js';
import {fixture} from '../fixtures/core.js';

function prepared(total=150){
  const f=fixture({mode:'PARTY',rounds:6,players:3});f.start();f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);
  for(let remaining=total;remaining>0;remaining-=Math.min(250,remaining))expect(f.send(f.host,'bounty:contribute',{targetId:f.actors[1],amount:Math.min(250,remaining)}).status).toBe('ok');
  return f;
}
function duel(f:ReturnType<typeof fixture>,bounty:BountyView):DuelState{
  expect(f.send(f.actors[2]!,'bounty:invite',{bountyId:bounty.id}).status).toBe('ok');const invite=f.view().party!.social!.invites.at(-1)!;expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:invite.id}).status).toBe('ok');return f.room().party!.social!.duel!;
}
function nextSocial(f:ReturnType<typeof fixture>){f.advance(2000);f.advance(20000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('SOCIAL');}

describe('bounty opportunities, funding and copied public records',()=>{
  it('counts only non-final social intervals and clamps the final round to zero',()=>{
    const f=fixture({mode:'PARTY',rounds:6});for(const [round,expected] of [[0,5],[1,5],[3,3],[4,2],[5,1],[6,0],[7,0]]){f.room().round=round!;expect(remainingBountyIntervals(f.room())).toBe(expected);}f.room().roundLimit=3;f.room().round=1;expect(remainingBountyIntervals(f.room())).toBe(2);f.room().phase='RESULTS';expect(remainingBountyIntervals(f.room())).toBe(0);
  });
  it('projects independent contribution and defense arrays without exposing account internals',()=>{
    const f=prepared(),actual=structuredClone(f.room().party!.bounties),view=projectBounties(f.room());expect(view).toEqual(actual);view[0]!.contributions[0]!.amount=999;view[0]!.defendedIntervalIds.push('changed');view[0]!.total=999;expect(f.room().party!.bounties).toEqual(actual);expect(view[0]).not.toHaveProperty('account');
  });
  it.each(['total','cap','contribution','self','escrow','reservation','duplicate-id','duplicate-target','duplicate-interval','streak'] as const)('detects %s corruption beyond global money conservation',kind=>{
    const f=prepared(),r=f.room(),b=r.party!.bounties[0]!,c=b.contributions[0]!,a=r.players[0]!.account;
    if(kind==='total')b.total++;else if(kind==='cap')b.total=1050;else if(kind==='contribution')c.amount=51;else if(kind==='self')c.playerId=b.targetId;else if(kind==='escrow')delete a.escrows[c.id];else if(kind==='reservation')a.reservations[c.id]=c.amount;else if(kind==='duplicate-id')c.id=b.id;else if(kind==='duplicate-target')r.party!.bounties.push({...structuredClone(b),id:'other-bounty'});else if(kind==='duplicate-interval')b.defendedIntervalIds=['interval','interval'];else b.streak=3;
    expect(()=>assertBounties(r)).toThrow();
  });
  it('refunds every original contribution exactly once without changing the finite bonus reserve',()=>{
    const f=prepared(400),r=f.room(),reserve=r.party!.bonusReserve;refundBounties(r,f.manager.e,f.view().serverTime);expect(r.players[0]!.account.balance).toBe(1000);expect(r.party!.bounties[0]!.status).toBe('refunded');expect(r.party!.bonusReserve).toBe(reserve);expect(r.party!.transfers.filter(t=>t.kind==='bounty_refund').map(t=>t.amount)).toEqual([250,150]);assertRoom(r);const after=structuredClone(r);refundBounties(r,f.manager.e,f.view().serverTime);expect(r).toEqual(after);
  });
  it('refuses to refund a currently accepted bounty defense',()=>{
    const f=prepared(),b=f.room().party!.bounties[0]!;expect(f.send(f.actors[2]!,'bounty:invite',{bountyId:b.id}).status).toBe('ok');const invite=f.view().party!.social!.invites.at(-1)!;expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:invite.id}).status).toBe('ok');const before=structuredClone(f.room());expect(()=>refundBounties(f.room(),f.manager.e,f.view().serverTime)).toThrow('LIVE_BOUNTY_OBLIGATION');expect(f.room()).toEqual(before);
  });
});

describe('separate bounty awards conserve all escrowed chips',()=>{
  it.each(Array.from({length:20},(_,i)=>(i+1)*50))('allocates a %i-chip target defeat by exact integer 85/15 funding',total=>{
    const f=prepared(total),award=Math.floor(total*85/100);duel(f,f.room().party!.bounties[0]!);expect(f.send(f.actors[1]!,'duel:resign').status).toBe('ok');const r=f.room(),b=r.party!.bounties[0]!;
    expect(b).toMatchObject({status:'defeated',streak:0,winnerId:f.actors[2]});expect(r.players.map(p=>p.account.balance)).toEqual([1000-total,950,1050+award]);expect(r.party!.vault).toBe(total-award);expect(r.party!.bonusReserve).toBe(300);expect(r.dealerNet).toBe(0);expect(r.players[0]!.account.escrows).toEqual({});assertRoom(r);
  });
  it('pays the complete third-defense bounty to its target exactly once',()=>{
    const f=prepared(550);for(let n=0;n<3;n++){if(n)nextSocial(f);duel(f,f.room().party!.bounties[0]!);expect(f.send(f.actors[2]!,'duel:resign').status).toBe('ok');}const r=f.room(),b=r.party!.bounties[0]!,d=r.party!.social!.duel!;expect(b).toMatchObject({status:'claimed',streak:3,winnerId:b.targetId});expect(r.players.map(p=>p.account.balance)).toEqual([450,1700,850]);expect(r.party!.vault).toBe(0);assertRoom(r);const after=structuredClone(r);settleBountyDefense(r,d,f.manager.e,f.view().serverTime,b.targetId);expect(r).toEqual(after);
  });
  it('increments only target wins; draws leave the funded principal and existing streak intact',()=>{
    const f=prepared();duel(f,f.room().party!.bounties[0]!);expect(f.send(f.actors[2]!,'duel:resign').status).toBe('ok');const balances=f.room().players.map(p=>p.account.balance);nextSocial(f);duel(f,f.room().party!.bounties[0]!);for(let n=0;n<5;n++)for(const actor of f.actors.slice(1))expect(f.send(actor,'duel:choose',{choice:'PAPER'}).status).toBe('ok');const r=f.room(),b=r.party!.bounties[0]!;expect(b.streak).toBe(1);expect(b.status).toBe('active');expect(r.players.map(p=>p.account.balance)).toEqual(balances);assertRoom(r);
  });
  it('rejects a winner outside the accepted pair before debiting contribution escrow',()=>{
    const f=prepared(),d=duel(f,f.room().party!.bounties[0]!),r=f.room(),before=structuredClone(r);expect(()=>settleBountyDefense(r,d,f.manager.e,f.view().serverTime,f.host)).toThrow('INVALID_BOUNTY_WINNER');expect(r).toEqual(before);
  });
});

describe('second social admission requires its full immutable worst-case budget',()=>{
  it.each([[90000,true],[89999,false]] as const)('requires a full ninety seconds with %i milliseconds remaining',(remaining,opens)=>{
    const f=prepared(),r=f.room();expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:50}).status).toBe('ok');const invite=f.view().party!.social!.invites.at(-1)!;expect(f.send(f.actors[1]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:invite.id}).status).toBe('ok');
    const candidate=structuredClone(f.room()),social=candidate.party!.social!,hard=social.hardDeadline,opened=social.openedAt,id=social.id,at=hard-remaining;
    expect(socialDeadline(candidate,f.manager.e,at)).toBe(!opens);
    if(opens){expect(candidate.phase).toBe('SOCIAL');expect(candidate.party!.social).toMatchObject({slot:2,slotOpenedAt:at,openedAt:opened,hardDeadline:hard,id});expect(candidate.party!.social!.admissionDeadline).toBe(at+20000);}else expect(candidate.party!.social).toBeNull();
    expect(r.phase).toBe('SOCIAL');
  });
  it('rejects acceptance when the full sixty-second play and two-second summary cannot fit',()=>{
    const f=prepared();expect(f.send(f.actors[2]!,'duel:invite',{defenderId:f.actors[1],amount:50}).status).toBe('ok');const command=f.command(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:f.view().party!.social!.invites.at(-1)!.id}),candidate=structuredClone(f.room()),s=candidate.party!.social!,at=s.hardDeadline-61999;
    // Exercise the admission boundary independently of the scheduler: an existing
    // invitation must never authorize a start that exceeds its immutable budget.
    s.admissionDeadline=at+1000;s.invites.at(-1)!.deadline=at+1000;const before=structuredClone(candidate);
    expect(()=>duelCommand(candidate,candidate.players[1]!,command,f.manager.e,at)).toThrow('INSUFFICIENT_SOCIAL_TIME');expect(candidate).toEqual(before);
  });
});
