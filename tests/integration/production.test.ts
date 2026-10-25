import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {afterEach,describe,expect,it} from 'vitest';
import {io,type Socket} from 'socket.io-client';
import {type Ack,type Command,type CommandType,type RoomView} from '@bluff-house/shared';
import {createApp} from '../../apps/server/src/app.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';

const servers:ReturnType<typeof createApp>[]=[],sockets:Socket[]=[],directories:string[]=[];
afterEach(async()=>{
  for(const socket of sockets.splice(0))socket.disconnect();
  for(const server of servers.splice(0))await server.close();
  for(const directory of directories.splice(0)){
    if(!directory.startsWith(path.join(tmpdir(),'bluff-production-')))throw new Error('Unexpected temporary directory');
    await rm(directory,{recursive:true,force:true});
  }
});
const origin='http://bluff-production.local';
async function start(){let clock=1000;const server=createApp({origin,now:()=>clock,tickMs:100000});servers.push(server);const port=await server.listen(0);return {server,url:`http://127.0.0.1:${port}`,advance(ms:number){clock+=ms;server.manager.reconcile();}};}
async function guest(h:Awaited<ReturnType<typeof start>>){
  const response=await fetch(`${h.url}/api/guest`,{method:'POST',headers:{Origin:origin}});expect(response.status).toBe(200);
  const cookie=response.headers.get('set-cookie')!.split(';')[0]!,session=await fetch(`${h.url}/api/session`,{headers:{Cookie:cookie}}).then(r=>r.json()) as {playerId:string};
  const socket=io(h.url,{autoConnect:false,reconnection:false,transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie}});sockets.push(socket);
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect();});
  return {id:session.playerId,socket};
}
type Harness=Awaited<ReturnType<typeof start>>;type Guest=Awaited<ReturnType<typeof guest>>;
let serial=0;
const latencies:number[]=[];
async function send(h:Harness,p:Guest,type:CommandType,payload?:Record<string,unknown>,extra:Partial<Command>={}){
  const v=h.server.manager.snapshot(p.id),s=v?.party?.social,shadow=v?.party?.shadow;
  const command:Command={requestId:`production-${++serial}`,type,...(v?{roomInstanceId:v.instanceId,lobbyId:v.lobbyId,matchId:v.matchId,roundId:v.roundId,bettingId:v.bettingId,decisionId:v.decisionId,offerId:v.bluff?.id,auctionId:v.party?.auction.id,socialId:s?.id,socialSlotId:s?.slotId,duelId:s?.duel?.id,inviteId:s?.invites.find(i=>i.status==='pending'&&i.defenderId===p.id)?.id,dealOfferId:s?.dealInvites.find(i=>i.status==='pending'&&i.defenderId===p.id)?.id,dealId:s?.deal?.id,shadowId:shadow?.id,shadowClaimId:shadow?.claim?.id,chaosWindowId:v.phase==='HAND_CHAOS'?v.party?.chaos.handWindow?.id:v.party?.chaos.potTwist?.id}:{}),...(payload?{payload}:{}),...extra};
  const began=performance.now();const ack=await new Promise<Ack>((resolve,reject)=>p.socket.timeout(2000).emit('command',command,(error:Error|null,result:Ack)=>error?reject(error):resolve(result)));latencies.push(performance.now()-began);
  expect(ack,`${type}: ${ack.code}`).toMatchObject({status:'ok'});return ack;
}
async function table(h:Harness,people:Guest[],party:boolean){
  await send(h,people[0]!,'room:create',{username:'Host'});const code=h.server.manager.snapshot(people[0]!.id)!.code;
  for(const [i,p] of people.slice(1).entries())await send(h,p,'room:join',{username:`Guest ${i+1}`,roomCode:code});
  if(party){await send(h,people[0]!,'lobby:mode',{mode:'PARTY'});await send(h,people[0]!,'lobby:rounds',{rounds:6});}
  for(const p of people)await send(h,p,'lobby:ready',{ready:true});
  await send(h,people[0]!,'match:start');if(party)await send(h,people[0]!,'house:bid',{amount:50});
  return {people,view:()=>h.server.manager.snapshot(people[0]!.id)!,party,seenShoes:new Set<string>(),actedRounds:new Set<number>(),socialSlots:new Set<string>(),claimedRounds:new Set<number>(),chaosActivations:0};
}
type Table=Awaited<ReturnType<typeof table>>;
async function step(h:Harness,t:Table):Promise<boolean>{
  const v=t.view(),room=h.server.manager.roomFor(t.people[0]!.id)!;assertRoom(room);
  if(room.shoe.length){expect(room.shoe).toHaveLength(312);expect(new Set(room.shoe.map(c=>c.id)).size).toBe(312);t.seenShoes.add(room.roundId!);}
  const player=(id:string)=>t.people.find(p=>p.id===id)!;
  switch(v.phase){
    case 'BETTING':{
      if(t.actedRounds.has(v.round))return false;
      for(const p of t.people)await send(h,p,'bet:submit',{amount:50});t.actedRounds.add(v.round);
      // Use naturally earned cards only; neither shoes nor RNG are replaced.
      for(const p of t.people){const state=h.server.manager.snapshot(p.id)!,held=state.party?.chaos.inventories.find(i=>i.playerId===p.id)?.cards??[],card=state.party?.chaos.actions.find(a=>a.eligible&&held.some(c=>c.id===a.cardId&&(c.kind==='DOUBLE_DOWN'||c.kind==='POT_TWIST')));if(card){await send(h,p,'chaos:activate',{cardId:card.cardId});t.chaosActivations++;}}
      return true;
    }
    case 'POT_TWIST':{
      let changed=false;for(const p of t.people){const state=h.server.manager.snapshot(p.id)!;if(state.party?.chaos.optInEligible){await send(h,p,'chaos:optin');changed=true;}}return changed;
    }
    case 'HAND_CHAOS':{
      for(const p of t.people){const state=h.server.manager.snapshot(p.id)!,card=state.party?.chaos.actions.find(a=>a.eligible);if(card){const kind=state.party!.chaos.inventories.find(i=>i.playerId===p.id)!.cards.find(c=>c.id===card.cardId)!.kind;await send(h,p,'chaos:activate',{cardId:card.cardId,...(kind==='HAND_SWAP'?{targetId:state.party!.chaos.handTargets[0]}:{})});t.chaosActivations++;return true;}}return false;
    }
    case 'PLAYER_TURN':{
      const actor=player(v.activePlayerId!),mine=v.players.find(p=>p.id===actor.id)!;
      if(t.party&&!t.claimedRounds.has(v.round)&&!mine.bluffUsed&&mine.value&&!mine.value.soft&&mine.value.total>=12&&mine.value.total<=20){
        const caller=t.people.find(p=>p.id!==actor.id&&v.players.find(vp=>vp.id===p.id)!.available>=50);
        if(caller){await send(h,actor,'bluff:offer',{claimType:'DEALER_BUST',amount:50});await send(h,caller,'bluff:accept');t.claimedRounds.add(v.round);return true;}
      }
      await send(h,actor,'turn:stand');return true;
    }
    case 'SOCIAL':{
      const social=v.party!.social!;if(t.socialSlots.has(social.slotId))return false;t.socialSlots.add(social.slotId);
      if(social.slot===1&&v.round===1){await send(h,t.people[0]!,'duel:invite',{defenderId:t.people[1]!.id,amount:50});await send(h,t.people[1]!,'duel:accept',{game:'COIN',coinSide:'HEADS'});return true;}
      if(social.slot===1&&v.round===2){await send(h,t.people[0]!,'deal:offer',{defenderId:t.people[1]!.id,amount:50});await send(h,t.people[1]!,'deal:accept');return true;}
      return false;
    }
    case 'DEAL':for(const p of t.people.slice(0,2))if(!v.party!.social!.deal!.lockedPlayerIds.includes(p.id))await send(h,p,'deal:choose',{choice:'SPLIT'});return true;
    case 'SHADOW_DRAW':await send(h,player(v.party!.shadow!.activePlayerId!),'shadow:stand');return true;
    case 'SHADOW_CLAIM':await send(h,player(v.party!.shadow!.activePlayerId!),'shadow:claim',{declaredTotal:21});return true;
    default:return false;
  }
}
async function finish(h:Harness,tables:Table[]){
  for(let n=0;n<700&&tables.some(t=>t.view().phase!=='RESULTS');n++){
    let changed=false;for(const t of tables)if(t.view().phase!=='RESULTS')changed=await step(h,t)||changed;
    if(changed)continue;
    const due=tables.filter(t=>t.view().phase!=='RESULTS').map(t=>t.view()).filter(v=>v.deadline!==null);expect(due.length).toBeGreaterThan(0);
    h.advance(Math.min(...due.map(v=>v.deadline!-v.serverTime)));
  }
  for(const t of tables){
    const v=t.view(),r=h.server.manager.roomFor(t.people[0]!.id)!;expect(v.phase).toBe('RESULTS');expect(v.round).toBe(t.party?6:3);expect(t.seenShoes.size).toBe(t.party?6:3);
    expect(v.players.every(p=>p.committed===0&&p.reserved===0)).toBe(true);expect(v.results!.standings).toHaveLength(t.people.length);
    expect(v.players.reduce((sum,p)=>sum+p.balance,0)+(v.party?.bonusReserve??0)).toBe(r.initialChips+(v.party?.initialBonusReserve??0)+r.dealerNet);
    if(t.party){expect(v.party!.duelHistory).toHaveLength(1);expect(v.party!.dealHistory).toHaveLength(1);expect(v.party!.shadow!.status).toBe('settled');expect(v.party!.vault).toBe(0);expect(v.pendingClaims).toEqual([]);}
    const oldMatch=v.matchId;await send(h,t.people[0]!,'results:return');expect(t.view().phase).toBe('LOBBY');expect(t.view().players.every(p=>p.balance===1000&&!p.ready&&p.bluffWins===0)).toBe(true);expect(t.view().claimOutcomes).toEqual([]);
    for(const p of t.people)await send(h,p,'lobby:ready',{ready:true});await send(h,t.people[0]!,'match:start');expect(t.view().matchId).not.toBe(oldMatch);assertRoom(h.server.manager.roomFor(t.people[0]!.id)!);
  }
}

