import {afterEach,describe,expect,it} from 'vitest';
import {io,type Socket} from 'socket.io-client';
import {VOICE_STATUS,type Ack,type Command} from '@bluff-house/shared';
import {createApp} from '../../apps/server/src/app.js';
import {fixture,shoe} from '../fixtures/core.js';

describe('unavailable voice exposes no production authorization or media controls',()=>{
  it('reports the unverified device/network scope without claiming browser failure or a working room voice feature',()=>{
    expect(VOICE_STATUS).toEqual({available:false,status:'CONNECTIVITY_UNVERIFIED',message:'Room voice is unavailable while device and network connectivity remain unverified. No microphone is requested.'});
  });
  it('rejects voice commands for host, another room and no membership without mutating game decisions, clocks or chips',()=>{
    const f=fixture();f.start();f.bet();f.deal();expect(f.send('other-room','room:create',{username:'Other Room'}).status).toBe('ok');const before=structuredClone(f.room()),other=structuredClone(f.manager.roomFor('other-room'));
    for(const actor of [f.host,'other-room','not-a-member'])for(const type of ['voice:join','voice:signal','voice:mute','voice:leave']){const command={...f.command(actor,'state:sync'),type,roomInstanceId:f.view().instanceId,payload:{targetId:f.actors[1],signal:'test-only-opaque-signal'}};expect(f.manager.command(actor,command).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.manager.roomFor('other-room')).toEqual(other);}expect(f.send(f.host,'turn:hit').status).toBe('ok');
  });
  it('cannot enable an unavailable voice setting through configuration or create/quickplay authority fields',()=>{
    const f=fixture({mode:'PARTY'}),before=structuredClone(f.room()),v=f.view();for(const payload of [{settings:{...v.settings,voice:true},rounds:v.roundLimit,finale:v.finaleEnabled,visibility:v.visibility},{settings:v.settings,rounds:v.roundLimit,finale:v.finaleEnabled,visibility:v.visibility,voice:true}]){expect(f.send(f.host,'lobby:settings',payload).status).toBe('rejected');expect(f.room()).toEqual(before);}expect(f.send('new-guest','room:create',{username:'New Guest',voice:true}).status).toBe('rejected');expect(f.send('new-guest','room:quickplay',{username:'New Guest',preset:'PARTY',voice:true}).status).toBe('rejected');expect(f.manager.membership.has('new-guest')).toBe(false);
  });
});

describe('real authenticated sockets never relay unsupported voice traffic',()=>{
  const sockets:Socket[]=[];let server:ReturnType<typeof createApp>|undefined;
  afterEach(async()=>{for(const socket of sockets.splice(0))socket.disconnect();await server?.close();server=undefined;});
  it('rejects unauthenticated connections and cross-room voice commands while ignoring arbitrary signaling events',async()=>{
    const origin='http://localhost:42347';server=createApp({origin,now:()=>1000,shoe,tickMs:100000});const port=await server.listen(0),url=`http://127.0.0.1:${port}`;let serial=0;
    const connect=async(cookie?:string)=>{const socket=io(url,{autoConnect:false,reconnection:false,transports:['websocket'],extraHeaders:{Origin:origin,...(cookie?{Cookie:cookie}:{})}});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);socket.connect();});return socket;};
    await expect(connect()).rejects.toThrow(/Session unavailable/i);
    const guests=await Promise.all(Array.from({length:3},async()=>{const r=await fetch(`${url}/api/guest`,{method:'POST',headers:{Origin:origin}}),cookie=r.headers.get('set-cookie')!.split(';')[0]!,session=await fetch(`${url}/api/session`,{headers:{Cookie:cookie}}).then(r=>r.json()) as {playerId:string};return {id:session.playerId,socket:await connect(cookie)};}));
    const send=(guest:typeof guests[number],type:string,payload?:Record<string,unknown>)=>{const v=server!.manager.snapshot(guest.id);const command={requestId:`voice-request-${++serial}`,type,...(v?{roomInstanceId:v.instanceId,lobbyId:v.lobbyId,matchId:v.matchId}:{}),...(payload?{payload}:{})};return new Promise<Ack>((resolve,reject)=>guest.socket.timeout(1500).emit('command',command,(error:Error|null,ack:Ack)=>error?reject(error):resolve(ack)));};
    expect((await send(guests[0],'room:create',{username:'Host Guest'})).status).toBe('ok');const room=server.manager.snapshot(guests[0].id)!;expect((await send(guests[1],'room:join',{username:'Room Guest',roomCode:room.code})).status).toBe('ok');expect((await send(guests[2],'room:create',{username:'Other Room'})).status).toBe('ok');
    const relayed:string[]=[];for(const guest of guests)guest.socket.onAny(event=>{if(event.startsWith('voice:'))relayed.push(event);});const before=[...server.manager.rooms.values()].map(r=>structuredClone(r));
    for(const guest of guests){guest.socket.emit('voice:signal',{roomInstanceId:room.instanceId,targetId:guests[1].id,signal:'opaque-test-only-signal'});expect((await send(guest,'voice:signal',{targetId:guests[1].id,signal:'opaque-test-only-signal'})).status).toBe('rejected');expect(server.io.sockets.sockets.get(guest.socket.id!)!.listenerCount('voice:signal')).toBe(0);}await new Promise(resolve=>setTimeout(resolve,30));expect(relayed).toEqual([]);expect([...server.manager.rooms.values()]).toEqual(before);
  });
});
