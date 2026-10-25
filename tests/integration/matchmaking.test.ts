import {afterEach,describe,expect,it} from 'vitest';
import {io,type Socket} from 'socket.io-client';
import {defaultSettings,type Command,type CommandType,type Ack} from '@bluff-house/shared';
import {RoomManager} from '../../apps/server/src/rooms.js';
import {createApp} from '../../apps/server/src/app.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {shoe} from '../fixtures/core.js';

function harness(maxRooms=20){let serial=0,requests=0;const manager=new RoomManager('matchmaking-test',{now:()=>1000,id:()=>`entity-${++serial}`,shoe,randomIndex:()=>0},maxRooms);
  const command=(actor:string,type:CommandType,payload?:Record<string,unknown>,extra:Partial<Command>={}):Command=>{const v=manager.snapshot(actor);return {requestId:`request-${++requests}`,type,...(v?{roomInstanceId:v.instanceId,lobbyId:v.lobbyId,matchId:v.matchId}:{}),...(payload?{payload}:{}),...extra};};
  const send=(actor:string,type:CommandType,payload?:Record<string,unknown>,extra:Partial<Command>={})=>manager.command(actor,command(actor,type,payload,extra));
  const quick=(actor:string,username=actor,preset='CLASSIC')=>send(actor,'room:quickplay',{username,preset});return {manager,command,send,quick};
}