describe('production HTTP boundary without requiring prebuilt assets',()=>{
  it('serves assets/deep links separately from APIs and rejects malformed, oversized and test-control requests',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'bluff-production-'));directories.push(root);await mkdir(path.join(root,'assets'));await writeFile(path.join(root,'index.html'),'<!doctype html><html><body>Bluff static boundary</body></html>');await writeFile(path.join(root,'assets','app.js'),'globalThis.boundaryLoaded=true;');
    const server=createApp({origin,webRoot:root,tickMs:100000});servers.push(server);const port=await server.listen(0),url=`http://127.0.0.1:${port}`;
    for(const route of ['/','/table/ABCDEF']){const r=await fetch(url+route);expect(r.status).toBe(200);expect(r.headers.get('content-type')).toContain('text/html');expect(await r.text()).toContain('Bluff static boundary');}
    const asset=await fetch(url+'/assets/app.js');expect(asset.status).toBe(200);expect(asset.headers.get('content-type')).toContain('javascript');expect(await asset.text()).toContain('boundaryLoaded');
    for(const route of ['/api/missing','/api/test','/api/__test/advance','/api/control']){const r=await fetch(url+route);expect(r.status).toBe(404);expect(r.headers.get('content-type')).toContain('application/json');expect(r.headers.get('cache-control')).toBe('no-store');}
    for(const route of ['/api/test','/api/__test/advance','/__test/advance'])expect((await fetch(url+route,{method:'POST'})).status).toBe(404);
    expect((await fetch(url+'/assets/missing.js')).status).toBe(404);
    for(const body of ['{broken',JSON.stringify({oversized:'x'.repeat(5000)})]){const r=await fetch(url+'/api/guest',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body});expect(r.status).toBe(400);const text=await r.text();expect(text).not.toContain('stack');expect(text).not.toContain('oversized');expect(r.headers.get('set-cookie')).toBeNull();}
    expect((await fetch(url+'/api/guest',{method:'POST',headers:{Origin:origin+'/'}})).status).toBe(403);expect(server.manager.rooms.size).toBe(0);expect((await fetch(url+'/api/health')).status).toBe(200);
  });
  it('delivers restart messaging before disconnect and closes the listener',async()=>{
    const h=await start(),p=await guest(h);const message=new Promise<{message:string}>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('No shutdown message received')),2000);p.socket.once('recovery:error',value=>{clearTimeout(timeout);resolve(value);});});
    const disconnected=new Promise<void>(resolve=>p.socket.once('disconnect',()=>resolve()));await h.server.close();servers.splice(servers.indexOf(h.server),1);expect((await message).message).toContain('restarting');await disconnected;await expect(fetch(h.url+'/api/health')).rejects.toThrow();
  });
});
describe('real-shoe end-to-end transport integration',()=>{
  it.each([false,true])('completes and replays a two-player table (Party=%s) with production RNG',async party=>{const h=await start(),people=await Promise.all([guest(h),guest(h)]),t=await table(h,people,party);await finish(h,[t]);},15000);
  it('completes two six-seat tables with twelve real sockets and records representative observations',async()=>{
    latencies.length=0;const started=performance.now(),h=await start(),people=await Promise.all(Array.from({length:12},()=>guest(h)));let snapshots=0,maximumPayloadBytes=0;
    for(const p of people)p.socket.on('room:state',(v:RoomView)=>{snapshots++;const json=JSON.stringify(v);maximumPayloadBytes=Math.max(maximumPayloadBytes,Buffer.byteLength(json));expect(json).not.toContain('"proof":');expect(json).not.toContain('"lockedHands":');expect(json).not.toContain('"shoe":');});
    const classic=await table(h,people.slice(0,6),false),party=await table(h,people.slice(6),true);await finish(h,[classic,party]);
    expect(h.server.manager.rooms.size).toBe(2);expect(h.server.manager.membership.size).toBe(12);expect(snapshots).toBeGreaterThan(100);expect(maximumPayloadBytes).toBeGreaterThan(0);expect(h.server.manager.records.size).toBeLessThan(100000);
    const sorted=[...latencies].sort((a,b)=>a-b),metrics={description:'One local representative workload; no capacity or internet-latency guarantee.',guests:12,rooms:2,seatsPerRoom:6,completedRounds:{classic:3,party:6},commands:latencies.length,snapshots,maximumPayloadBytes,ackMedianMs:sorted[Math.floor(sorted.length/2)],ackP95Ms:sorted[Math.floor(sorted.length*.95)],observedElapsedMs:performance.now()-started,requestRecords:h.server.manager.records.size,partyChaosActivations:party.chaosActivations,partySettledClaims:party.claimedRounds.size};
    await mkdir('test-results',{recursive:true});await writeFile('test-results/production-load.json',JSON.stringify(metrics,null,2));console.info(JSON.stringify(metrics));
  },20000);
});
