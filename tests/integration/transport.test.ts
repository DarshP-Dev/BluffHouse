import {Agent,request} from 'node:http';
import {createConnection} from 'node:net';
import {afterEach,describe,expect,it} from 'vitest';
import {io,type Socket} from 'socket.io-client';
import type {Ack,Command,SessionResponse} from '@bluff-house/shared';
import {createApp,type AppOptions} from '../../apps/server/src/app.js';
import {shoe} from '../fixtures/core.js';

const lanOrigin='http://192.168.1.42:5173';
const lanHost=new URL(lanOrigin).host;
const servers:ReturnType<typeof createApp>[]=[];
const sockets:Socket[]=[];
const agents:Agent[]=[];
afterEach(async()=>{for(const socket of sockets.splice(0))socket.disconnect();for(const server of servers.splice(0))await server.close();for(const agent of agents.splice(0))agent.destroy();});
async function start(options:AppOptions={}){
  const server=createApp({origin:lanOrigin,shoe,now:()=>1000,tickMs:10000,...options});servers.push(server);
  const port=await server.listen(0);return {server,url:`http://127.0.0.1:${port}`};
}
function http(url:string,path:string,headers:Record<string,string>={},method='GET'){
  return new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;text:string}>((resolve,reject)=>{
    const req=request(new URL(path,url),{method,headers},response=>{
      const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));
      response.on('end',()=>resolve({status:response.statusCode!,headers:response.headers,text:Buffer.concat(chunks).toString('utf8')}));
    });req.on('error',reject);req.end();
  });
}
async function guest(url:string,origin=lanOrigin){
  const response=await http(url,'/api/guest',{Origin:origin},'POST');expect(response.status).toBe(200);
  const setCookie=response.headers['set-cookie']?.[0];expect(Boolean(setCookie)).toBe(true);
  const cookie=setCookie!.split(';')[0]!;
  const session=JSON.parse((await http(url,'/api/session',{Cookie:cookie})).text) as SessionResponse;
  expect(session.authenticated).toBe(true);return {cookie,session,setCookie:setCookie!};
}
async function connect(url:string,headers:Record<string,string>,transport:'polling'|'websocket'='polling',agent?:Agent){
  const socket=io(url,{autoConnect:false,reconnection:false,timeout:2000,transports:[transport],extraHeaders:headers,transportOptions:{polling:{agent}}});sockets.push(socket);
  await new Promise<void>((resolve,reject)=>{socket.once('connect',()=>resolve());socket.once('connect_error',reject);socket.connect();});return socket;
}
const send=(socket:Socket,command:Command)=>new Promise<Ack>((resolve,reject)=>socket.timeout(1500).emit('command',command,(error:Error|null,ack:Ack)=>error?reject(error):resolve(ack)));

describe('HTTP LAN polling admission',()=>{
  it('creates a room through authenticated polling without Origin or Fetch Metadata when Referer and Host match',async()=>{
    const {server,url}=await start(),a=await guest(url);
    // Route the LAN URL into this test's loopback listener without changing its
    // browser-facing Host. The Node XHR transport derives Host from its URL.
    const agent=new Agent();agent.createConnection=()=>createConnection({host:'127.0.0.1',port:Number(new URL(url).port)});agents.push(agent);
    const socket=await connect(lanOrigin,{Referer:`${lanOrigin}/play`,Cookie:a.cookie},'polling',agent);
    expect(socket.io.engine.transport.name).toBe('polling');
    expect(await send(socket,{requestId:'lan-create-room',type:'room:create',payload:{username:'LAN Host'}})).toMatchObject({status:'ok'});
    expect(server.manager.snapshot(a.session.playerId!)).toMatchObject({phase:'LOBBY',hostId:a.session.playerId});
    expect(a.setCookie.includes('HttpOnly')).toBe(true);expect(a.setCookie.includes('SameSite=Lax')).toBe(true);expect(a.setCookie.includes('Secure')).toBe(false);
  });
  it('accepts the configured exact Origin on a real authenticated WebSocket',async()=>{
    const {url}=await start(),a=await guest(url);const socket=await connect(url,{Origin:lanOrigin,Cookie:a.cookie},'websocket');
    expect(socket.connected).toBe(true);expect(socket.io.engine.transport.name).toBe('websocket');
  });
  it('admits a missing-Origin request with matching Host and secure-context same-origin metadata',async()=>{
    const {url}=await start();const result=await http(url,'/socket.io/?EIO=4&transport=polling',{Host:lanHost,'Sec-Fetch-Site':'same-origin'});
    expect(result.status).toBe(200);expect(result.text.startsWith('0')).toBe(true);
  });
  it.each([
    ['foreign Origin overrides matching Referer',{Host:lanHost,Origin:'http://attacker.invalid',Referer:`${lanOrigin}/`,'Sec-Fetch-Site':'same-origin'}],
    ['missing all browser origin evidence',{Host:lanHost}],
    ['wrong Host with matching Referer',{Host:'attacker.invalid:5173',Referer:`${lanOrigin}/`}],
    ['wrong Referer with matching Host',{Host:lanHost,Referer:'http://attacker.invalid/'}],
    ['malformed Referer',{Host:lanHost,Referer:'not a URL'}],
    ['cross-site metadata overrides matching Referer',{Host:lanHost,Referer:`${lanOrigin}/`,'Sec-Fetch-Site':'cross-site'}],
    ['same-site is not same-origin',{Host:lanHost,Referer:`${lanOrigin}/`,'Sec-Fetch-Site':'same-site'}],
    ['wrong Host despite same-origin metadata',{Host:'attacker.invalid:5173','Sec-Fetch-Site':'same-origin'}],
  ] satisfies [string,Record<string,string>][])('rejects %s',async(_name,headers)=>{
    const {url}=await start(),a=await guest(url);const result=await http(url,'/socket.io/?EIO=4&transport=polling',{...headers,Cookie:a.cookie});
    expect(result.status).toBe(403);expect(result.headers['set-cookie']).toBeUndefined();
  });
});

