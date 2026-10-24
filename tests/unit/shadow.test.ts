import {describe,expect,it} from 'vitest';
import {startShadow,assertShadow,projectShadow} from '../../apps/server/src/game/shadow.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';
import {fundedFinale,lockShadowHands,declareShadow,advanceFinale,finishFinale} from '../fixtures/shadow.js';

describe('funded entrant snapshots and fresh card conservation',()=>{
  it('does not start without Party, enabled finale, funded Vault or two connected entrants',()=>{
    const classic=fixture();classic.start();expect(startShadow(classic.room(),classic.manager.e,classic.view().serverTime)).toBe(false);
    for(const condition of ['disabled','empty','absent'] as const){const f=fundedFinale({enter:false}),r=f.room();if(condition==='disabled')r.finaleEnabled=false;else if(condition==='empty'){r.players[0]!.account.balance+=r.party!.vault;r.party!.vault=0;}else r.players.slice(1).forEach(p=>{p.connected=false;});const before=structuredClone(r);expect(startShadow(r,f.manager.e,f.view().serverTime)).toBe(false);expect(r).toEqual(before);}
  });
  it('creates one frozen private contest and never starts or pays it twice',()=>{
    const f=fundedFinale(),r=f.room(),before=structuredClone(r.party!.shadow);expect(startShadow(r,f.manager.e,f.view().serverTime)).toBe(false);expect(r.party!.shadow).toEqual(before);expect(r.party!.vault).toBe(100);assertRoom(r);
  });
  it.each(['duplicate','cursor','future-card','oversized-hand'] as const)('rejects %s conservation corruption',kind=>{
    const f=fundedFinale(),r=f.room(),s=r.party!.shadow!;if(kind==='duplicate')s.entries[1]!.hand[0]=s.entries[0]!.hand[0]!;else if(kind==='cursor')s.cursor++;else if(kind==='future-card')s.entries[0]!.hand[0]=s.shoe[s.cursor]!;else s.entries[0]!.hand.push(s.shoe[s.cursor]!,s.shoe[s.cursor+1]!);expect(()=>assertShadow(r)).toThrow();
  });
  it('leaves the shoe, card and draw decision unchanged if the next card cannot be drawn',()=>{
    const f=fundedFinale(),s=f.room().party!.shadow!;s.shoe.length=s.cursor;const before=structuredClone(f.room());expect(f.send(f.host,'shadow:draw')).toMatchObject({status:'rejected',code:'SHADOW_SHOE_EXHAUSTED'});expect(f.room()).toEqual(before);
  });
});

describe('sequential lock, reveal and claim legality',()=>{
  it('rejects an unlocked reveal and another entrant’s draw with no partial visibility or card mutation',()=>{
    const f=fundedFinale(),before=structuredClone(f.room());expect(f.send(f.host,'shadow:reveal').status).toBe('rejected');expect(f.send(f.actors[1]!,'shadow:draw').status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.host,'shadow:stand').status).toBe('ok');expect(f.send(f.host,'shadow:reveal').status).toBe('ok');expect(f.room().party!.shadow!.entries[0]).toMatchObject({locked:true,revealed:true,claimDone:true});assertRoom(f.room());
  });
  it('skips the claim opportunity of an entrant who voluntarily revealed before their claim stage',()=>{
    const f=fundedFinale();expect(f.send(f.host,'shadow:stand').status).toBe('ok');expect(f.send(f.host,'shadow:reveal').status).toBe('ok');expect(f.send(f.actors[1]!,'shadow:stand').status).toBe('ok');expect(f.send(f.actors[2]!,'shadow:stand').status).toBe('ok');expect(f.view().phase).toBe('SHADOW_CLAIM');expect(f.view().party!.shadow!.activePlayerId).toBe(f.actors[1]);const before=structuredClone(f.room());expect(f.send(f.host,'shadow:claim',{declaredTotal:21}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('preserves a declared lie when voluntarily revealing during its challenge window',()=>{
    const f=fundedFinale();lockShadowHands(f,[0]);declareShadow(f,0,21);const id=f.view().party!.shadow!.claim!.id;expect(f.send(f.host,'shadow:reveal').status).toBe('ok');expect(f.view().phase).toBe('SHADOW_CHALLENGE');expect(f.view().party!.shadow!.claim).toMatchObject({id,declaredTotal:21,status:'open'});f.advance(8000);finishFinale(f);expect(f.view().party!.shadow!.winnerIds).toEqual([f.host]);
  });
  it('projects the draw and claim decisions only to their active owner',()=>{
    const f=fundedFinale();for(const viewer of f.actors)expect(projectShadow(f.room(),viewer)!.decisionId).toEqual(viewer===f.host?expect.any(String):null);lockShadowHands(f);for(const viewer of f.actors)expect(projectShadow(f.room(),viewer)!.decisionId).toEqual(viewer===f.host?expect.any(String):null);
  });
  it('retains exact fractional timestamps instead of rounding or rejecting legitimate actions',()=>{
    const f=fundedFinale(),base=f.manager.e.now;f.manager.e.now=()=>base()+0.25;expect(f.view().phase).toBe('SHADOW_DRAW');f.advance(1);expect(f.send(f.host,'shadow:stand').status).toBe('ok');expect(f.view().deadline!%1).toBe(0.25);assertRoom(f.room());
  });
});
