import {describe,expect,it} from 'vitest';
import type {Rank,ShadowClaim} from '@bluff-house/shared';
import {shadowScoring,shadowWinners,shadowVaultThieves,settleShadowVault} from '../../apps/server/src/game/vault.js';
import type {ShadowState} from '../../apps/server/src/game/state.js';
import {shoe} from '../fixtures/core.js';
import {fundedFinale} from '../fixtures/shadow.js';

function state(ranks:Rank[][],claims:ShadowClaim[]=[]):ShadowState{let count=0;return {id:'unit-shadow',status:'claiming',pot:100,entries:ranks.map((r,i)=>({playerId:`player-${i+1}`,seat:i,hand:shoe(r).slice(0,r.length).map(card=>({...card,id:`unit-card-${count++}`})),locked:true,drew:r.length===3,revealed:false,claimDone:true})),shoe:[],cursor:0,activePlayerId:null,decisionId:null,deadline:null,claim:null,claims,winnerIds:[],awards:[],fallback:false,vaultThiefIds:[]};}
const claim=(claimantId:string,total:17|18|19|20|21,status:ShadowClaim['status'],challengerId?:string):ShadowClaim=>({id:`claim-${claimantId}`,claimantId,declaredTotal:total,status,deadline:1000,...(challengerId?{challengerId}:{})});

describe('specific declared totals and truthful challenge arithmetic',()=>{
  it('uses an unchallenged declared21 as base22 even when the real total29 busts',()=>{
    const s=state([['10','9','10']],[claim('player-1',21,'unchallenged')]);expect(shadowScoring(s)).toEqual([{playerId:'player-1',baseTotal:21,claimBonus:1,challengePoints:0,disqualified:false,eligible:true,score:22}]);expect(shadowScoring(s,'player-1')[0]).toMatchObject({baseTotal:29,claimBonus:0,eligible:false,score:null});
  });
  it('does not retroactively substitute a real hand total for a successful uncalled lower declaration',()=>{
    const s=state([['10','9']],[claim('player-1',17,'unchallenged')]);expect(shadowScoring(s)[0]).toMatchObject({baseTotal:17,claimBonus:1,score:18,eligible:true});
  });
  it('rewards exact truth bytwo and penalizes its incorrect caller bytwo',()=>{
    const s=state([['10','9'],['10','8']],[claim('player-1',19,'truthful','player-2')]);expect(shadowScoring(s)).toEqual([{playerId:'player-1',baseTotal:19,claimBonus:2,challengePoints:0,disqualified:false,eligible:true,score:21},{playerId:'player-2',baseTotal:18,claimBonus:0,challengePoints:-2,disqualified:false,eligible:true,score:16}]);
  });
  it('disqualifies a caught liar while addingtwo to the correct caller with no penalty',()=>{
    const s=state([['10','9','10'],['10','7']],[claim('player-1',21,'caught','player-2')]);expect(shadowScoring(s)[0]).toMatchObject({disqualified:true,eligible:false,score:null});expect(shadowScoring(s)[1]).toMatchObject({challengePoints:2,score:19});
  });
  it('accumulates independent challenge points but never revives a caught or unclaimed busted hand',()=>{
    const s=state([['10','10','2'],['10','8'],['10','7']],[claim('player-2',18,'truthful','player-1'),claim('player-3',21,'caught','player-1')]);expect(shadowScoring(s)[0]).toMatchObject({challengePoints:0,eligible:false,score:null});expect(shadowScoring(s)[2]).toMatchObject({disqualified:true,score:null});
  });
});