describe('production cookie and process boundary',()=>{
  it('requires HTTPS in production and marks production guest cookies Secure and HttpOnly',async()=>{
    expect(()=>createApp({origin:lanOrigin,production:true})).toThrow('Production PUBLIC_ORIGIN must use HTTPS');
    const origin='https://bluff-house.example', {url}=await start({origin,production:true}),a=await guest(url,origin);
    expect(a.setCookie.includes('Secure')).toBe(true);expect(a.setCookie.includes('HttpOnly')).toBe(true);expect(a.setCookie.includes('SameSite=Lax')).toBe(true);
  });
  it('rejects a prior process cookie without creating a replacement guest or bankroll',async()=>{
    const original=await start(),a=await guest(original.url),socket=await connect(original.url,{Origin:lanOrigin,Cookie:a.cookie},'websocket');
    expect(await send(socket,{requestId:'before-restart-room',type:'room:create',payload:{username:'Original'}})).toMatchObject({status:'ok'});
    const oldId=a.session.playerId!,oldInstance=original.server.instanceId;await original.server.close();servers.splice(servers.indexOf(original.server),1);
    const replacement=await start();expect(replacement.server.instanceId).not.toBe(oldInstance);
    const response=await http(replacement.url,'/api/session',{Cookie:a.cookie}),session=JSON.parse(response.text) as SessionResponse;
    expect(session).toMatchObject({authenticated:false,serverInstanceId:replacement.server.instanceId});expect(session.error).toContain('no longer available');
    expect(session.playerId).toBeUndefined();expect(response.headers['set-cookie']).toBeUndefined();expect(replacement.server.manager.snapshot(oldId)).toBeNull();
    await expect(connect(replacement.url,{Origin:lanOrigin,Cookie:a.cookie},'websocket')).rejects.toThrow('Session unavailable');
    expect(replacement.server.manager.rooms.size).toBe(0);expect(replacement.server.manager.membership.size).toBe(0);
  });
});

describe('late callbacks from replaced server controllers',()=>{
  it('rejects a captured old command callback and ignores captured old disconnect callbacks after takeover',async()=>{
    const {server,url}=await start(),a=await guest(url),old=await connect(url,{Origin:lanOrigin,Cookie:a.cookie},'websocket');
    expect(await send(old,{requestId:'old-controller-create',type:'room:create',payload:{username:'Host'}})).toMatchObject({status:'ok'});
    const initial=server.manager.snapshot(a.session.playerId!)!,oldServer=server.io.sockets.sockets.get(old.id!)!;
    // Capture the actual installed server listeners: emitting on a disconnected
    // client would never exercise the stale server-generation guards.
    const oldCommands=oldServer.listeners('command'),oldDisconnects=oldServer.listeners('disconnect');
    expect(oldCommands).toHaveLength(1);expect(oldDisconnects.length).toBeGreaterThan(0);
    const replaced=new Promise<void>(resolve=>old.once('disconnect',()=>resolve()));
    const current=await connect(url,{Origin:lanOrigin,Cookie:a.cookie},'websocket');await replaced;
    const before=structuredClone(server.manager.roomFor(a.session.playerId!)!);let staleAck:Ack|undefined;
    oldCommands[0]!.call(oldServer,{requestId:'late-old-ready',type:'lobby:ready',roomInstanceId:initial.instanceId,lobbyId:initial.lobbyId,payload:{ready:true}},(ack:Ack)=>{staleAck=ack;});
    for(const listener of oldDisconnects)listener.call(oldServer,'transport close');
    expect(staleAck).toMatchObject({status:'rejected',code:'SESSION_REPLACED'});expect(server.manager.roomFor(a.session.playerId!)!).toEqual(before);
    expect(server.manager.snapshot(a.session.playerId!)!.players[0]).toMatchObject({connected:true,ready:false});expect(before.hostDeadline).toBeNull();expect(before.recoveryDeadline).toBeNull();
    expect(await send(current,{requestId:'new-controller-ready',type:'lobby:ready',roomInstanceId:initial.instanceId,lobbyId:initial.lobbyId,payload:{ready:true}})).toMatchObject({status:'ok'});
    expect(server.manager.snapshot(a.session.playerId!)!.players[0]).toMatchObject({connected:true,ready:true});
  });
});
