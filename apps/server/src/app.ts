import express from 'express';
import {createServer} from 'node:http';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import path from 'node:path';
import {parse,serialize} from 'cookie';
import {Server,type Socket} from 'socket.io';
import {RoomManager} from './rooms.js';
import type {EngineOptions} from './game/state.js';
import type {Ack} from '@bluff-house/shared';

interface Guest {id:string;generation:number;socket?:Socket;lastSeen:number;hadRoom:boolean;requests:number;windowStart:number}
export interface AppOptions extends Partial<EngineOptions> {origin?:string;production?:boolean;maxRooms?:number;webRoot?:string;tickMs?:number}
export function createApp(options:AppOptions={}){
  const wallBase=Date.now(),monoBase=performance.now();
  const now=options.now??(()=>wallBase+performance.now()-monoBase);
  const instanceId=randomUUID(),origin=options.origin??'http://localhost:3000';
  const publicUrl=new URL(origin);
  if(publicUrl.origin!==origin||!['http:','https:'].includes(publicUrl.protocol))throw new Error('PUBLIC_ORIGIN must be an exact HTTP(S) origin without a path.');
  if(options.production&&!origin.startsWith('https://'))throw new Error('Production PUBLIC_ORIGIN must use HTTPS.');
  const app=express(),http=createServer(app),manager=new RoomManager(instanceId,{...options,now},options.maxRooms??20);
  const sessions=new Map<string,Guest>(),guests=new Map<string,Guest>();
  const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
  const cookieGuest=(cookie:string|undefined)=>{const token=parse(cookie??'').bh_session;return token?sessions.get(hash(token)):undefined;};
  const requestRates=new Map<string,{at:number;count:number}>();
  app.disable('x-powered-by');app.use(express.json({limit:'4kb'}));
  app.use('/api',(_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  app.get('/api/health',(_req,res)=>{res.json({ok:true,serverInstanceId:instanceId});});
  app.get('/api/session',(req,res)=>{
    manager.reconcile();const guest=cookieGuest(req.headers.cookie),hasCookie=Boolean(parse(req.headers.cookie??'').bh_session);
    if(!guest){res.json({authenticated:false,serverInstanceId:instanceId,...(hasCookie?{error:'This match is no longer available. Return to the menu to start again.'}:{})});return;}
    guest.lastSeen=now();const recoverable=Boolean(manager.roomFor(guest.id));
    res.json({authenticated:true,playerId:guest.id,recoverable,serverInstanceId:instanceId,...(guest.hadRoom&&!recoverable?{error:'This room is no longer available. Return to the menu.'}:{})});
  });
  app.post('/api/guest',(req,res)=>{
    if(req.headers.origin!==origin){res.status(403).json({error:'Origin not allowed.'});return;}
    const ip=req.socket.remoteAddress??'unknown',rate=requestRates.get(ip);
    if(!rate||now()-rate.at>60000)requestRates.set(ip,{at:now(),count:1});
    else if(++rate.count>60){res.status(429).json({error:'Too many entry requests. Try again shortly.'});return;}
    let guest=cookieGuest(req.headers.cookie);
    if(!guest){
      if(sessions.size>=2000){res.status(503).json({error:'The server is full. Try again later.'});return;}
      const token=randomBytes(32).toString('base64url');guest={id:randomUUID(),generation:0,lastSeen:now(),hadRoom:false,requests:0,windowStart:now()};sessions.set(hash(token),guest);guests.set(guest.id,guest);
      res.setHeader('Set-Cookie',serialize('bh_session',token,{httpOnly:true,sameSite:'lax',secure:options.production??false,path:'/'}));
    }
    guest.lastSeen=now();if(!manager.roomFor(guest.id))guest.hadRoom=false;
    res.json({ready:true,serverInstanceId:instanceId});
  });
  app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown API route.'}));
  // HTTP LAN polling omits Origin and Fetch Metadata. A same-origin Referer
  // plus exact Host admits it; a present foreign Origin is always rejected.
  const io=new Server(http,{maxHttpBufferSize:4096,cors:{origin,credentials:true},allowRequest:(req,done)=>{
    if(req.headers.origin){done(null,req.headers.origin===origin);return;}
    let sameReferer=false;try{sameReferer=new URL(req.headers.referer??'').origin===origin;}catch{}
    const site=req.headers['sec-fetch-site'];
    done(null,req.headers.host===publicUrl.host&&(site==='same-origin'||(!site&&sameReferer)));
  }});
  io.use((socket,next)=>{const guest=cookieGuest(socket.request.headers.cookie);if(!guest)return next(new Error('Session unavailable. Return to the menu.'));socket.data.guest=guest;next();});
  const sendState=(guest:Guest)=>{const snapshot=manager.snapshot(guest.id);if(snapshot)guest.socket?.emit('room:state',snapshot);};
  manager.onChange=room=>{for(const p of room.players){const guest=guests.get(p.id);if(guest&&!p.departed&&p.connected&&manager.membership.get(p.id)===room.instanceId)sendState(guest);}};
  manager.onReaction=(room,event)=>{for(const p of room.players)if(p.connected&&!p.departed&&manager.membership.get(p.id)===room.instanceId)guests.get(p.id)?.socket?.emit('room:reaction',{roomInstanceId:room.instanceId,event});};
  manager.onClose=room=>{for(const p of room.players)if(!p.departed)guests.get(p.id)?.socket?.emit('recovery:error',{message:'This inactive table has closed. Return to the menu to start again.'});};
  io.on('connection',socket=>{
    const guest=socket.data.guest as Guest,old=guest.socket,generation=++guest.generation;guest.socket=socket;guest.lastSeen=now();
    if(old&&old!==socket){old.emit('session:replaced',{message:'Session opened elsewhere.'});old.disconnect(true);}
    manager.presence(guest.id,true);sendState(guest);
    if(guest.hadRoom&&!manager.roomFor(guest.id))socket.emit('recovery:error',{message:'This match is no longer available. Return to the menu.'});
    socket.on('command',(raw:unknown,ack:unknown)=>{
      if(typeof ack!=='function')return;
      const reply=ack as (result:Ack)=>void;
      const requestId=raw&&typeof raw==='object'&&'requestId' in raw&&typeof raw.requestId==='string'?raw.requestId:'';
      if(guest.socket!==socket||guest.generation!==generation){reply({requestId,status:'rejected',code:'SESSION_REPLACED',message:'Session opened elsewhere.',currentRevision:0});return;}
      if(now()-guest.windowStart>=1000){guest.windowStart=now();guest.requests=0;}
      if(++guest.requests>30){reply({requestId,status:'rejected',code:'RATE_LIMITED',message:'Slow down for a moment.',currentRevision:manager.roomFor(guest.id)?.revision??0});return;}
      guest.lastSeen=now();const result=manager.command(guest.id,raw);if(manager.roomFor(guest.id))guest.hadRoom=true;
      if(result.status==='ok'&&raw&&typeof raw==='object'&&'type' in raw&&raw.type==='room:leave'){guest.hadRoom=false;socket.emit('room:left');}
      reply(result);sendState(guest);
    });
    socket.on('disconnect',()=>{if(guest.socket!==socket||guest.generation!==generation)return;guest.socket=undefined;manager.presence(guest.id,false);});
  });
  const webRoot=options.webRoot??path.resolve('apps/web/dist');
  app.use(express.static(webRoot,{index:'index.html'}));
  app.use((req,res)=>{if(req.method==='GET'&&!path.extname(req.path))res.sendFile(path.join(webRoot,'index.html'));else res.status(404).json({error:'Not found.'});});
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:error instanceof SyntaxError?'Invalid JSON request.':'Request could not be processed.'});});
  const tick=setInterval(()=>{
    manager.reconcile();
    for(const [key,guest] of sessions)if(!guest.socket&&!manager.roomFor(guest.id)&&now()-guest.lastSeen>86400000){sessions.delete(key);guests.delete(guest.id);manager.forgetSessionProfile(guest.id);}
    for(const [ip,rate] of requestRates)if(now()-rate.at>60000)requestRates.delete(ip);
  },options.tickMs??100);tick.unref();
  return {app,http,io,manager,instanceId,async listen(port=3000,host='127.0.0.1'){await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(port,host,()=>{http.off('error',reject);resolve();});});const address=http.address();return typeof address==='object'&&address?address.port:port;},async close(){clearInterval(tick);for(const guest of guests.values())guest.socket=undefined;io.emit('recovery:error',{message:'The server is restarting. This in-memory match may become unavailable.'});await new Promise<void>(resolve=>io.close(()=>resolve()));}};
}