describe('compatible atomic public matchmaking',()=>{
  it.each([['CLASSIC','CLASSIC',3,false],['PARTY','PARTY',3,true],['PARTY_6','PARTY',6,true]] as const)('creates the exact public%s preset when no compatible lobby exists',(preset,mode,rounds,finale)=>{
    const h=harness();expect(h.quick('first-guest','First Guest',preset).status).toBe('ok');const v=h.manager.snapshot('first-guest')!;expect(v).toMatchObject({phase:'LOBBY',mode,roundLimit:rounds,finaleEnabled:finale,visibility:'PUBLIC',settings:defaultSettings(mode)});expect(h.manager.rooms.size).toBe(1);expect(h.quick('second-guest','Second Guest',preset).status).toBe('ok');expect(h.manager.snapshot('second-guest')!.instanceId).toBe(v.instanceId);expect(h.manager.rooms.size).toBe(1);assertRoom(h.manager.roomFor('first-guest')!);
  });
  it('serializes nine same-name entrants into six-seat lobbies without duplicate membership or displaced players',()=>{
    const h=harness(),actors=Array.from({length:9},(_,i)=>`guest-${i}`);for(const actor of actors)expect(h.quick(actor,'Same Guest').status).toBe('ok');expect(h.manager.rooms.size).toBe(2);expect([...h.manager.rooms.values()].map(r=>r.players.length)).toEqual([6,3]);expect(h.manager.membership.size).toBe(9);expect(new Set([...h.manager.rooms.values()].flatMap(r=>r.players.map(p=>p.id))).size).toBe(9);for(const r of h.manager.rooms.values()){expect(new Set(r.players.map(p=>p.name.toLowerCase())).size).toBe(r.players.length);expect(r.players.map(p=>p.name)).toEqual(Array.from({length:r.players.length},(_,i)=>i?`Same Guest-${i+1}`:'Same Guest'));assertRoom(r);}
  });
  it.each(['abcdefghijklmnop','𐐀'.repeat(16)])('keeps collision suffixes inside the sixteen-codepoint username limit for%s',name=>{
    const h=harness();for(let n=0;n<6;n++)expect(h.quick(`guest-${n}`,name).status).toBe('ok');const names=[...h.manager.rooms.values()][0]!.players.map(p=>p.name);expect(names).toHaveLength(6);expect(new Set(names).size).toBe(6);expect(names.every(name=>Array.from(name).length<=16&&!/\p{Cs}/u.test(name))).toBe(true);expect(names[1]).toBe(Array.from(name).slice(0,14).join('')+'-2');
  });
  it('keeps same-guest retries and later Quick Play requests in exactly one existing room',()=>{
    const h=harness(),c=h.command('same-guest','room:quickplay',{username:'Original Guest',preset:'PARTY'}),ack=h.manager.command('same-guest',c);expect(ack.status).toBe('ok');const original=structuredClone(h.manager.roomFor('same-guest')!);expect(h.manager.command('same-guest',c)).toEqual(ack);for(let i=0;i<8;i++)expect(h.quick('same-guest','Other Name','CLASSIC').status).toBe('ok');expect(h.manager.roomFor('same-guest')).toEqual(original);expect(h.manager.membership.size).toBe(1);expect(h.manager.rooms.size).toBe(1);expect(h.manager.command('same-guest',{...c,payload:{username:'Changed',preset:'PARTY'}}).code).toBe('REQUEST_CONFLICT');
  });
  it('restores an existing private active membership without silently changing its name, preset or state',()=>{
    const h=harness();h.send('private-host','room:create',{username:'Private Host'});const v=h.manager.snapshot('private-host')!;h.send('private-other','room:join',{username:'Private Other',roomCode:v.code});h.send('private-host','lobby:ready',{ready:true});h.send('private-other','lobby:ready',{ready:true});h.send('private-host','match:start');const before=structuredClone(h.manager.roomFor('private-host')!);expect(h.quick('private-host','New Display Name','PARTY_6').status).toBe('ok');expect(h.manager.roomFor('private-host')).toEqual(before);expect(h.manager.rooms.size).toBe(1);expect(h.manager.membership.size).toBe(2);
  });
  it('excludes private, active, full and disconnected-host lobbies',()=>{
    const h=harness();h.send('private-host','room:create',{username:'Private Host'});expect(h.quick('public-host','Public Host').status).toBe('ok');const publicRoom=h.manager.roomFor('public-host')!;h.manager.presence('public-host',false);expect(h.quick('next-public','Next Public').status).toBe('ok');expect(h.manager.roomFor('next-public')!.instanceId).not.toBe(publicRoom.instanceId);const active=h.manager.roomFor('next-public')!;h.send('active-other','room:join',{username:'Active Other',roomCode:active.code});h.send('next-public','lobby:ready',{ready:true});h.send('active-other','lobby:ready',{ready:true});h.send('next-public','match:start');expect(h.quick('fresh-public','Fresh Public').status).toBe('ok');expect(h.manager.roomFor('fresh-public')!.phase).toBe('LOBBY');expect(h.manager.roomFor('fresh-public')!.instanceId).not.toBe(active.instanceId);expect(h.manager.roomFor('fresh-public')!.instanceId).not.toBe(h.manager.roomFor('private-host')!.instanceId);
  });
  it('matches only exact presets and excludes otherwise public custom settings or disabled finales',()=>{
    const h=harness();h.quick('party-host','Party Host','PARTY');const first=h.manager.snapshot('party-host')!;expect(h.send('party-host','lobby:settings',{settings:{...first.settings,chaos:false},rounds:3,finale:true,visibility:'PUBLIC'}).status).toBe('ok');h.quick('normal-party','Normal Party','PARTY');h.quick('long-party','Long Party','PARTY_6');h.quick('classic-host','Classic Host','CLASSIC');const rooms=new Set(['party-host','normal-party','long-party','classic-host'].map(id=>h.manager.snapshot(id)!.instanceId));expect(rooms.size).toBe(4);const normal=h.manager.snapshot('normal-party')!;expect(h.send('normal-party','lobby:settings',{settings:normal.settings,rounds:3,finale:false,visibility:'PUBLIC'}).status).toBe('ok');h.quick('another-party','Another Party','PARTY');expect(h.manager.snapshot('another-party')!.instanceId).not.toBe(normal.instanceId);
  });
  it('fails capacity exhaustion without creating or moving a guest, while still restoring an existing member',()=>{
    const h=harness(1);h.send('private-host','room:create',{username:'Private Host'});const before=structuredClone(h.manager.roomFor('private-host')!);expect(h.quick('new-guest','New Guest').status).toBe('rejected');expect(h.manager.membership.has('new-guest')).toBe(false);expect(h.manager.rooms.size).toBe(1);expect(h.manager.roomFor('private-host')).toEqual(before);expect(h.quick('private-host','Private Host','PARTY').status).toBe('ok');expect(h.manager.roomFor('private-host')).toEqual(before);
  });
  it.each([{username:'x',preset:'CLASSIC'},{username:'Good Guest',preset:'UNRELEASED'},{username:'Good Guest',preset:null},{username:'Good Guest'},{username:'Good Guest',preset:'CLASSIC',roomCode:'AAAAAA'},{username:'Good Guest',preset:'CLASSIC',balance:10000}])('rejects invalid Quick Play payload%j even when a guest already has membership',payload=>{
    const h=harness();h.send('current-guest','room:create',{username:'Current Guest'});const before=structuredClone(h.manager.roomFor('current-guest')!);expect(h.send('current-guest','room:quickplay',payload).status).toBe('rejected');expect(h.manager.roomFor('current-guest')).toEqual(before);expect(h.send('new-guest','room:quickplay',payload).status).toBe('rejected');expect(h.manager.membership.has('new-guest')).toBe(false);expect(h.manager.rooms.size).toBe(1);
  });
  it('keeps direct room creation private by default and accepts only explicitly released visibility values',()=>{
    const h=harness();expect(h.send('private-host','room:create',{username:'Private Host'}).status).toBe('ok');expect(h.manager.snapshot('private-host')!.visibility).toBe('PRIVATE');expect(h.send('public-host','room:create',{username:'Public Host',visibility:'PUBLIC'}).status).toBe('ok');expect(h.manager.snapshot('public-host')!.visibility).toBe('PUBLIC');expect(h.send('bad-host','room:create',{username:'Bad Host',visibility:'public'}).status).toBe('rejected');expect(h.manager.membership.has('bad-host')).toBe(false);
  });
});

