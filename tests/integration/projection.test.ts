import {describe,expect,it} from 'vitest';
import {evaluate} from '../../apps/server/src/game/cards.js';
import {project} from '../../apps/server/src/projection.js';
import {fundedFinale,lockShadowHands,declareShadow,finishFinale} from '../fixtures/shadow.js';

describe('Shadow Draw never leaks unrevealed hands or derived truth',()=>{
  it('shows every viewer only their own initial cards/value and active decision while hiding shoe order and opponents’ derived eligibility',()=>{
    const f=fundedFinale();for(const viewer of [...f.actors,'watcher']){const v=project(f.room(),viewer,'test-server',f.view().serverTime),s=v.party!.shadow!;expect(s.decisionId).toEqual(viewer===f.host?expect.any(String):null);expect(s).not.toHaveProperty('shoe');expect(s).not.toHaveProperty('cursor');for(const entry of s.entrants){const actual=f.room().party!.shadow!.entries.find(e=>e.playerId===entry.playerId)!;if(entry.playerId===viewer){expect(entry.hand).toEqual(actual.hand);expect(entry.value).toEqual(evaluate(actual.hand));}else{expect(entry.hand).toEqual([null,null]);expect(entry.value).toBeNull();for(const key of ['eligible','baseTotal','claimBonus','challengePoints','score','disqualified','actualTotal','bust','truth'])expect(entry).not.toHaveProperty(key);for(const card of actual.hand)expect(JSON.stringify(v)).not.toContain(card.id);}}expect(JSON.stringify(v)).not.toContain('test-card-6');expect(s.winnerIds).toEqual([]);expect(s.vaultThiefIds).toEqual([]);}
  });
  it('does not expose a hidden true29 bust or its successful lie through cards, score, truth labels or badge candidates',()=>{
    const f=fundedFinale();lockShadowHands(f,[0]);declareShadow(f,0,21);f.advance(8000);for(const viewer of f.actors.slice(1)){const s=f.view(viewer).party!.shadow!,p=s.entrants.find(e=>e.playerId===f.host)!;expect(p.hand).toEqual([null,null,null]);expect(p.value).toBeNull();for(const key of ['baseTotal','claimBonus','score','eligible','actualTotal','disqualified','truth'])expect(p).not.toHaveProperty(key);expect(s.claims[0]).toMatchObject({declaredTotal:21,status:'unchallenged'});expect(s.claims[0]).not.toHaveProperty('truth');expect(s.vaultThiefIds).toEqual([]);}
    const own=f.view().party!.shadow!.entrants[0]!;expect(own.value).toMatchObject({total:29,bust:true});finishFinale(f);for(const viewer of f.actors){const p=f.view(viewer).party!.shadow!.entrants[0]!;expect(p.value).toMatchObject({total:29,bust:true});expect(p).toMatchObject({baseTotal:21,claimBonus:1,score:22});}
  });
  it('reveals a voluntarily locked hand permanently without exposing another owner’s private hand',()=>{
    const f=fundedFinale();expect(f.send(f.host,'shadow:stand').status).toBe('ok');expect(f.send(f.host,'shadow:reveal').status).toBe('ok');for(const viewer of f.actors.slice(1)){const s=f.view(viewer).party!.shadow!;expect(s.entrants[0]!.hand).toEqual(f.room().party!.shadow!.entries[0]!.hand);expect(s.entrants[0]!.value).toMatchObject({total:19});expect(s.entrants[0]!.revealed).toBe(true);for(const p of s.entrants.filter(p=>p.playerId!==f.host&&p.playerId!==viewer)){expect(p.hand.every(card=>card===null)).toBe(true);expect(p.value).toBeNull();}}
    f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view(f.actors[1]).party!.shadow!.entrants[0]!.revealed).toBe(true);
  });
  it('reveals both exact claimant and mistaken caller, while an unrelated observer’s hidden hand stays private',()=>{
    const f=fundedFinale();lockShadowHands(f);declareShadow(f,0,19);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');for(const viewer of f.actors){const s=f.view(viewer).party!.shadow!;expect(s.entrants[0]!.hand.every(card=>card!==null)).toBe(true);expect(s.entrants[1]!.hand.every(card=>card!==null)).toBe(true);if(viewer!==f.actors[2]){expect(s.entrants[2]!.hand).toEqual([null,null]);expect(s.entrants[2]!.value).toBeNull();}}
  });
  it('returns copied cards, claims, awards and values so a client cannot mutate authoritative contest state',()=>{
    const f=fundedFinale(),before=structuredClone(f.room().party!.shadow!),v=f.view().party!.shadow!;v.entrants[0]!.hand[0]!.rank='A';v.entrants[0]!.value!.total=0;v.entrantIds.push('tamper');v.awards.push({playerId:f.host,amount:999});expect(f.room().party!.shadow).toEqual(before);lockShadowHands(f);declareShadow(f,0,21);f.advance(8000);const claimed=structuredClone(f.room().party!.shadow!),view=f.view().party!.shadow!;view.claims[0]!.declaredTotal=17;expect(f.room().party!.shadow).toEqual(claimed);
  });
});
