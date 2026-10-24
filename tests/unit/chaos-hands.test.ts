import {describe,expect,it} from 'vitest';
import {RULES,type Rank} from '@bluff-house/shared';
import {eligibleHands,handCardReason,openHandWindow,applyHandCard,markOrdinaryHit,clearOrdinaryHit} from '../../apps/server/src/game/chaos-hands.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {evaluate} from '../../apps/server/src/game/cards.js';
import {fixture} from '../fixtures/core.js';

function initialRanks(players:number):Rank[]{
  return [...Array.from({length:players},(_,i)=>String(i+2) as Rank),'10',...Array.from({length:players},(_,i)=>String(i+5) as Rank),'7','2','3','4'];
}
function window(players=3,ranks=initialRanks(players)){
  const f=fixture({mode:'PARTY',players,ranks});f.start();f.advance(22000);
  for(const [i,actor] of f.actors.entries())expect(f.send(actor,'bet:submit',{amount:50+(i%5)*50}).status).toBe('ok');
  f.advance(RULES.bettingMs+RULES.dealingMs);expect(f.room().phase).toBe('HAND_CHAOS');return f;
}
function hitReady(ranks:Rank[]=['6','9','10','6','8','7','3','2']){
  const f=fixture({mode:'PARTY',ranks});f.start();f.advance(22000);f.bet();f.deal();
  expect(f.send(f.host,'turn:hit').status).toBe('ok');return f;
}
const handIds=(f:ReturnType<typeof fixture>)=>f.room().players.map(p=>p.hand.map(c=>c.id));

describe('pre-turn movement eligibility and card conservation',()=>{
  it.each([2,3,4,5,6])('rotates %i eligible hands one seat left without moving chips or seats',players=>{
    const f=window(players),r=f.room(),before=handIds(f),fixed=r.players.map(p=>({id:p.id,seat:p.seat,wager:p.wager,wagerId:p.wagerId,account:structuredClone(p.account),bluffUsed:p.bluffUsed})),dealer=structuredClone(r.dealer),cursor=r.cursor;
    applyHandCard(r,r.players[0]!,'TABLE_TURN',f.command(f.host,'chaos:activate',{cardId:'unit-table-turn'}),f.manager.e,f.view().serverTime);
    expect(handIds(f)).toEqual([...before.slice(1),before[0]]);
    expect(r.players.map(p=>({id:p.id,seat:p.seat,wager:p.wager,wagerId:p.wagerId,account:p.account,bluffUsed:p.bluffUsed}))).toEqual(fixed);
    expect(r.dealer).toEqual(dealer);expect(r.cursor).toBe(cursor);expect(r.discarded).toEqual([]);expect(r.party!.chaos.handWindow!.resolved).toBe(true);assertRoom(r);
  });
  it.each([2,3,4,5,6])('swaps exactly the owner and chosen target at %i seats',players=>{
    const f=window(players),r=f.room(),before=handIds(f),target=players-1;
    applyHandCard(r,r.players[0]!,'HAND_SWAP',f.command(f.host,'chaos:activate',{cardId:'unit-hand-swap',targetId:f.actors[target]}),f.manager.e,f.view().serverTime);
    [before[0],before[target]]=[before[target]!,before[0]!];expect(handIds(f)).toEqual(before);expect(r.party!.chaos.usedRound).toEqual({});assertRoom(r);
  });
  it('sorts eligible seats and omits natural, absent, departed, unfunded, acted and nonparticipant hands',()=>{
    const f=window(6),r=f.room(),p=r.players;
    p.reverse();expect(eligibleHands(r).map(p=>p.seat)).toEqual([0,1,2,3,4,5]);p.reverse();
    p[1]!.connected=false;p[2]!.departed=true;p[3]!.participating=false;p[4]!.status='stood';p[5]!.hand[0]!.rank='A';p[5]!.hand[1]!.rank='K';
    expect(eligibleHands(r).map(p=>p.id)).toEqual([f.host]);expect(handCardReason(r,p[0]!,'TABLE_TURN')).toContain('two eligible');
    p[1]!.connected=true;delete p[1]!.account.escrows[p[1]!.wagerId!];expect(eligibleHands(r).map(p=>p.id)).toEqual([f.host]);
  });
  it('requires an eligible owner even when other players remain eligible',()=>{
    const f=window(4),r=f.room();r.players[0]!.status='natural';expect(handCardReason(r,r.players[0]!,'HAND_SWAP')).toContain('funded');
    expect(handCardReason(r,r.players[1]!,'HAND_SWAP')).toBeNull();r.party!.chaos.handWindow!.resolved=true;expect(handCardReason(r,r.players[1]!,'TABLE_TURN')).toContain('already resolved');
  });
  it('does not open a movement window for Classic, dealer natural, termination, or fewer than two eligible hands',()=>{
    const classic=fixture();classic.start();classic.bet();classic.deal();expect(openHandWindow(classic.room(),classic.manager.e,1000)).toBe(false);
    for(const cause of ['dealer-natural','terminating','one-hand'] as const){const f=window(),r=f.room();r.party!.chaos.handWindow=null;r.phase='DEALING';
      if(cause==='dealer-natural'){r.dealer[0]!.rank='A';r.dealer[1]!.rank='K';}else if(cause==='terminating')r.terminationConfirmed=true;else r.players.slice(1).forEach(p=>{p.connected=false;});
      expect(openHandWindow(r,f.manager.e,1000)).toBe(false);expect(r.party!.chaos.handWindow).toBeNull();expect(r.phase).toBe('DEALING');
    }
  });
  it('rejects self, missing and excluded swap targets without changing any card',()=>{
    const f=window(),r=f.room();r.players[2]!.connected=false;
    for(const targetId of [f.host,undefined,'invented-player',f.actors[2]]){const before=structuredClone(r);expect(()=>applyHandCard(r,r.players[0]!,'HAND_SWAP',f.command(f.host,'chaos:activate',{cardId:'unit-swap',targetId}),f.manager.e,f.view().serverTime)).toThrow('Choose a different');expect(r).toEqual(before);}
  });
});

