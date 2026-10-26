/** Run after npm run build: node --import tsx tests/scripts/production-smoke.ts.
 * The real compiled entry owns the normal clock, cryptographic shoe and signal
 * handler. This script uses only public HTTP and Socket.IO gameplay interfaces.
 */
import assert from 'node:assert/strict';
import {fork,type ChildProcess} from 'node:child_process';
import {access,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {io,type Socket} from 'socket.io-client';
import type {Ack,Command,CommandType,RoomView} from '@bluff-house/shared';

const houseMode=process.argv.includes('--house');
const root=fileURLToPath(new URL('../../',import.meta.url));
const sockets:Socket[]=[];
let child:ChildProcess|undefined,shutdownSent=false,serial=0,maximumPayloadBytes=0,observedSnapshots=0;
const latencies:number[]=[];
interface Guest {id:string;socket:Socket;view?:RoomView}
async function until<T>(read:()=>T|undefined|false,label:string,timeout=30000):Promise<T>{
  const deadline=performance.now()+timeout;
  while(performance.now()<deadline){const value=read();if(value!==undefined&&value!==false)return value;await pause(25);}
  throw new Error(`Timed out waiting for ${label}.`);
}
async function freePort(){const server=createServer();await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();assert(address&&typeof address==='object');await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return address.port;}
async function guest(url:string,origin:string):Promise<Guest>{
  const response=await fetch(url+'/api/guest',{method:'POST',headers:{Origin:origin}});assert.equal(response.status,200);const setCookie=response.headers.get('set-cookie')!;
  assert(setCookie.includes('HttpOnly')&&setCookie.includes('SameSite=Lax')&&setCookie.includes('Secure'));
  const cookie=setCookie.split(';')[0]!,session=await fetch(url+'/api/session',{headers:{Cookie:cookie}}).then(r=>r.json()) as {playerId:string};assert(session.playerId);
  const socket=io(url,{autoConnect:false,reconnection:false,transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie}});sockets.push(socket);const p:Guest={id:session.playerId,socket};
  socket.on('room:state',(view:RoomView)=>{
    p.view=view;observedSnapshots++;const json=JSON.stringify(view);maximumPayloadBytes=Math.max(maximumPayloadBytes,Buffer.byteLength(json));
    assert(!json.includes('"shoe":')&&!json.includes('"proof":')&&!json.includes('"lockedHands":')&&!json.includes(cookie));
  });
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect();});return p;
}
async function send(p:Guest,type:CommandType,payload?:Record<string,unknown>){
  const v=p.view,command:Command={requestId:`compiled-smoke-${++serial}`,type,...(v?{roomInstanceId:v.instanceId,lobbyId:v.lobbyId,matchId:v.matchId,roundId:v.roundId,bettingId:v.bettingId,decisionId:v.decisionId,offerId:v.bluff?.id,auctionId:v.party?.auction.id}:{}),...(payload?{payload}:{})};
  const started=performance.now();const ack=await new Promise<Ack>((resolve,reject)=>p.socket.timeout(3000).emit('command',command,(error:Error|null,value:Ack)=>error?reject(error):resolve(value)));latencies.push(performance.now()-started);assert.equal(ack.status,'ok',`${type}: ${ack.code}`);
  await until(()=>p.view&&(p.view.revision>=ack.currentRevision)&&p.view,`${type} authoritative snapshot`);return ack;
}
async function main(){
  await Promise.all([access(path.join(root,'apps/server/dist/index.js')),access(path.join(root,'apps/web/dist/index.html'))]);
  const began=performance.now(),port=await freePort(),url=`http://127.0.0.1:${port}`,origin='https://bluff-smoke.example';let ready=false,exitCode:number|null|undefined,stderr='';
  child=fork(fileURLToPath(new URL('../fixtures/compiled-entry.mjs',import.meta.url)),[],{cwd:root,execArgv:[],env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,NODE_ENV:'production'},stdio:['ignore','pipe','pipe','ipc']});
  child.on('message',message=>{if(message&&typeof message==='object'&&'type' in message&&message.type==='ready')ready=true;});
  child.stderr!.on('data',(chunk:Buffer)=>{stderr+=chunk.toString();});child.on('exit',code=>{exitCode=code;});
  await until(()=>{if(exitCode!==undefined)throw new Error('Compiled production entry exited before readiness.');return ready;},'compiled production listener');
  const health=await fetch(url+'/api/health');assert.equal(health.status,200);assert.equal(health.headers.get('cache-control'),'no-store');assert.equal((await health.json() as {ok:boolean}).ok,true);
  const document=await fetch(url+'/');assert.equal(document.status,200);const html=await document.text();assert(html.includes('Bluff House'));
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match=>match[1]!);assert(assets.some(asset=>asset.endsWith('.js'))&&assets.some(asset=>asset.endsWith('.css')));
  for(const asset of assets){const response=await fetch(url+asset);assert.equal(response.status,200);assert((await response.arrayBuffer()).byteLength>0);}
  const deep=await fetch(url+'/table/smoke');assert.equal(deep.status,200);assert.equal(await deep.text(),html);
  for(const route of ['/api/missing','/api/test/advance','/api/__test/clock']){const response=await fetch(url+route);assert.equal(response.status,404);assert(response.headers.get('content-type')?.includes('application/json'));}
  assert.equal((await fetch(url+'/api/guest',{method:'POST',headers:{Origin:'https://foreign.example'}})).status,403);
  const people=await Promise.all([guest(url,origin),guest(url,origin)]),host=people[0]!;
  await send(host,'room:create',{username:'Production Host'});await send(people[1]!,'room:join',{username:'Production Guest',roomCode:host.view!.code});
  await until(()=>host.view?.players.length===2&&host.view,'two-seat lobby');
  if(houseMode){
    await send(host,'lobby:mode',{mode:'PARTY'});await send(host,'lobby:finale',{enabled:false});
    const settings={...host.view!.settings,duels:false,overthrow:false,chaos:false,bounties:false,deals:false,doubleDown:false,extraClaims:false};
    await send(host,'lobby:settings',{settings,rounds:1,finale:false,visibility:'PRIVATE',startingChips:1000,bettingSeconds:5,turnSeconds:5});
  }
  for(const p of people)await send(p,'lobby:ready',{ready:true});await send(host,'match:start');
  if(houseMode){
    await until(()=>host.view?.phase==='HOUSE_AUCTION'&&host.view,'real House auction');await send(host,'house:bid',{amount:900});await send(people[1]!,'house:bid',{amount:0});
  }
  for(const p of people)await until(()=>p.view?.phase==='BETTING'&&p.view,'initial betting snapshot');
  if(houseMode){assert.equal(host.view!.party!.houseId,host.id);assert.equal(host.view!.party!.bank.bond.amount,100);assert.equal(host.view!.party!.bank.initial,4000);assert.equal(host.view!.players[0]!.available,0);}
  const matchId=host.view!.matchId,betRounds=new Set<number>(),seenCardRounds=new Set<number>();
  for(let count=0;count<1000&&host.view!.phase!=='RESULTS';count++){
    const v=host.view!;
    if(v.players.some(p=>p.hand.length)||v.dealer.length)seenCardRounds.add(v.round);
    if(v.phase==='BETTING'&&!betRounds.has(v.round)){for(const p of people.filter(person=>!houseMode||person.id!==v.party?.houseId)){await until(()=>p.view&&p.view.roundId===v.roundId&&p.view.phase==='BETTING'&&p.view,'current betting snapshot');await send(p,'bet:submit',{amount:50});}betRounds.add(v.round);}
    else if(v.phase==='PLAYER_TURN'){
      const actor=people.find(p=>p.id===v.activePlayerId)!;await until(()=>actor.view?.decisionId&&actor.view, 'active player decision');await send(actor,'turn:stand');
    }else if(houseMode&&v.phase==='DEALER_TURN'&&v.dealerControls.canStand){await send(host,'dealer:stand');}else await pause(100);
    assert.equal(host.view!.matchId,matchId);
    assert(host.view!.players.every(p=>Number.isSafeInteger(p.balance)&&p.balance>=0));
  }
  const result=host.view!;assert.equal(result.phase,'RESULTS');const expectedRounds=houseMode?1:3;assert.equal(result.round,expectedRounds);assert.equal(betRounds.size,expectedRounds);assert.equal(seenCardRounds.size,expectedRounds);assert.equal(result.results!.standings.length,2);assert(result.players.every(p=>p.committed===0&&p.reserved===0));
  if(houseMode){const bank=result.party!.bank;assert.equal(bank.rounds.length,1);assert.equal(bank.bond.amount,0);assert.equal(bank.committed,0);assert(result.players.every(p=>p.balance>=0));assert.equal(result.players.reduce((sum,p)=>sum+p.balance+p.committed,0)+bank.balance+result.party!.vault+result.party!.bonusReserve,6200);assert.equal(result.party!.vault,0);}
  const finalBalances=result.players.map(p=>({playerId:p.id,balance:p.balance}));await send(host,'results:return');assert.equal(host.view!.phase,'LOBBY');assert(host.view!.players.every(p=>p.balance===1000&&!p.ready));
  const restart=new Promise<{message:string}>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('No compiled-entry shutdown message received.')),3000);host.socket.once('recovery:error',value=>{clearTimeout(timeout);resolve(value);});});
  child.send('shutdown');shutdownSent=true;assert((await restart).message.includes('restarting'));await until(()=>exitCode!==undefined,'clean compiled-entry exit',10000);assert.equal(exitCode,0);await assert.rejects(fetch(url+'/api/health'));
  assert.equal(stderr,'','Production entry wrote unexpected stderr.');
  const ordered=[...latencies].sort((a,b)=>a-b),report={entry:'apps/server/dist/index.js',mode:'production HTTPS cookie/origin policy over loopback transport (proxy termination simulation)',clock:'unmodified production monotonic clock',randomness:'unmodified production crypto.randomInt six-deck shuffle',players:2,completedRounds:expectedRounds,game:houseMode?'Party player dealer:900-chip bid,finite Bank,bond,payout and replay':'Classic',dealerBank:houseMode?result.party!.bank:undefined,replay:'same room, fresh stacks and cleared readiness',assets:assets.length,commands:latencies.length,observedSnapshots,maximumPayloadBytes,ackMedianMs:ordered[Math.floor(ordered.length/2)],ackP95Ms:ordered[Math.floor(ordered.length*.95)],elapsedMs:performance.now()-began,finalBalances,shutdown:'actual entry SIGTERM handler, restart message observed, exit 0, listener closed',limitation:'Local smoke only; not hosted, physical-LAN or internet-capacity verification.'};
  await mkdir(path.join(root,'test-results'),{recursive:true});await writeFile(path.join(root,'test-results',houseMode?'house-production-smoke.json':'production-smoke.json'),JSON.stringify(report,null,2));console.info(JSON.stringify(report,null,2));
}
try{await main();}catch(error){console.error(error instanceof Error?error.message:'Production smoke failed.');process.exitCode=1;}
finally{
  for(const socket of sockets)socket.disconnect();
  if(child&&child.exitCode===null){if(!shutdownSent&&child.connected)child.send('shutdown');await pause(250);if(child.exitCode===null)child.kill();}
}
