import {describe,expect,it} from 'vitest';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {closeAuction,distributeVault} from '../../apps/server/src/game/house.js';
import {credit,account} from '../../apps/server/src/game/ledger.js';
import {fixture} from '../fixtures/core.js';
import {overthrowThreshold} from '../../apps/server/src/game/overthrow.js';

describe('75 percent overthrow threshold',()=>{
  it.each([[1,1],[2,2],[3,3],[4,3],[5,4]])('requires %s eligible voters to supply %s affirmative votes',(voters,required)=>{
    expect(overthrowThreshold(voters)).toBe(required);
  });
});

function crowned(players=2){
  const f=fixture({mode:'PARTY',players});f.start();f.send(f.host,'house:bid',{amount:50});f.advance(22000);return f;
}

// Passive commissions were replaced by the approved dealer's first-loss bond and
// finite Bank. Their arithmetic and idempotence are exercised in house-bank.test.ts.

describe('Vault settlement and independent credit identities',()=>{
  it('splits funded Vault among original participants including absent/departed seats, with seat-order remainders',()=>{
    const f=crowned(3),r=f.room();r.players[1]!.connected=false;r.players[2]!.connected=false;r.players[2]!.departed=true;
    // Reorder storage to prove the integer remainder follows seat numbers.
    r.players.reverse();const reserveBefore=r.party!.bonusReserve;distributeVault(r);
    expect([...r.players].sort((a,b)=>a.seat-b.seat).map(p=>p.account.balance)).toEqual([967,1017,1016]);
    expect(r.party!.vault).toBe(0);expect(r.party!.bonusReserve).toBe(reserveBefore);expect(reserveBefore).toBe(300);
    expect(r.party!.transfers.filter(t=>t.kind==='vault_distribution').map(t=>t.amount).sort()).toEqual([16,17,17]);
    const after=structuredClone(r);distributeVault(r);expect(r).toEqual(after);assertRoom(r);
  });
  it('excludes a nonparticipating lobby observer from the fallback',()=>{
    const f=fixture({mode:'PARTY',players:3}),absent=f.actors[2]!;f.manager.presence(absent,false);
    for(const actor of f.actors.slice(0,2))f.send(actor,'lobby:ready',{ready:true});f.send(f.host,'match:start');f.send(f.host,'house:bid',{amount:50});f.advance(22000);
    const r=f.room();expect(r.players[2]!.participating).toBe(false);distributeVault(r);
    expect(r.players.map(p=>p.account.balance)).toEqual([975,1025,1000]);expect(r.party!.transfers.filter(t=>t.kind==='vault_distribution')).toHaveLength(2);assertRoom(r);
  });
  it('cannot charge or refund an auction twice',()=>{
    const f=fixture({mode:'PARTY'});f.start();f.send(f.host,'house:bid',{amount:300});f.send(f.actors[1]!,'house:bid',{amount:200});f.advance(20000);
    const r=f.room(),after=structuredClone(r);closeAuction(r,f.manager.e);expect(r).toEqual(after);assertRoom(r);
  });
  it('credits each separate funding identity once and rejects collisions with outstanding commitments',()=>{
    const a=account();expect(credit(a,'funded:1',3)).toBe(true);expect(credit(a,'funded:1',3)).toBe(false);expect(a.balance).toBe(1003);
    a.reservations['pending']=50;const before=structuredClone(a);expect(()=>credit(a,'pending',3)).toThrow('WAGER_STATUS_CONFLICT');expect(a).toEqual(before);
    expect(()=>credit(a,'negative',-1)).toThrow('INVALID_CHIP_AMOUNT');expect(a).toEqual(before);
  });
  it.each([-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])('rejects unsafe credit %s before any mutation',(amount)=>{
    const a=account(),before=structuredClone(a);expect(()=>credit(a,'funded:invalid',amount)).toThrow('INVALID_CHIP_AMOUNT');expect(a).toEqual(before);
  });
  it('rejects a funding identity that belongs to a committed escrow',()=>{
    const a=account(950);a.escrows['committed']=50;const before=structuredClone(a);
    expect(()=>credit(a,'committed',3)).toThrow('WAGER_STATUS_CONFLICT');expect(a).toEqual(before);
  });
  it('validates credit overflow against both balance and outstanding escrow',()=>{
    const a=account(Number.MAX_SAFE_INTEGER-10);a.escrows['pending']=10;const before=structuredClone(a);
    expect(()=>credit(a,'funded:overflow',1)).toThrow('INVALID_CHIP_AMOUNT');expect(a).toEqual(before);
  });
});
