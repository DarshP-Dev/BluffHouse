import {describe,expect,it} from 'vitest';
import {RULES,type DealChoice} from '@bluff-house/shared';
import {assertDeals,dealPairUsed,projectDeal,projectDealHistory,dealsDeadline,dealCommand} from '../../apps/server/src/game/deals.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';

function prepared(amount=100){const f=fixture({mode:'PARTY',rounds:6,players:3});f.start();f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount}).status).toBe('ok');const offer=f.view().party!.social!.dealInvites.at(-1)!;expect(f.send(f.actors[1]!,'deal:accept',undefined,{dealOfferId:offer.id}).status).toBe('ok');return f;}
function choices(f:ReturnType<typeof fixture>,a:DealChoice,b:DealChoice){expect(f.send(f.host,'deal:choose',{choice:a}).status).toBe('ok');expect(f.send(f.actors[1]!,'deal:choose',{choice:b}).status).toBe('ok');assertRoom(f.room());}
function bonusReserve(f:ReturnType<typeof fixture>,remaining:number){const r=f.room(),paid=r.party!.bonusReserve-remaining;r.players[2]!.account.balance+=paid;r.party!.bonusReserve=remaining;r.party!.transfers.push({id:'fixture-reserve-credit',kind:'bonus',amount:paid,from:'BONUS_RESERVE',to:f.actors[2]!});assertRoom(r);}

