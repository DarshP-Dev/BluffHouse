import {describe,expect,it} from 'vitest';
import {createApp} from '../../apps/server/src/app.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';
import {fundedFinale,lockShadowHands,declareShadow,finishFinale} from '../fixtures/shadow.js';

describe('lobby cosmetic profile validation and ownership',()=>{
  it('updates only the acting guest’s initials and released color without changing readiness, money or game configuration',()=>{
    const f=fixture();f.send(f.host,'lobby:ready',{ready:true});const before=structuredClone(f.room()),other=structuredClone(f.view().players[1]!.profile);expect(f.send(f.host,'profile:update',{initials:'AB',color:'RUBY'}).status).toBe('ok');expect(f.view().players[0]!.profile).toMatchObject({initials:'AB',color:'RUBY',lifetime:'guest-session'});expect(f.view().players[1]!.profile).toEqual(other);expect(f.view().lobbyId).toBe(before.lobbyId);expect(f.view().players[0]!.ready).toBe(true);expect(f.room().players.map(p=>p.account)).toEqual(before.players.map(p=>p.account));assertRoom(f.room());
  });
  it.each([{initials:'<img>',color:'GOLD'},{initials:'ABCD',color:'GOLD'},{initials:'😀',color:'GOLD'},{initials:'',color:'GOLD'},{initials:123,color:'GOLD'},{initials:'AB',color:'UNRELEASED'},{initials:'AB',color:null},{initials:'AB',color:'RUBY',balance:10000},{initials:'AB',color:'RUBY',playerId:'player-2'},{initials:'AB',color:'RUBY',badges:['HIGH_ROLLER']}])('rejects invalid or authoritative profile fields %j atomically',payload=>{
    const f=fixture(),before=structuredClone(f.room());expect(f.send(f.host,'profile:update',payload).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('requires current authenticated room membership, the lobby and the current lobby identity',()=>{
    const f=fixture(),before=structuredClone(f.room());expect(f.send('outsider','profile:update',{initials:'NO',color:'GOLD'}).status).toBe('rejected');expect(f.send(f.host,'profile:update',{initials:'NO',color:'GOLD'},{lobbyId:'old-lobby'}).status).toBe('rejected');expect(f.room()).toEqual(before);f.start();const started=structuredClone(f.room());expect(f.send(f.host,'profile:update',{initials:'NO',color:'GOLD'}).status).toBe('rejected');expect(f.room()).toEqual(started);
  });
  it('restores a copied public profile across refresh without exposing private match-progress bookkeeping',()=>{
    const f=fixture();expect(f.send(f.host,'profile:update',{initials:'AB',color:'VIOLET'}).status).toBe('ok');const profile=structuredClone(f.view().players[0]!.profile);f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().players[0]!.profile).toEqual(profile);const v=f.view();v.players[0]!.profile.initials='XX';v.players[0]!.profile.badges.push({id:'HIGH_ROLLER',earnedAt:0,evidence:{matchId:'fake',eventId:'fake',description:'fake'}});expect(f.view().players[0]!.profile).toEqual(profile);expect(profile).not.toHaveProperty('matchProgress');expect(profile).not.toHaveProperty('processedEventIds');
  });
  it('keeps the same guest’s cosmetics after leaving one lobby and creating another, then forgets them on real session cleanup',()=>{
    const f=fixture();expect(f.send(f.host,'profile:update',{initials:'AB',color:'EMERALD'}).status).toBe('ok');const first=f.view().instanceId;expect(f.send(f.host,'room:leave').status).toBe('ok');expect(f.send(f.host,'room:create',{username:'New Table'}).status).toBe('ok');expect(f.view().instanceId).not.toBe(first);expect(f.view().players[0]!.profile).toMatchObject({initials:'AB',color:'EMERALD'});expect(f.send(f.host,'room:leave').status).toBe('ok');f.manager.forgetSessionProfile(f.host);expect(f.manager.sessionProfiles.has(f.host)).toBe(false);expect(f.send(f.host,'room:create',{username:'Fresh Guest'}).status).toBe('ok');expect(f.view().players[0]!.profile.initials).not.toBe('AB');expect(f.view().players[0]!.profile.badges).toEqual([]);
  });
  it('merges a badge from an older departed obligation into the current room without overwriting newer cosmetics or match statistics',()=>{
    const f=fundedFinale(),actor=f.actors[1]!,oldMatch=f.view().matchId;lockShadowHands(f,[1]);expect(f.send(f.host,'shadow:pass').status).toBe('ok');declareShadow(f,1,21);f.advance(8000);expect(f.send(actor,'room:leave').status).toBe('ok');expect(f.send(actor,'room:create',{username:'New Room Guest'}).status).toBe('ok');expect(f.send(actor,'profile:update',{initials:'XZ',color:'CORAL'}).status).toBe('ok');const newRoom=f.manager.snapshot(actor)!.instanceId;finishFinale(f);const latest=f.manager.snapshot(actor)!;expect(latest.instanceId).toBe(newRoom);expect(latest.players[0]!.profile).toMatchObject({initials:'XZ',color:'CORAL'});const earned=latest.players[0]!.profile.badges.filter(b=>b.id==='VAULT_THIEF');expect(earned).toHaveLength(1);expect(earned[0]!.evidence.matchId).toBe(oldMatch);expect(latest.matchStats).toEqual([]);expect(f.view().matchStats.find(s=>s.playerId===actor)!.vaultWon).toBe(100);expect(f.view().players[1]!.profile.initials).toBe('XZ');assertRoom(f.room());assertRoom(f.manager.roomFor(actor)!);
  });
  it('normalizes released Unicode initials and permits up to three letters or digits',()=>{
    const f=fixture();expect(f.send(f.host,'profile:update',{initials:' e\u0301a ',color:'SAPPHIRE'}).status).toBe('ok');expect(f.view().players[0]!.profile.initials).toBe('ÉA');expect(f.send(f.host,'profile:update',{initials:'abc',color:'GOLD'}).status).toBe('ok');expect(f.view().players[0]!.profile.initials).toBe('ABC');
  });
});

describe('guest-session lifetime is actually finite',()=>{
  it('expires a detached profile with its real inactive HTTP guest cookie, without manufacturing a new persistent account',async()=>{
    let now=1000;const origin='http://localhost:42345',server=createApp({origin,now:()=>now,tickMs:10});try{const port=await server.listen(0),url=`http://127.0.0.1:${port}`,response=await fetch(`${url}/api/guest`,{method:'POST',headers:{Origin:origin}}),cookie=response.headers.get('set-cookie')!.split(';')[0]!,session=await fetch(`${url}/api/session`,{headers:{Cookie:cookie}}).then(r=>r.json()) as {authenticated:boolean;playerId:string};expect(session.authenticated).toBe(true);
      expect(server.manager.command(session.playerId,{requestId:'session-create-room',type:'room:create',payload:{username:'Session Guest'}}).status).toBe('ok');let v=server.manager.snapshot(session.playerId)!;expect(server.manager.command(session.playerId,{requestId:'session-profile-update',type:'profile:update',roomInstanceId:v.instanceId,lobbyId:v.lobbyId,payload:{initials:'AB',color:'RUBY'}}).status).toBe('ok');v=server.manager.snapshot(session.playerId)!;expect(server.manager.command(session.playerId,{requestId:'session-leave-room',type:'room:leave',roomInstanceId:v.instanceId,lobbyId:v.lobbyId}).status).toBe('ok');expect(server.manager.sessionProfiles.has(session.playerId)).toBe(true);now+=86400001;await new Promise(resolve=>setTimeout(resolve,30));expect(server.manager.sessionProfiles.has(session.playerId)).toBe(false);const expired=await fetch(`${url}/api/session`,{headers:{Cookie:cookie}}).then(r=>r.json()) as {authenticated:boolean};expect(expired.authenticated).toBe(false);
    }finally{await server.close();}
  });
});
