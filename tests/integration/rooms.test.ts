import {afterEach,describe,expect,it} from 'vitest';
import {io,type Socket} from 'socket.io-client';
import type {Ack,Command,RoomView,SessionResponse} from '@bluff-house/shared';
import {createApp} from '../../apps/server/src/app.js';
import {fixture,shoe} from '../fixtures/core.js';

describe('room admission and lobby authority',()=>{
  it('creates one room with a six-character code and rejects duplicate membership',()=>{
    const f=fixture({players:1});
    expect(f.view()).toMatchObject({phase:'LOBBY',hostId:f.host,round:0});
    expect(f.view().code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(f.view().players[0]).toMatchObject({name:'Player 1',balance:1000,ready:false});
    expect(f.send(f.host,'room:create',{username:'Another'})).toMatchObject({status:'rejected',code:'ALREADY_IN_ROOM'});
    expect(f.manager.rooms.size).toBe(1);
  });

  it('validates names and room codes, rejects duplicate names case-insensitively and enforces capacity',()=>{
    const f=fixture();
    const join=(name:unknown,code:unknown=f.view().code)=>f.send('visitor','room:join',{username:name,roomCode:code});
    expect(join('x')).toMatchObject({status:'rejected',code:'INVALID_NAME'});
    expect(join('<script>')).toMatchObject({status:'rejected',code:'INVALID_NAME'});
    expect(join('Visitor','bad')).toMatchObject({status:'rejected',code:'INVALID_CODE'});
    const missing=f.view().code==='AAAAAA'?'BBBBBB':'AAAAAA';
    expect(join('Visitor',missing)).toMatchObject({status:'rejected',code:'ROOM_MISSING'});
    expect(join(' pLaYeR 1 ')).toMatchObject({status:'rejected',code:'NAME_TAKEN'});
    expect(f.manager.membership.has('visitor')).toBe(false);
    expect(join('Visitor',` ${f.view().code.toLowerCase()} `).status).toBe('ok');
    for(let i=4;i<=6;i++)expect(f.send(`extra-${i}`,'room:join',{username:`Extra ${i}`,roomCode:f.view().code}).status).toBe('ok');
    const before=structuredClone(f.room());
    expect(f.send('seventh','room:join',{username:'Seventh',roomCode:f.view().code})).toMatchObject({status:'rejected',code:'ROOM_FULL'});
    expect(f.room()).toEqual(before);expect(f.manager.membership.has('seventh')).toBe(false);
  });

  it('requires two connected ready players and the actual host to start',()=>{
    const f=fixture({players:1});
    expect(f.send(f.host,'match:start')).toMatchObject({status:'rejected',code:'NOT_ENOUGH_PLAYERS'});
    expect(f.send('other','room:join',{username:'Other',roomCode:f.view().code}).status).toBe('ok');
    expect(f.send('other','match:start')).toMatchObject({status:'rejected',code:'NOT_HOST'});
    expect(f.send(f.host,'match:start')).toMatchObject({status:'rejected',code:'NOT_READY'});
    expect(f.send(f.host,'lobby:ready',{ready:'true'})).toMatchObject({status:'rejected',code:'INVALID_READY'});
    expect(f.send(f.host,'lobby:ready',{ready:true}, {lobbyId:'old-lobby'})).toMatchObject({status:'rejected',code:'STALE_LOBBY'});
    f.send(f.host,'lobby:ready',{ready:true});
    expect(f.send(f.host,'match:start')).toMatchObject({status:'rejected',code:'NOT_READY'});
    f.send('other','lobby:ready',{ready:true});
    expect(f.send(f.host,'match:start').status).toBe('ok');
    expect(f.view()).toMatchObject({phase:'BETTING',round:1});
    expect(f.send('late','room:join',{username:'Late',roomCode:f.view().code})).toMatchObject({status:'rejected',code:'ROOM_IN_PROGRESS'});
  });

  it('honors server room capacity without disturbing an existing room',()=>{
    const f=fixture({players:1,maxRooms:1});const before=structuredClone(f.room());
    expect(f.send('new-host','room:create',{username:'New Host'})).toMatchObject({status:'rejected',code:'ROOM_LIMIT'});
    expect(f.room()).toEqual(before);expect(f.manager.membership.has('new-host')).toBe(false);
  });
});

describe('real HTTP and Socket.IO session boundary',()=>{
  const origin='http://localhost:41234';
  const sockets:Socket[]=[];let server:ReturnType<typeof createApp>|undefined;
  afterEach(async()=>{for(const socket of sockets.splice(0))socket.disconnect();await server?.close();server=undefined;});
  const start=async()=>{server=createApp({origin,shoe,now:()=>1000,tickMs:10000});const port=await server.listen(0);return `http://127.0.0.1:${port}`;};
  const guest=async(url:string)=>{
    const response=await fetch(`${url}/api/guest`,{method:'POST',headers:{Origin:origin}});
    expect(response.status).toBe(200);
    const setCookie=response.headers.get('set-cookie')!;
    // Test cookie properties without printing or persisting the credential value.
    expect(setCookie.includes('HttpOnly')).toBe(true);expect(setCookie.includes('SameSite=Lax')).toBe(true);
    const cookie=setCookie.split(';')[0]!;
    const session=await fetch(`${url}/api/session`,{headers:{Cookie:cookie}}).then(r=>r.json()) as SessionResponse;
    expect(session.authenticated).toBe(true);expect(session.playerId).toBeTruthy();
    const sessionText=JSON.stringify(session);expect(sessionText.includes(cookie.split('=')[1]!)).toBe(false);
    return {cookie,session};
  };
  const connect=async(url:string,cookie?:string,requestedOrigin=origin)=>{
    const socket=io(url,{autoConnect:false,reconnection:false,transports:['websocket'],extraHeaders:{Origin:requestedOrigin,...(cookie?{Cookie:cookie}:{})}});sockets.push(socket);
    await new Promise<void>((resolve,reject)=>{socket.once('connect',()=>resolve());socket.once('connect_error',reject);socket.connect();});return socket;
  };
  const send=(socket:Socket,command:Command)=>new Promise<Ack>((resolve,reject)=>{socket.timeout(1500).emit('command',command,(error:Error|null,ack:Ack)=>error?reject(error):resolve(ack));});

  it('uses authenticated sockets for a full create/join/ready/start/bet exchange',async()=>{
    const url=await start(),a=await guest(url),b=await guest(url);
    const host=await connect(url,a.cookie),other=await connect(url,b.cookie);
    let hostView:RoomView|undefined,otherView:RoomView|undefined;
    host.on('room:state',(view:RoomView)=>{hostView=view;});other.on('room:state',(view:RoomView)=>{otherView=view;});
    expect(await send(host,{requestId:'create-host',type:'room:create',payload:{username:'Host'}})).toMatchObject({status:'ok'});
    await expect.poll(()=>hostView?.phase).toBe('LOBBY');
    expect(await send(other,{requestId:'join-guest',type:'room:join',payload:{username:'Guest',roomCode:hostView!.code}})).toMatchObject({status:'ok'});
    await expect.poll(()=>hostView?.players.length).toBe(2);await expect.poll(()=>otherView?.players.length).toBe(2);
    const context=()=>({roomInstanceId:hostView!.instanceId,lobbyId:hostView!.lobbyId});
    expect(await send(other,{requestId:'guest-start',type:'match:start',...context()})).toMatchObject({status:'rejected',code:'NOT_HOST'});
    expect(await send(host,{requestId:'ready-host',type:'lobby:ready',...context(),payload:{ready:true}})).toMatchObject({status:'ok'});
    expect(await send(other,{requestId:'ready-guest',type:'lobby:ready',...context(),payload:{ready:true}})).toMatchObject({status:'ok'});
    expect(await send(host,{requestId:'start-match',type:'match:start',...context()})).toMatchObject({status:'ok'});
    await expect.poll(()=>otherView?.phase).toBe('BETTING');
    expect(hostView!.matchId).toBe(otherView!.matchId);expect(hostView!.roundId).toBe(otherView!.roundId);
    const bet:Command={requestId:'funded-wager',type:'bet:submit',roomInstanceId:hostView!.instanceId,matchId:hostView!.matchId,roundId:hostView!.roundId,bettingId:hostView!.bettingId,payload:{amount:150}};
    const result=await send(host,bet);expect(result.status).toBe('ok');expect(await send(host,bet)).toEqual(result);
    await expect.poll(()=>otherView?.players[0]?.reserved).toBe(150);
    expect(otherView!.players[0]).toMatchObject({balance:1000,available:850,committed:0});
    expect(hostView!.viewerId).toBe(a.session.playerId);expect(otherView!.viewerId).toBe(b.session.playerId);
  });

  it('rejects untrusted origins and sockets without a session',async()=>{
    const url=await start();
    const denied=await fetch(`${url}/api/guest`,{method:'POST',headers:{Origin:'https://untrusted.invalid'}});
    expect(denied.status).toBe(403);expect(denied.headers.get('set-cookie')).toBeNull();
    await expect(connect(url)).rejects.toThrow('Session unavailable');
    const a=await guest(url);await expect(connect(url,a.cookie,'https://untrusted.invalid')).rejects.toThrow();
  });

  it('replaces an older controller, recovers the same room and prevents stale socket mutations',async()=>{
    const url=await start(),a=await guest(url),old=await connect(url,a.cookie);
    expect(await send(old,{requestId:'create-table',type:'room:create',payload:{username:'Host'}})).toMatchObject({status:'ok'});
    const initial=server!.manager.snapshot(a.session.playerId!)!;
    const replaced=new Promise<string>(resolve=>old.once('session:replaced',(value:{message:string})=>resolve(value.message)));
    const disconnected=new Promise<void>(resolve=>old.once('disconnect',()=>resolve()));
    const current=await connect(url,a.cookie);expect(await replaced).toBe('Session opened elsewhere.');await disconnected;
    const before=structuredClone(server!.manager.roomFor(a.session.playerId!)!);
    // socket.volatile avoids client-side buffering, so this specifically attempts an obsolete live controller.
    old.volatile.emit('command',{requestId:'stale-controller',type:'lobby:ready',roomInstanceId:initial.instanceId,lobbyId:initial.lobbyId,payload:{ready:true}},()=>{});
    expect(await send(current,{requestId:'sync-current',type:'state:sync'})).toMatchObject({status:'ok'});
    expect(server!.manager.roomFor(a.session.playerId!)!).toEqual(before);
    expect(server!.manager.snapshot(a.session.playerId!)!.players[0]!.connected).toBe(true);
    expect(await send(current,{requestId:'ready-current',type:'lobby:ready',roomInstanceId:initial.instanceId,lobbyId:initial.lobbyId,payload:{ready:true}})).toMatchObject({status:'ok'});
    expect(server!.manager.snapshot(a.session.playerId!)!.players[0]!.ready).toBe(true);
    expect(server!.manager.rooms.size).toBe(1);
  });
});