describe('ordinary-hit marker and protected redraw',()=>{
  it('records the live hit card with its resulting decision and clears it explicitly',()=>{
    const f=hitReady(),r=f.room(),p=r.players[0]!,marker=r.party!.chaos.ordinaryHits[p.id];
    expect(marker).toEqual({cardId:p.hand.at(-1)!.id,decisionId:r.decisionId});expect(handCardReason(r,p,'SECOND_CHANCE')).toBeNull();
    clearOrdinaryHit(r,p.id);expect(r.party!.chaos.ordinaryHits[p.id]).toBeUndefined();expect(handCardReason(r,p,'SECOND_CHANCE')).toContain('ordinary Hit');
    markOrdinaryHit(r,p);expect(r.party!.chaos.ordinaryHits[p.id]).toEqual(marker);
  });
  it('replaces only the latest hit using the next shoe card and preserves the consumed discard',()=>{
    const f=hitReady(),r=f.room(),p=r.players[0]!,old=structuredClone(p.hand),replacement=r.shoe[r.cursor]!,cursor=r.cursor,decision=r.decisionId,account=structuredClone(p.account);
    f.advance(6000);const now=f.view().serverTime;
    applyHandCard(r,p,'SECOND_CHANCE',f.command(f.host,'chaos:activate',{cardId:'unit-redraw'}),f.manager.e,now);
    expect(p.hand).toEqual([...old.slice(0,-1),replacement]);expect(r.discarded).toEqual([old.at(-1)]);expect(r.cursor).toBe(cursor+1);expect(p.account).toEqual(account);expect(r.decisionId).not.toBe(decision);expect(r.deadline).toBe(now+RULES.decisionMs);expect(r.party!.chaos.ordinaryHits[p.id]).toBeUndefined();expect(evaluate(p.hand).total).toBe(14);assertRoom(r);
  });
  it.each(['wrong-card','old-decision','accepted-card','not-active','not-playing','offer','reveal','result'] as const)('protects a %s context',cause=>{
    const f=hitReady(),r=f.room(),p=r.players[0]!,marker=r.party!.chaos.ordinaryHits[p.id]!;
    if(cause==='wrong-card')marker.cardId='other-card';else if(cause==='old-decision')marker.decisionId='old-decision';else if(cause==='accepted-card')r.bluff={id:'protected-offer',claimantId:p.id,amount:50,deadline:100,status:'accepted',card:p.hand.at(-1)};else if(cause==='not-active')r.activePlayerId=f.actors[1];else if(cause==='not-playing')p.status='stood';else r.phase=cause==='offer'?'BLUFF_OFFER':cause==='reveal'?'BLUFF_REVEAL':'ROUND_RESULT';
    expect(handCardReason(r,p,'SECOND_CHANCE')).not.toBeNull();const before=structuredClone(r);expect(()=>applyHandCard(r,p,'SECOND_CHANCE',f.command(f.host,'chaos:activate',{cardId:'protected-redraw'}),f.manager.e,f.view().serverTime)).toThrow();expect(r).toEqual(before);
  });
  it.each<Rank>(['9','K'])('never leaves an ordinary-hit redraw marker when %s produces 21 or bust',hit=>{
    const f=hitReady(['6','9','10','6','8','7',hit]),r=f.room(),p=r.players[0]!;expect(evaluate(p.hand).total).toBeGreaterThanOrEqual(21);expect(r.party!.chaos.ordinaryHits[p.id]).toBeUndefined();expect(handCardReason(r,p,'SECOND_CHANCE')).not.toBeNull();
  });
  it('detects a duplicate discard and a missing consumed card in the full card invariant',()=>{
    const f=hitReady(),r=f.room();r.discarded.push(r.players[0]!.hand[0]!);expect(()=>assertRoom(r)).toThrow();r.discarded=[];r.cursor++;expect(()=>assertRoom(r)).toThrow();
  });
});
