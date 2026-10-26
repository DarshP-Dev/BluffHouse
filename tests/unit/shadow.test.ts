import {describe,expect,it} from 'vitest';
import {startShadow,assertShadow,projectShadow} from '../../apps/server/src/game/shadow.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';
import {fundedFinale,declareShadow,advanceFinale,standRemaining} from '../fixtures/shadow.js';

describe('Shadow start guards, unique hands and consumed-shoe invariants',()=>{
  it('never starts in Classic, before the final round, when disabled, after finalization, or twice',()=>{
    const classic=fixture();classic.start();expect(startShadow(classic.room(),classic.manager.e,classic.view().serverTime)).toBe(false);for(const condition of ['disabled','early','distributed','already']as const){const f=fundedFinale({enter:condition==='already'}),r=f.room();if(condition==='disabled')r.finaleEnabled=false;else if(condition==='early')r.round=1;else if(condition==='distributed')r.party!.vaultDistributed=true;const before=structuredClone(r);expect(startShadow(r,f.manager.e,f.view().serverTime)).toBe(false);expect(r).toEqual(before);}
  });
  it('admits empty-Vault and zero-wager participants rather than requiring a funded side pot',()=>{const f=fundedFinale({pot:0});expect(f.view().phase).toBe('SHADOW_TURN');expect(f.view().party!.shadow!.entrantIds).toEqual(f.actors);expect(f.view().party!.shadow!.pot).toBe(0);assertRoom(f.room());});
  it.each(['duplicate-card','cursor','future-card','duplicate-hand','dealer-alias']as const)('rejects %s corruption before another accepted action',kind=>{
    const f=fundedFinale(),s=f.room().party!.shadow!;if(kind==='duplicate-card')s.entries[1]!.hand[0]=s.entries[0]!.hand[0]!;else if(kind==='cursor')s.cursor++;else if(kind==='future-card')s.entries[0]!.hand[0]=s.shoe[s.cursor]!;else if(kind==='duplicate-hand')s.entries[1]!.handId=s.entries[0]!.handId;else s.dealer=structuredClone(s.dealer);expect(()=>assertShadow(f.room())).toThrow();
  });
  it('leaves draw-and-claim atomic when the server-owned shoe is exhausted',()=>{const f=fundedFinale(),s=f.room().party!.shadow!;s.shoe.length=s.cursor;const before=structuredClone(f.room());expect(f.send(f.host,'shadow:drawclaim')).toMatchObject({status:'rejected',code:'SHADOW_SHOE_EXHAUSTED'});expect(f.room()).toEqual(before);});
  it('keeps immutable hand IDs through Hits, claims, calls and reconnect',()=>{const f=fundedFinale(),ids=f.room().party!.shadow!.entries.map(e=>e.handId);expect(new Set(ids).size).toBe(ids.length);f.send(f.host,'shadow:drawclaim');f.manager.presence(f.host,false);f.manager.presence(f.host,true);f.send(f.actors[1]!,'shadow:challenge');expect(f.room().party!.shadow!.entries.map(e=>e.handId)).toEqual(ids);assertRoom(f.room());});
});

describe('owner-scoped actions and legitimate timing precision',()=>{
  it('shows only active-owner decision IDs and legality; call permissions require no available chips',()=>{const f=fundedFinale();for(const actor of f.actors)expect(projectShadow(f.room(),actor)!.decisionId).toEqual(actor===f.host?expect.any(String):null);declareShadow(f,0);for(const actor of f.actors){const s=projectShadow(f.room(),actor)!;expect(s.decisionId).toBeNull();expect(s.actions.canCall).toBe(actor!==f.host);}assertRoom(f.room());});
  it('preserves fractional timestamps and does not round a legal turn into expiry',()=>{const f=fundedFinale(),base=f.manager.e.now;f.manager.e.now=()=>base()+.25;f.advance(1);expect(f.send(f.host,'shadow:stand').status).toBe('ok');expect(f.view().deadline!%1).toBe(.25);assertRoom(f.room());});
  it('cannot reopen a resolved claim or restore an exhausted one-call allowance',()=>{const f=fundedFinale();declareShadow(f,0);const command=f.command(f.actors[1]!,'shadow:challenge'),ack=f.manager.command(f.actors[1]!,command);expect(ack.status).toBe('ok');const called=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,command)).toEqual(ack);expect(f.room()).toEqual(called);declareShadow(f,1);expect(f.send(f.actors[0]!,'shadow:challenge').status).toBe('rejected');standRemaining(f);expect(f.room().party!.shadow!.claims.filter(c=>c.status==='open')).toEqual([]);assertRoom(f.room());});
  it('leaves the original eight-second deadline untouched when its owner becomes absent',()=>{const f=fundedFinale();declareShadow(f,0);const deadline=f.view().deadline;f.manager.presence(f.host,false);expect(f.view().deadline).toBe(deadline);advanceFinale(f);expect(f.view().party!.shadow!.claims[0]!.status).toBe('unchallenged');});
});