describe('funded Split or Steal outcome matrix',()=>{
  it.each<[DealChoice,DealChoice,number[],number,number]>([
    ['SPLIT','SPLIT',[1010,1010,1000],280,0],['SPLIT','STEAL',[900,1100,1000],300,0],['STEAL','SPLIT',[1100,900,1000],300,0],['STEAL','STEAL',[900,900,1000],300,200],
  ])('settles %s/%s with a funded pot and explicit source accounting',(first,second,balances,reserve,vault)=>{
    const f=prepared();choices(f,first,second);const r=f.room(),d=r.party!.social!.deal!;expect(r.players.map(p=>p.account.balance)).toEqual(balances);expect(r.party!.bonusReserve).toBe(reserve);expect(r.party!.vault).toBe(vault);expect(r.dealerNet).toBe(0);expect(d).toMatchObject({status:'settled',choices:{[f.host]:first,[f.actors[1]!]:second},vaultAmount:vault,bonusEach:first==='SPLIT'&&second==='SPLIT'?10:0,defaultedPlayerIds:[]});expect(r.players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(r.party!.dealHistory).toHaveLength(1);expect(r.party!.transfers.filter(t=>t.kind==='commission')).toEqual([]);assertDeals(r);
  });
  it.each([50,100,150,200,250])('returns each %i-chip cooperative principal independently of the ten-chip reserve award',amount=>{
    const f=prepared(amount);choices(f,'SPLIT','SPLIT');const r=f.room(),d=r.party!.social!.deal!;for(const p of r.players.slice(0,2)){expect(p.account.settlements[`${d.id}:${p.id}:deal`]).toBe(amount);expect(p.account.settlements[`${d.id}:${p.id}:deal-bonus`]).toBe(10);expect(d.returns[p.id]).toBe(amount+10);}expect(r.party!.transfers.filter(t=>t.kind==='deal_bonus')).toHaveLength(2);
  });
  it.each([0,1,2,3,19,20,21,99])('pays equal integer cooperation bonuses from a %i-chip finite reserve',remaining=>{
    const f=prepared();bonusReserve(f,remaining);const before=f.room().players.map(p=>p.account.balance),each=Math.min(10,Math.floor(remaining/2));choices(f,'SPLIT','SPLIT');expect(f.room().players.map(p=>p.account.balance)).toEqual([before[0]!+100+each,before[1]!+100+each,before[2]]);expect(f.view().party!.bonusReserve).toBe(remaining-2*each);expect(f.view().party!.social!.deal!.bonusEach).toBe(each);expect(f.view().party!.transfers.filter(t=>t.kind==='deal_bonus')).toHaveLength(each?2:0);assertRoom(f.room());
  });
});

describe('private choice projection and accepted-pair scope',()=>{
  it('exposes a locked choice only to its owner until both sides settle',()=>{
    const f=prepared();expect(f.send(f.host,'deal:choose',{choice:'SPLIT'}).status).toBe('ok');const d=f.room().party!.social!.deal!;
    expect(projectDeal(d,f.host)).toMatchObject({lockedPlayerIds:[f.host],ownChoice:'SPLIT'});for(const viewer of f.actors.slice(1)){const v=projectDeal(d,viewer);expect(v).not.toHaveProperty('ownChoice');expect(v).not.toHaveProperty('choices');expect(v.returns).toEqual({});expect(v.bonusEach).toBe(0);expect(v.vaultAmount).toBe(0);}expect(projectDealHistory(f.room(),f.host)).toEqual([]);
    const v=projectDeal(d,f.host);v.lockedPlayerIds.push('tampered');v.defaultedPlayerIds.push('tampered');v.returns[f.host]=999;expect(d.choices).toEqual({[f.host]:'SPLIT'});expect(d.defaultedPlayerIds).toEqual([]);expect(d.returns).toEqual({});
  });
  it('copies settled choices, returns and history without permitting mutation of the authoritative deal',()=>{
    const f=prepared();choices(f,'STEAL','SPLIT');const r=f.room(),before=structuredClone(r.party!.dealHistory),view=projectDealHistory(r,f.actors[2]!);view[0]!.choices![f.host]='SPLIT';view[0]!.returns[f.host]=0;view[0]!.lockedPlayerIds.length=0;expect(r.party!.dealHistory).toEqual(before);expect(projectDealHistory(r,f.actors[2]!)[0]).toMatchObject({choices:{[f.host]:'STEAL',[f.actors[1]!]: 'SPLIT'},returns:{[f.host]:200,[f.actors[1]!]:0}});
  });
  it('recognizes both directions of an accepted pair while retaining unused pair eligibility',()=>{
    const f=prepared();expect(dealPairUsed(f.room(),f.host,f.actors[1]!)).toBe(true);expect(dealPairUsed(f.room(),f.actors[1]!,f.host)).toBe(true);expect(dealPairUsed(f.room(),f.host,f.actors[2]!)).toBe(false);choices(f,'STEAL','STEAL');expect(dealPairUsed(f.room(),f.host,f.actors[1]!)).toBe(true);const classic=fixture();expect(dealPairUsed(classic.room(),classic.host,classic.actors[1]!)).toBe(false);expect(projectDealHistory(classic.room(),classic.host)).toEqual([]);
  });
});

describe('deal invariants beyond match-wide money conservation',()=>{
  it.each(['stake','clock','escrow','choice','early-returns','early-default','early-bonus','self','live-history'] as const)('detects %s corruption in a live contract',kind=>{
    const f=prepared(),r=f.room(),d=r.party!.social!.deal!;if(kind==='stake')d.amount=75;else if(kind==='clock')d.deadline++;else if(kind==='escrow')delete r.players[0]!.account.escrows[`${d.id}:${f.host}:deal`];else if(kind==='choice')(d.choices as Record<string,string>)[f.host]='CHEAT';else if(kind==='early-returns')d.returns[f.host]=100;else if(kind==='early-default')d.defaultedPlayerIds.push(f.host);else if(kind==='early-bonus')d.bonusEach=1;else if(kind==='self')d.defenderId=f.host;else r.party!.dealHistory.push(structuredClone(d));expect(()=>assertDeals(r)).toThrow();
  });
  it.each(['return','principal','bonus-recipient','bonus-amount','pair-history'] as const)('detects %s corruption after cooperation settles',kind=>{
    const f=prepared();choices(f,'SPLIT','SPLIT');const r=f.room(),d=r.party!.dealHistory[0]!;if(kind==='return')d.returns[f.host]++;else if(kind==='principal')r.players[0]!.account.settlements[`${d.id}:${f.host}:deal`]=99;else if(kind==='bonus-recipient')r.party!.transfers.find(t=>t.kind==='deal_bonus')!.to=f.actors[2]!;else if(kind==='bonus-amount')r.party!.transfers.find(t=>t.kind==='deal_bonus')!.amount=11;else r.party!.dealHistory.push({...structuredClone(d),id:'duplicate-pair-contract'});expect(()=>assertDeals(r)).toThrow();
  });
  it('detects a wrong Vault recipient when both players Steal',()=>{
    const f=prepared();choices(f,'STEAL','STEAL');const r=f.room();r.party!.transfers.find(t=>t.kind==='deal_vault')!.to=f.host;expect(()=>assertDeals(r)).toThrow();
  });
});

describe('choice deadline and full result-budget boundaries',()=>{
  it('rejects premature default resolution and resolves both missing choices only at ten seconds',()=>{
    const f=prepared(),r=f.room(),d=r.party!.social!.deal!,before=structuredClone(r);expect(()=>dealsDeadline(r,f.manager.e,d.deadline-1)).toThrow('DEAL_DEADLINE');expect(r).toEqual(before);f.advance(10000);expect(f.view().party!.social!.deal).toMatchObject({status:'settled',choices:{[f.host]:'STEAL',[f.actors[1]!]: 'STEAL'},defaultedPlayerIds:f.actors.slice(0,2),vaultAmount:200});const after=structuredClone(f.room());expect(()=>dealsDeadline(f.room(),f.manager.e,d.deadline)).toThrow('DEAL_CLOSED');expect(f.room()).toEqual(after);
  });
  it('rejects acceptance if ten seconds of choices and two seconds of summary cannot fit',()=>{
    const f=fixture({mode:'PARTY',rounds:6,players:3});f.start();f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount:100}).status).toBe('ok');const c=f.command(f.actors[1]!,'deal:accept'),candidate=structuredClone(f.room()),s=candidate.party!.social!,at=s.hardDeadline-11999;s.admissionDeadline=at+1000;s.dealInvites[0]!.deadline=at+1000;const before=structuredClone(candidate);expect(()=>dealCommand(candidate,candidate.players[1]!,c,f.manager.e,at)).toThrow('INSUFFICIENT_SOCIAL_TIME');expect(candidate).toEqual(before);
  });
});
