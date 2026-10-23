import {describe,expect,it} from 'vitest';
import {RULES} from '@bluff-house/shared';
import {fixture} from '../fixtures/core.js';

function offered(elapsed=0,hit:'3'|'K'|'9'='3'){
  const f=fixture({ranks:['6','9','10','6','8','7',hit]});f.start();f.bet();f.deal();f.advance(elapsed);
  expect(f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:100}).status).toBe('ok');return f;
}

describe('bluff deadlines and binding transitions',()=>{
  it('accepts one millisecond before the authoritative deadline',()=>{
    const f=offered();f.advance(RULES.offerMs-1);expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('ok');expect(f.view().phase).toBe('BLUFF_REVEAL');
  });
  it.each([RULES.offerMs,RULES.offerMs+1])('rejects calls at or after the deadline (%s ms)',elapsed=>{
    const f=offered(),accept=f.command(f.actors[1]!,'bluff:accept'),cursor=f.room().cursor;f.advance(elapsed);
    expect(f.manager.command(f.actors[1]!,accept).code).toBe('OFFER_CLOSED');expect(f.room().cursor).toBe(cursor);
    expect(f.view().bluff?.status).toBe('expired');expect(f.view().players[0]).toMatchObject({balance:900,reserved:0,bluffWins:0,bluffLosses:0});expect(f.room().bluffOutcomes).toEqual([]);
  });
  it.each([[0,20000],[11000,9000],[19000,5000]])('resumes a turn paused after %s ms with %s ms', (elapsed,remaining)=>{
    const f=offered(elapsed),oldDecision=f.room().decisionId;f.advance(RULES.offerMs);
    expect(f.view().deadline!-f.view().serverTime).toBe(remaining);expect(f.view().decisionId).toBeTruthy();expect(f.view().decisionId).not.toBe(oldDecision);
    const after=structuredClone(f.room());f.manager.reconcile();f.manager.reconcile();expect(f.room()).toEqual(after);
    f.advance(remaining-1);expect(f.view().activePlayerId).toBe(f.host);f.advance(1);expect(f.view().activePlayerId).toBe(f.actors[1]);
  });
  it('uses logical deadlines when a delayed sweep spans expiry and resumed timeout',()=>{
    const f=offered(19000),cursor=f.room().cursor;f.advance(RULES.offerMs+5000);
    expect(f.view().activePlayerId).toBe(f.actors[1]);expect(f.room().cursor).toBe(cursor);expect(f.view().deadline!-f.view().serverTime).toBe(RULES.decisionMs);
  });
  it('locks all Blackjack controls during offer and reveal then grants a fresh twenty seconds after a safe draw',()=>{
    const f=offered(19000),stale=f.command(f.host,'turn:hit');expect(f.manager.command(f.host,stale).code).toBe('PHASE_LOCKED');
    expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('ok');const settled=structuredClone(f.room());
    for(const type of ['turn:hit','turn:stand','bluff:offer'] as const)expect(f.send(f.host,type,type==='bluff:offer'?{claimType:'NEXT_HIT_SAFE',amount:100}:undefined).code).toBe('PHASE_LOCKED');
    expect(f.room()).toEqual(settled);f.advance(RULES.revealMs-1);expect(f.view().phase).toBe('BLUFF_REVEAL');f.advance(1);
    expect(f.view().activePlayerId).toBe(f.host);expect(f.view().deadline!-f.view().serverTime).toBe(RULES.decisionMs);
    const after=structuredClone(f.room());f.manager.reconcile();expect(f.room()).toEqual(after);
  });
  it.each(['K','9'] as const)('advances automatically after revealed draw %s busts or reaches 21',hit=>{
    const f=offered(0,hit);f.send(f.actors[1]!,'bluff:accept');f.advance(RULES.revealMs);
    expect(f.view().activePlayerId).toBe(f.actors[1]);expect(f.view().players[0]!.status).toBe(hit==='K'?'bust':'stood');
  });
  it('cancels an open claimant offer on disconnect, releases its reserve and consumes the hand allowance',()=>{
    const f=offered(),cursor=f.room().cursor;f.manager.presence(f.host,false);
    expect(f.view().bluff?.status).toBe('cancelled');expect(f.view().players[0]).toMatchObject({reserved:0,balance:900,bluffUsed:true});expect(f.room().cursor).toBe(cursor);
    f.manager.presence(f.host,true);expect(f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:100}).code).toBe('OFFER_ALREADY_USED');
  });
  it('keeps an accepted pot and draw binding across both participants disconnecting',()=>{
    const f=offered();f.send(f.actors[1]!,'bluff:accept');const outcome=structuredClone(f.view().bluff),balances=f.view().players.map(p=>p.balance),cursor=f.room().cursor;
    for(const actor of f.actors)f.manager.presence(actor,false);
    expect(f.view().phase).toBe('BLUFF_REVEAL');expect(f.view().players.map(p=>p.balance)).toEqual(balances);
    f.advance(RULES.revealMs);expect(f.room().cursor).toBe(cursor);expect(f.view().bluff).toEqual(outcome);expect(f.room().bluffOutcomes).toHaveLength(1);
  });
});
