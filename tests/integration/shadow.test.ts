import {describe,expect,it} from 'vitest';
import {evaluate} from '../../apps/server/src/game/cards.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';
import {fundedFinale,lockShadowHands,declareShadow,advanceFinale,finishFinale} from '../fixtures/shadow.js';

// Focused zero-wealth setup transfers the depleted personal capital to the
// declared finite Bank; a House bond cannot remain reserved against zero wealth.
function deplete(f: ReturnType<typeof fundedFinale>, ids = f.actors) {
  const r = f.room(), bank = r.party!.bank;
  for (const p of r.players.filter(player => ids.includes(player.id))) {
    bank.balance += p.account.balance;
    if (bank.bond.ownerId === p.id) { if (bank.bond.reservationId) delete p.account.reservations[bank.bond.reservationId]; bank.bond.amount = 0; }
    p.account.balance = 0;
  }
  r.dealerNet = bank.initial - bank.balance; assertRoom(r);
}

describe('funded finale entry and the separate hidden draw stage',()=>{
  it('enters after normal settlements with a fresh private shoe and a funded immutable pot',()=>{
    const f=fundedFinale();expect(f.view().phase).toBe('SHADOW_DRAW');expect(f.view().party!.vault).toBe(100);expect(f.view().party!.shadow!.entrantIds).toEqual(f.actors);expect(f.view().party!.shadow!.activePlayerId).toBe(f.host);expect(f.view().deadline!-f.view().serverTime).toBe(10000);expect(f.room().party!.shadow!.entries.map(e=>e.hand.length)).toEqual([2,2,2]);expect(f.view().players.map(p=>p.balance)).toEqual([900,1000,1000]);assertRoom(f.room());
  });
  it('takes at most one optional draw per entrant and locks every hand before claims begin',()=>{
    const f=fundedFinale(),original=f.command(f.host,'shadow:draw'),ack=f.manager.command(f.host,original);expect(ack.status).toBe('ok');expect(f.view().party!.shadow!.activePlayerId).toBe(f.actors[1]);const after=structuredClone(f.room());expect(f.manager.command(f.host,original)).toEqual(ack);expect(f.send(f.host,'shadow:draw').status).toBe('rejected');expect(f.send(f.host,'shadow:claim',{declaredTotal:21}).status).toBe('rejected');expect(f.room()).toEqual(after);expect(f.send(f.actors[1]!,'shadow:stand').status).toBe('ok');expect(f.view().phase).toBe('SHADOW_DRAW');expect(f.send(f.actors[2]!,'shadow:stand').status).toBe('ok');expect(f.view().phase).toBe('SHADOW_CLAIM');expect(f.view().party!.shadow!.activePlayerId).toBe(f.host);expect(f.room().party!.shadow!.entries.map(e=>[e.hand.length,e.locked,e.drew])).toEqual([[3,true,true],[2,true,false],[2,true,false]]);assertRoom(f.room());
  });
  it('admits zero-chip players without an additional wager or affordability requirement',()=>{
    const f=fundedFinale({enter:false});deplete(f);advanceFinale(f);expect(f.view().phase).toBe('SHADOW_DRAW');expect(f.view().party!.shadow!.entrantIds).toEqual(f.actors);lockShadowHands(f);declareShadow(f,0,21);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');finishFinale(f);expect(f.view().players.reduce((sum,p)=>sum+p.balance,0)).toBe(100);assertRoom(f.room());
  });
  it('freezes entrants on entry, retaining later disconnects and excluding late reconnecting watchers',()=>{
    const f=fundedFinale({enter:false});f.manager.presence(f.actors[2]!,false);advanceFinale(f);expect(f.view().party!.shadow!.entrantIds).toEqual(f.actors.slice(0,2));f.manager.presence(f.actors[2]!,true);const before=structuredClone(f.room());expect(f.send(f.actors[2]!,'shadow:draw').status).toBe('rejected');expect(f.room()).toEqual(before);f.manager.presence(f.actors[1]!,false);expect(f.view().party!.shadow!.entrantIds).toEqual(f.actors.slice(0,2));f.advance(20000);expect(f.view().phase).toBe('SHADOW_CLAIM');expect(f.view().party!.shadow!.entrantIds).toEqual(f.actors.slice(0,2));f.manager.presence(f.actors[1]!,true);finishFinale(f);assertRoom(f.room());
  });
});