describe('concurrent authenticated Socket.IO Quick Play admission',()=>{
  const sockets:Socket[]=[];let server:ReturnType<typeof createApp>|undefined;
  afterEach(async()=>{for(const socket of sockets.splice(0))socket.disconnect();await server?.close();server=undefined;});
  it('admits nine independent guest sessions concurrently without exceeding six seats or duplicating a membership',async()=>{
    const origin='http://localhost:42346';server=createApp({origin,now:()=>1000,shoe,tickMs:100000});const port=await server.listen(0),url=`http://127.0.0.1:${port}`;
    const guests=await Promise.all(Array.from({length:9},async()=>{const response=await fetch(`${url}/api/guest`,{method:'POST',headers:{Origin:origin}}),cookie=response.headers.get('set-cookie')!.split(';')[0]!,session=await fetch(`${url}/api/session`,{headers:{Cookie:cookie}}).then(r=>r.json()) as {playerId:string};const socket=io(url,{autoConnect:false,reconnection:false,transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie}});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect();});return {socket,id:session.playerId};}));
    const replies=await Promise.all(guests.map(({socket})=>new Promise<Ack>((resolve,reject)=>socket.timeout(2000).emit('command',{requestId:'quick-play-concurrent',type:'room:quickplay',payload:{username:'Same Guest',preset:'CLASSIC'}},(error:Error|null,ack:Ack)=>error?reject(error):resolve(ack)))));expect(replies.every(reply=>reply.status==='ok')).toBe(true);expect(server.manager.membership.size).toBe(9);const rooms=[...server.manager.rooms.values()];expect(rooms.map(r=>r.players.length).sort((a,b)=>a-b)).toEqual([3,6]);expect(new Set(rooms.flatMap(r=>r.players.map(p=>p.id))).size).toBe(9);for(const {id} of guests)expect(server.manager.snapshot(id)!.visibility).toBe('PUBLIC');for(const r of rooms){expect(r.players.length).toBeLessThanOrEqual(r.settings.maxPlayers);expect(new Set(r.players.map(p=>p.name.toLowerCase())).size).toBe(r.players.length);assertRoom(r);}
  });
});
