import {describe,expect,it} from 'vitest';
import {RULES,defaultSettings,type RoomSettings} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';

type F=ReturnType<typeof fixture>;
function config(f:F,patch:Partial<RoomSettings>={},extra:Record<string,unknown>={}){const v=f.view();return {settings:{...v.settings,...patch},rounds:v.roundLimit,finale:v.finaleEnabled,visibility:v.visibility,...extra};}
function apply(f:F,patch:Partial<RoomSettings>={},extra:Record<string,unknown>={}){const ack=f.send(f.host,'lobby:settings',config(f,patch,extra));expect(ack.status).toBe('ok');return ack;}
function party(players=3){return fixture({mode:'PARTY',rounds:6,players});}
function noWagerSocial(f:F){f.start();if(f.view().phase==='HOUSE_AUCTION')f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);}

describe('complete validated host settings and readiness',()=>{
  it('provides fresh exact Classic and Party defaults without sharing mutable objects',()=>{
    expect(defaultSettings('CLASSIC')).toEqual({maxPlayers:6,house:false,duels:false,overthrow:false,chaos:false,bounties:false,deals:false,doubleDown:false,extraClaims:false});expect(defaultSettings('PARTY')).toEqual({maxPlayers:6,house:true,duels:true,overthrow:true,chaos:true,bounties:true,deals:true,doubleDown:true,extraClaims:true});const a=defaultSettings('PARTY');a.maxPlayers=2;expect(defaultSettings('PARTY').maxPlayers).toBe(6);const f=fixture();expect(f.view().settings).toEqual(defaultSettings('CLASSIC'));expect(f.view().visibility).toBe('PRIVATE');
  });
  it('requires the current host and lobby context and invalidates every readiness when configuration changes',()=>{
    const f=party();for(const actor of f.actors)f.send(actor,'lobby:ready',{ready:true});const old=f.view().lobbyId,stale=f.command(f.host,'match:start'),before=structuredClone(f.room());expect(f.send(f.actors[1]!,'lobby:settings',config(f,{maxPlayers:4})).status).toBe('rejected');expect(f.room()).toEqual(before);apply(f,{maxPlayers:4},{finale:true,visibility:'PUBLIC'});expect(f.view()).toMatchObject({roundLimit:6,finaleEnabled:true,visibility:'PUBLIC'});expect(f.view().settings.maxPlayers).toBe(4);expect(f.view().lobbyId).not.toBe(old);expect(f.view().players.every(p=>!p.ready)).toBe(true);const after=structuredClone(f.room());expect(f.manager.command(f.host,stale).status).toBe('rejected');expect(f.send(f.host,'lobby:settings',config(f),{lobbyId:old}).status).toBe('rejected');expect(f.room()).toEqual(after);
  });
  it('preserves readiness and the lobby identity for an exact no-op and identical request replay',()=>{
    const f=party();for(const actor of f.actors)f.send(actor,'lobby:ready',{ready:true});const lobby=f.view().lobbyId,c=f.command(f.host,'lobby:settings',config(f)),ack=f.manager.command(f.host,c);expect(ack.status).toBe('ok');expect(f.view().lobbyId).toBe(lobby);expect(f.view().players.every(p=>p.ready)).toBe(true);const after=structuredClone(f.room());expect(f.manager.command(f.host,c)).toEqual(ack);expect(f.room()).toEqual(after);
  });
  it.each([1,7,2.5,NaN,'4',null])('rejects an invalid player cap %s atomically',maxPlayers=>{
    const f=party(2),before=structuredClone(f.room());expect(f.send(f.host,'lobby:settings',config(f,{}, {settings:{...f.view().settings,maxPlayers}})).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('counts absent occupied seats when validating capacity and enforces the new cap on direct joins',()=>{
    const f=party(4);f.manager.presence(f.actors[3]!,false);const before=structuredClone(f.room());expect(f.send(f.host,'lobby:settings',config(f,{maxPlayers:3})).status).toBe('rejected');expect(f.room()).toEqual(before);apply(f,{maxPlayers:4});expect(f.send('fifth-guest','room:join',{username:'Fifth Guest',roomCode:f.view().code}).status).toBe('rejected');expect(f.view().players).toHaveLength(4);
  });
  it('shrinks capacity around sparse occupied seats without renumbering them and fills an available gap safely',()=>{
    const f=party(6);for(const actor of f.actors.slice(1,4))expect(f.send(actor,'room:leave').status).toBe('ok');expect(f.view().players.map(p=>p.seat)).toEqual([0,4,5]);apply(f,{maxPlayers:3});expect(f.view().settings.maxPlayers).toBe(3);expect(f.view().players.map(p=>p.seat)).toEqual([0,4,5]);expect(f.send('new-guest','room:join',{username:'New Guest',roomCode:f.view().code}).status).toBe('rejected');expect(f.send(f.actors[4]!,'room:leave').status).toBe('ok');expect(f.send('new-guest','room:join',{username:'New Guest',roomCode:f.view().code}).status).toBe('ok');expect(f.view().players.map(p=>p.seat)).toEqual([0,1,5]);for(const p of f.view().players)expect(f.send(p.id,'lobby:ready',{ready:true}).status).toBe('ok');expect(f.send(f.host,'match:start').status).toBe('ok');expect(f.view().phase).toBe('HOUSE_AUCTION');expect(f.view().players).toHaveLength(3);expect(f.view().players.map(p=>p.seat)).toEqual([0,1,5]);expect(f.room().initialChips).toBe(3000);assertRoom(f.room());
  });
  it.each([{duels:false},{house:false},{duels:false,overthrow:false}])('rejects incompatible enabled dependencies %j without partially applying settings',patch=>{
    const f=party(),before=structuredClone(f.room());expect(f.send(f.host,'lobby:settings',config(f,patch)).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('strictly rejects missing, extra and wrongly typed nested settings or unsupported top-level choices',()=>{
    const f=party(),base=config(f),settings=f.view().settings,before=structuredClone(f.room());const invalid=[{}, {...base,settings:{maxPlayers:6}}, {...base,settings:{...settings,admin:true}}, {...base,settings:{...settings,chaos:'false'}}, {...base,settings:null}, {...base,settings:[]}, {...base,settings:{...settings,constructor:true}}, {...base,rounds:21}, {...base,rounds:'6'}, {...base,finale:'yes'}, {...base,visibility:'public'}, {...base,visibility:'FRIENDS'}, {...base,balance:10000}];for(const payload of invalid){expect(f.send(f.host,'lobby:settings',payload).status).toBe('rejected');expect(f.room()).toEqual(before);}
  });
  it('keeps Party features out of Classic while permitting host round counts, capacity and public or private lobbies',()=>{
    const f=fixture(),before=structuredClone(f.room());for(const payload of [config(f,{chaos:true}),config(f,{}, {finale:true})]){expect(f.send(f.host,'lobby:settings',payload).status).toBe('rejected');expect(f.room()).toEqual(before);}apply(f,{}, {visibility:'PUBLIC'});expect(f.view().settings).toEqual(defaultSettings('CLASSIC'));expect(f.send(f.host,'lobby:mode',{mode:'PARTY'}).status).toBe('ok');apply(f,{maxPlayers:3,chaos:false},{rounds:6,finale:false});expect(f.send(f.host,'lobby:mode',{mode:'CLASSIC'}).status).toBe('ok');expect(f.view()).toMatchObject({roundLimit:3,finaleEnabled:false,settings:defaultSettings('CLASSIC')});
  });
  it('locks settings in an active match and retains the approved configuration during same-room replay',()=>{
    const f=party();apply(f,{maxPlayers:3,house:false,overthrow:false,chaos:false,bounties:false,duels:false,deals:false},{rounds:3,finale:false,visibility:'PUBLIC'});const approved=config(f);f.start();const before=structuredClone(f.room());expect(f.send(f.host,'lobby:settings',config(f,{}, {visibility:'PRIVATE'})).status).toBe('rejected');expect(f.room()).toEqual(before);f.advance(72000);expect(f.view().phase).toBe('RESULTS');expect(f.send(f.host,'results:return').status).toBe('ok');expect(config(f)).toEqual(approved);f.start();expect(f.view().settings).toEqual(approved.settings);assertRoom(f.room());
  });
});

describe('released system toggles control real server behavior',()=>{
  it('disables the House auction while retaining funded Party state and ordinary Blackjack',()=>{
    const f=party();apply(f,{house:false,overthrow:false});f.start();expect(f.view()).toMatchObject({phase:'BETTING',round:1});expect(f.view().party!.houseId).toBeNull();expect(f.view().party!.vault).toBe(0);const before=structuredClone(f.room());expect(f.send(f.host,'house:bid',{amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('disables Chaos grants and the pre-turn movement window while rejecting invented card activations',()=>{
    const f=party(2);apply(f,{chaos:false});f.start();f.advance(22000);f.bet();f.deal();expect(f.view().phase).toBe('PLAYER_TURN');expect(f.view().party!.chaos.handWindow).toBeNull();expect(f.send(f.host,'turn:hit').status).toBe('ok');expect(f.view().players[0]!.hand).toHaveLength(3);const before=structuredClone(f.room());expect(f.send(f.host,'chaos:activate',{cardId:'invented-disabled-chaos'}).status).toBe('rejected');expect(f.room()).toEqual(before);for(let n=0;n<20&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')f.send(v.activePlayerId!,'turn:stand');else f.advance(v.deadline!-v.serverTime);}expect(f.view().party!.chaos.inventories.flatMap(i=>i.cards)).toEqual([]);expect(f.room().events.filter(e=>e.kind==='chaos'&&e.text.includes('receives'))).toEqual([]);assertRoom(f.room());
  });
  it('disables minigame duels and bounties while leaving independently funded contracts usable',()=>{
    const f=party();apply(f,{duels:false,overthrow:false,bounties:false});noWagerSocial(f);expect(f.view().phase).toBe('SOCIAL');const before=structuredClone(f.room());expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:50}).status).toBe('rejected');expect(f.send(f.host,'bounty:contribute',{targetId:f.actors[1],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount:50}).status).toBe('ok');const offer=f.view().party!.social!.dealInvites[0]!;expect(f.send(f.actors[1]!,'deal:accept',undefined,{dealOfferId:offer.id}).status).toBe('ok');expect(f.view().phase).toBe('DEAL');assertRoom(f.room());
  });
  it('disables overthrow, bounty and contract admissions independently of ordinary duels',()=>{
    const f=party();apply(f,{overthrow:false,bounties:false,deals:false});f.start();f.send(f.host,'house:bid',{amount:50});f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('SOCIAL');const before=structuredClone(f.room());expect(f.send(f.actors[1]!,'house:ballot').status).toBe('rejected');expect(f.send(f.host,'bounty:contribute',{targetId:f.actors[1],amount:50}).status).toBe('rejected');expect(f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount:50}).status).toBe('ok');assertRoom(f.room());
  });
  it('skips the social interval when every released social system is disabled',()=>{
    const f=party();apply(f,{duels:false,overthrow:false,bounties:false,deals:false});noWagerSocial(f);expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.view().party!.social).toBeNull();assertRoom(f.room());
  });
});