describe('declarations, challenges and protected historical bluff scoring',()=>{
  it('lets a real busted 29 declare 21 unchallenged and win the funded Vault',()=>{
    const f=fundedFinale();lockShadowHands(f,[0]);expect(evaluate(f.room().party!.shadow!.entries[0]!.hand).total).toBe(29);declareShadow(f,0,21);expect(f.view().phase).toBe('SHADOW_CHALLENGE');f.advance(8000);finishFinale(f);expect(f.view().party!.shadow!.winnerIds).toEqual([f.host]);expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000,1000]);expect(f.view().party!.shadow!.vaultThiefIds).toContain(f.host);expect(f.view().party!.vault).toBe(0);assertRoom(f.room());
  });
  it('disqualifies the identical true-29 lie when it is challenged and rewards that caller',()=>{
    const f=fundedFinale();lockShadowHands(f,[0]);declareShadow(f,0,21);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');finishFinale(f);expect(f.view().party!.shadow!.winnerIds).toEqual([f.actors[1]]);expect(f.view().players.map(p=>p.balance)).toEqual([900,1100,1000]);expect(f.view().party!.shadow!.vaultThiefIds).toEqual([]);assertRoom(f.room());
  });
  it('rewards exact truthful claims and forces a wrong challenger’s hidden hand into public view',()=>{
    const f=fundedFinale();lockShadowHands(f);declareShadow(f,0,19);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');const entries=f.room().party!.shadow!.entries;expect(entries[0]!.revealed).toBe(true);expect(entries[1]!.revealed).toBe(true);finishFinale(f);expect(f.view().party!.shadow!.winnerIds).toEqual([f.host]);expect(f.view().party!.shadow!.vaultThiefIds).toEqual([]);assertRoom(f.room());
  });
  it('allows the House to challenge another entrant under the same no-chip rules',()=>{
    const f=fundedFinale();lockShadowHands(f,[1]);expect(f.send(f.host,'shadow:pass').status).toBe('ok');declareShadow(f,1,21);expect(f.view().party!.houseId).toBe(f.host);deplete(f,[f.host]);expect(f.send(f.host,'shadow:challenge').status).toBe('ok');finishFinale(f);expect(f.view().party!.shadow!.winnerIds).toEqual([f.host]);expect(f.view().players[0]!.balance).toBe(100);assertRoom(f.room());
  });
  it('binds only the first valid caller and rejects self-calls and stale challenge identities',()=>{
    const f=fundedFinale();lockShadowHands(f,[0]);declareShadow(f,0,21);let before=structuredClone(f.room());expect(f.send(f.host,'shadow:challenge').status).toBe('rejected');expect(f.send(f.actors[1]!,'shadow:challenge',undefined,{shadowClaimId:'old-claim'}).status).toBe('rejected');expect(f.room()).toEqual(before);const first=f.command(f.actors[1]!,'shadow:challenge'),second=f.command(f.actors[2]!,'shadow:challenge'),ack=f.manager.command(f.actors[1]!,first);expect(ack.status).toBe('ok');before=structuredClone(f.room());expect(f.manager.command(f.actors[2]!,second).status).toBe('rejected');expect(f.manager.command(f.actors[1]!,first)).toEqual(ack);expect(f.room()).toEqual(before);finishFinale(f);expect(f.view().party!.shadow!.winnerIds).toEqual([f.actors[1]]);
  });
  it('rejects a disqualified prior claimant as a challenger to a later claim',()=>{
    const f=fundedFinale();lockShadowHands(f,[0]);declareShadow(f,0,21);expect(f.send(f.actors[1]!,'shadow:challenge').status).toBe('ok');for(let n=0;n<4&&f.view().phase!=='SHADOW_CLAIM';n++)advanceFinale(f);declareShadow(f,1,17);const before=structuredClone(f.room());expect(f.send(f.host,'shadow:challenge').status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.actors[2]!,'shadow:challenge').status).toBe('ok');finishFinale(f);assertRoom(f.room());
  });
  it('keeps a successful busted unchallenged lie valid after a later voluntary reveal',()=>{
    const f=fundedFinale();lockShadowHands(f,[0]);declareShadow(f,0,21);f.advance(8000);expect(f.send(f.host,'shadow:reveal').status).toBe('ok');expect(f.room().party!.shadow!.entries[0]!.revealed).toBe(true);finishFinale(f);expect(f.view().party!.shadow!.winnerIds).toEqual([f.host]);assertRoom(f.room());
  });
  it('treats an unclaimed or voluntarily revealed bust as ineligible and preserves public reveal permanence',()=>{
    for(const reveal of [false,true]){const f=fundedFinale();lockShadowHands(f,[0]);expect(f.send(f.host,reveal?'shadow:reveal':'shadow:pass').status).toBe('ok');finishFinale(f);expect(f.view().party!.shadow!.winnerIds).not.toContain(f.host);expect(f.view().party!.shadow!.winnerIds).toEqual(f.actors.slice(1));assertRoom(f.room());}
  });
  it.each([16,22,17.5,'21',null])('rejects invalid declaration %s without consuming the player decision',declaredTotal=>{
    const f=fundedFinale();lockShadowHands(f);const before=structuredClone(f.room());expect(f.send(f.host,'shadow:claim',{declaredTotal}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
});

describe('bounded stages, exact deadlines and reconnect snapshots',()=>{
  it('auto-stands each draw decision, passes each declaration, settles and pays once within the announced clocks',()=>{
    const f=fundedFinale(),start=f.view().serverTime;for(let i=0;i<3;i++){expect(f.view().phase).toBe('SHADOW_DRAW');expect(f.view().party!.shadow!.activePlayerId).toBe(f.actors[i]);f.advance(10000);}expect(f.view().phase).toBe('SHADOW_CLAIM');for(let i=0;i<3;i++){expect(f.view().party!.shadow!.activePlayerId).toBe(f.actors[i]);f.advance(10000);}expect(f.view().phase).toBe('SHADOW_RESULT');expect(f.view().serverTime-start).toBe(60000);expect(f.view().party!.shadow!.winnerIds).toEqual([f.host]);const paid=structuredClone(f.room().players.map(p=>({balance:p.account.balance,escrows:p.account.escrows,settlements:p.account.settlements})));finishFinale(f);expect(f.room().players.map(p=>({balance:p.account.balance,escrows:p.account.escrows,settlements:p.account.settlements}))).toEqual(paid);expect(f.room().players.every(p=>Object.keys(p.account.reservations).length===0)).toBe(true);expect(f.view().party!.vault).toBe(0);assertRoom(f.room());
  });
  it('rejects stale draw decisions and exact deadline claims/challenges without a second card or changed award',()=>{
    const f=fundedFinale(),late=f.command(f.host,'shadow:draw');f.advance(10000);let before=structuredClone(f.room());expect(f.manager.command(f.host,late).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.actors[1]!,'shadow:stand').status).toBe('ok');expect(f.send(f.actors[2]!,'shadow:stand').status).toBe('ok');const oldClaim=f.command(f.host,'shadow:claim',{declaredTotal:21});f.advance(10000);before=structuredClone(f.room());expect(f.manager.command(f.host,oldClaim).status).toBe('rejected');expect(f.room()).toEqual(before);declareShadow(f,1,21);const oldCall=f.command(f.actors[2]!,'shadow:challenge');f.advance(8000);before=structuredClone(f.room());expect(f.manager.command(f.actors[2]!,oldCall).status).toBe('rejected');expect(f.room()).toEqual(before);finishFinale(f);assertRoom(f.room());
  });
  it('restores the same private hand and decision after refresh during each live stage',()=>{
    const f=fundedFinale();for(const stage of ['SHADOW_DRAW','SHADOW_CLAIM','SHADOW_CHALLENGE']){expect(f.view().phase).toBe(stage);const before=f.view().party!.shadow!,deadline=f.view().deadline;f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().party!.shadow).toEqual(before);expect(f.view().deadline).toBe(deadline);if(stage==='SHADOW_DRAW')lockShadowHands(f);else if(stage==='SHADOW_CLAIM')declareShadow(f,0,21);}finishFinale(f);assertRoom(f.room());
  });
  it('drains frozen entrant obligations after every player disconnects and retains the once-only payout after reconnect',()=>{
    const f=fundedFinale();for(const actor of f.actors)f.manager.presence(actor,false);f.advance(100000);expect(f.view().phase).toBe('RESULTS');expect(f.view().party!.vault).toBe(0);const accounts=structuredClone(f.room().players.map(p=>p.account));for(const actor of f.actors)f.manager.presence(actor,true);expect(f.room().players.map(p=>p.account)).toEqual(accounts);assertRoom(f.room());
  });
  it('preserves an explicitly departing frozen entrant and lets their already-started contest settle',()=>{
    const f=fundedFinale();expect(f.send(f.actors[1]!,'room:leave').status).toBe('ok');expect(f.view().party!.shadow!.entrantIds).toEqual(f.actors);finishFinale(f);expect(f.view().results!.standings.some(p=>p.id===f.actors[1])).toBe(true);assertRoom(f.room());
  });
});

