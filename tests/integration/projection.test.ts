import {describe,expect,it} from 'vitest';
import {project} from '../../apps/server/src/projection.js';
import {evaluate} from '../../apps/server/src/game/cards.js';
import {fundedFinale,declareShadow,standRemaining,finishFinale} from '../fixtures/shadow.js';

function hidden(f:ReturnType<typeof fundedFinale>,viewer:string,seat:number){const actual=f.room().party!.shadow!.entries[seat]!,v=project(f.room(),viewer,'test-server',f.view().serverTime),e=v.party!.shadow!.entrants.find(e=>e.playerId===actual.playerId)!;expect(e.hand).toEqual([actual.hand[0],...actual.hand.slice(1).map(()=>null)]);expect(e.value).toBeNull();expect(e.acceptedBluff).toBeNull();for(const card of actual.hand.slice(1))expect(JSON.stringify(v)).not.toContain(card.id);for(const key of ['actualTotal','bust','natural','truthful','truth'])expect(e).not.toHaveProperty(key);expect(v.players[seat]!.value).toBeNull();expect(v.players[seat]!.hand).toEqual([]);return {v,e};}

describe('Shadow first-card publicity and complete concealed-card privacy',()=>{
  it('shows each upcard to everyone while hiding subsequent rank/suit/IDs and values across every snapshot alias',()=>{
    const f=fundedFinale();for(const viewer of [...f.actors,'watcher']){const v=project(f.room(),viewer,'test-server',f.view().serverTime),s=v.party!.shadow!;expect(s).not.toHaveProperty('shoe');expect(s).not.toHaveProperty('cursor');expect(s.decisionId).toEqual(viewer===f.host?expect.any(String):null);for(const [seat,actual]of f.room().party!.shadow!.entries.entries()){if(actual.playerId===viewer){expect(s.entrants[seat]!.hand).toEqual(actual.hand);expect(s.entrants[seat]!.value).toEqual(evaluate(actual.hand));}else hidden(f,viewer,seat);}expect(s.winnerIds).toEqual([]);expect(s.vaultThiefIds).toEqual([]);expect(v.dealer).toEqual([]);expect(v.dealerValue).toBeNull();}
  });
  it.each([{ranks:['A','9','10','K','8','8'] as const},{ranks:['10','9','10','9','8','8','10'] as const}])('never leaks a natural or hidden bust through status, action flags, events or balances (%j)',({ranks})=>{
    const f=fundedFinale({ranks:[...ranks]});if(ranks[0]==='10')expect(f.send(f.host,'shadow:draw').status).toBe('ok');for(const viewer of f.actors.slice(1)){const {v,e}=hidden(f,viewer,0);expect(e).toMatchObject({revealed:false,locked:false,effectiveTotal:null,disqualifiedReason:null});expect(v.players[0]!.status).toBe('shadow');expect(v.party!.shadow!.actions).toMatchObject({canHit:false,canClaim21:false,canDrawClaim21:false});expect(v.events.slice(-2).map(e=>e.text).join(' ')).not.toMatch(/bust|natural|29|blackjack paid/i);}
  });
  it('keeps all hit cards private and publishes accepted21 rather than the actual busted total until showdown',()=>{
    const f=fundedFinale();expect(f.send(f.host,'shadow:drawclaim').status).toBe('ok');f.advance(8000);for(const viewer of f.actors.slice(1)){const {e,v}=hidden(f,viewer,0);expect(e).toMatchObject({effectiveTotal:21,acceptedBluff:null});expect(v.party!.shadow!.claims[0]).toMatchObject({declaredTotal:21,status:'unchallenged'});expect(v.party!.shadow!.claims[0]).not.toHaveProperty('truthful');}standRemaining(f);finishFinale(f);for(const viewer of f.actors){const e=f.view(viewer).party!.shadow!.entrants[0]!;expect(e.value).toMatchObject({total:29,bust:true});expect(e).toMatchObject({effectiveTotal:21,acceptedBluff:true});for(const removed of ['score','claimBonus','challengePoints','baseTotal'])expect(e).not.toHaveProperty(removed);}
  });
  it('reveals truthful stands and called claims completely, while unrelated hands retain only their upcards',()=>{
    const f=fundedFinale({ranks:['A','10','10','K','7','8']});declareShadow(f,0);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');for(const viewer of f.actors){const s=f.view(viewer).party!.shadow!;expect(s.entrants[0]!.hand.every(Boolean)).toBe(true);expect(s.entrants[1]!.hand.every(Boolean)).toBe(true);if(viewer!==f.actors[2])hidden(f,viewer,2);}expect(f.send(f.actors[1]!,'shadow:stand').status).toBe('ok');for(const viewer of f.actors.slice(0,2))hidden(f,viewer,2);
  });
  it('gives only the House owner the full real dealer hand until legal reveal',()=>{
    const f=fundedFinale(),actual=f.room().party!.shadow!.dealer;for(const viewer of f.actors){const d=f.view(viewer).party!.shadow!.dealer;if(viewer===actual.playerId){expect(d.hand).toEqual(actual.hand);expect(d.value).toEqual(evaluate(actual.hand));}else{expect(d.hand).toEqual([actual.hand[0],null]);expect(d.value).toBeNull();expect(JSON.stringify(f.view(viewer))).not.toContain(actual.hand[1]!.id);}}
  });
  it('returns copied entrant/dealer cards, values, claims, awards and rewards, never mutable server objects',()=>{
    const f=fundedFinale(),before=structuredClone(f.room().party!.shadow!),v=f.view().party!.shadow!;v.entrants[0]!.hand[0]!.rank='A';v.entrants[0]!.value!.total=0;v.entrantIds.push('tamper');v.awards.push({playerId:f.host,amount:999});v.dealer.hand[0]!.rank='2';expect(f.room().party!.shadow).toEqual(before);declareShadow(f,0);const claimed=structuredClone(f.room().party!.shadow!);f.view().party!.shadow!.claims[0]!.status='caught';expect(f.room().party!.shadow).toEqual(claimed);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');const called=structuredClone(f.room().party!.shadow!);f.view().party!.shadow!.rewards[0]!.amount=999;expect(f.room().party!.shadow).toEqual(called);
  });
});