describe('funded Vault winners, tie remainders and fallback',()=>{
  function ready(ranks:Rank[][],claims:ShadowClaim[]=[]){const f=fundedFinale({players:ranks.length}),r=f.room(),original=r.party!.shadow!,s=state(ranks,claims);r.party!.shadow={...s,id:original.id,pot:original.pot};return f;}
  it('splits an exact three-way tie in original seat order with the remainder paid once',()=>{
    const f=ready([['10','7'],['9','8'],['10','7']]),r=f.room(),s=r.party!.shadow!;expect(shadowWinners(r)).toEqual(f.actors);settleShadowVault(r,f.manager.e,f.view().serverTime);expect(s.awards).toEqual([{playerId:f.host,amount:34},{playerId:f.actors[1],amount:33},{playerId:f.actors[2],amount:33}]);expect(r.players.map(p=>p.account.balance)).toEqual([934,1033,1033]);expect(r.party!.vault).toBe(0);expect(r.party!.vaultDistributed).toBe(true);const after=structuredClone(r);settleShadowVault(r,f.manager.e,f.view().serverTime);expect(r).toEqual(after);
  });
  it('excludes busts and caught claims from winner selection, then falls back to every original participant if all fail',()=>{
    const f=ready([['10','10','2'],['10','9','3'],['10','8','4']]),r=f.room();expect(shadowWinners(r)).toEqual(f.actors);settleShadowVault(r,f.manager.e,f.view().serverTime);expect(r.party!.shadow!.fallback).toBe(true);expect(r.players.map(p=>p.account.balance)).toEqual([934,1033,1033]);expect(r.party!.vault).toBe(0);
  });
  it('includes absent and departed original participants in all-ineligible fallback',()=>{
    const f=ready([['10','10','2'],['10','9','3'],['10','8','4']]),r=f.room();r.players[1]!.connected=false;r.players[2]!.connected=false;r.players[2]!.departed=true;r.party!.shadow!.entries=r.party!.shadow!.entries.slice(0,2);expect(shadowWinners(r)).toEqual(f.actors);settleShadowVault(r,f.manager.e,f.view().serverTime);expect(r.party!.shadow!.awards.map(a=>a.playerId)).toEqual(f.actors);
  });
  it('cannot settle while an entrant hand, declaration or challenge remains open',()=>{
    for(const pending of ['hand','declaration','challenge'] as const){const f=ready([['10','9'],['10','8']]),r=f.room(),s=r.party!.shadow!;if(pending==='hand')s.entries[0]!.locked=false;else if(pending==='declaration')s.entries[0]!.claimDone=false;else s.claims.push(claim(f.host,19,'open'));const before=structuredClone(r);expect(()=>settleShadowVault(r,f.manager.e,f.view().serverTime)).toThrow('SHADOW_OBLIGATION_OPEN');expect(r).toEqual(before);}
  });
  it('rejects any mismatch between the frozen contest pot and its actual funded Vault',()=>{
    const f=ready([['10','9'],['10','8']]),r=f.room();r.party!.shadow!.pot++;const before=structuredClone(r);expect(()=>settleShadowVault(r,f.manager.e,f.view().serverTime)).toThrow('SHADOW_VAULT_INVARIANT');expect(r).toEqual(before);
  });
  it.each([
    {real:['10','9','10'] as Rank[],declared:21 as const,rival:['10','7'] as Rank[],qualified:true},
    {real:['10','10'] as Rank[],declared:21 as const,rival:['10','7'] as Rank[],qualified:false},
    {real:['10','7'] as Rank[],declared:21 as const,rival:['10','10'] as Rank[],qualified:true},
    {real:['10','9','10'] as Rank[],declared:17 as const,rival:['10','10'] as Rank[],qualified:false},
  ])('derives the future Vault Thief event only from a false uncalled claim that changed its winner set: $qualified',({real,declared,rival,qualified})=>{
    const f=ready([real,rival],[claim('player-1',declared,'unchallenged')]),r=f.room();settleShadowVault(r,f.manager.e,f.view().serverTime);expect(r.party!.shadow!.vaultThiefIds.includes(f.host)).toBe(qualified);expect(r.party!.vault).toBe(0);expect(r.party!.bonusReserve).toBe(200);expect(r.dealerNet).toBe(0);
  });
  it('does not qualify a new tied winner whose actual remainder-ordered award remains zero',()=>{
    const f=ready([['10','10'],['A','K'],['10','7']],[claim('player-3',20,'unchallenged')]),r=f.room();r.party!.shadow!.pot=1;expect(shadowWinners(r)).toEqual(f.actors.slice(1));expect(shadowWinners(r,f.actors[2])).toEqual([f.actors[1]]);expect(shadowVaultThieves(r)).toEqual([]);
  });
});