describe('finale lobby configuration, fallback and same-room replay',()=>{
  it('defaults Party finale on, resets readiness on changes, and keeps the setting immutable after start',()=>{
    const f=fixture();expect(f.view().finaleEnabled).toBe(false);expect(f.send(f.host,'lobby:finale',{enabled:true}).status).toBe('rejected');expect(f.send(f.host,'lobby:mode',{mode:'PARTY'}).status).toBe('ok');expect(f.view().finaleEnabled).toBe(true);let before=structuredClone(f.room());expect(f.send(f.actors[1]!,'lobby:finale',{enabled:false}).status).toBe('rejected');expect(f.send(f.host,'lobby:finale',{enabled:'yes'}).status).toBe('rejected');expect(f.room()).toEqual(before);for(const actor of f.actors)f.send(actor,'lobby:ready',{ready:true});const lobby=f.view().lobbyId;expect(f.send(f.host,'lobby:finale',{enabled:false}).status).toBe('ok');expect(f.view().lobbyId).not.toBe(lobby);expect(f.view().players.every(p=>!p.ready)).toBe(true);f.start();before=structuredClone(f.room());expect(f.send(f.host,'lobby:finale',{enabled:true}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('uses equal fallback shares for disabled finale, an empty Vault, or insufficient connected entrants',()=>{
    const empty=fundedFinale({pot:0});expect(empty.view().phase).toBe('RESULTS');expect(empty.view().party!.shadow).toBeNull();assertRoom(empty.room());
    const absent=fundedFinale({enter:false});absent.manager.presence(absent.actors[1]!,false);absent.manager.presence(absent.actors[2]!,false);advanceFinale(absent);expect(absent.view().phase).toBe('RESULTS');expect(absent.view().players.map(p=>p.balance)).toEqual([934,1033,1033]);assertRoom(absent.room());
  });
  it('falls back to all original seats when every actual entry busts, paying exact funded remainders',()=>{
    const f=fundedFinale({ranks:['10','10','10','9','9','9','10','10','10']});lockShadowHands(f,[0,1,2]);expect(f.room().party!.shadow!.entries.map(e=>evaluate(e.hand).total)).toEqual([29,29,29]);finishFinale(f);expect(f.view().party!.shadow).toMatchObject({fallback:true,winnerIds:f.actors,awards:[{playerId:f.host,amount:34},{playerId:f.actors[1],amount:33},{playerId:f.actors[2],amount:33}]});expect(f.view().players.map(p=>p.balance)).toEqual([934,1033,1033]);assertRoom(f.room());
  });
  it('splits a real equal-score tie by original seat and pays the same winner set to every viewer',()=>{
    const f=fundedFinale({ranks:['10','9','10','7','8','7']});lockShadowHands(f);finishFinale(f);expect(f.view().party!.shadow!.fallback).toBe(false);expect(f.view().party!.shadow!.winnerIds).toEqual(f.actors);expect(f.view().party!.shadow!.awards.map(a=>a.amount)).toEqual([34,33,33]);for(const viewer of f.actors)expect(f.view(viewer).party!.shadow!.awards).toEqual(f.view().party!.shadow!.awards);assertRoom(f.room());
  });
  it('ranks actual Vault awards then resets the private contest and settlement identities on replay',()=>{
    const f=fundedFinale();lockShadowHands(f,[0]);declareShadow(f,0,21);f.advance(8000);finishFinale(f);const oldId=f.view().party!.shadow!.id,old=f.command(f.host,'shadow:reveal');expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.view().party!.shadow).toBeNull();expect(f.view().party!.vault).toBe(0);expect(f.view().finaleEnabled).toBe(true);const before=structuredClone(f.room());expect(f.manager.command(f.host,old).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().party!.auction.id).not.toBe(oldId);assertRoom(f.room());
  });
});
