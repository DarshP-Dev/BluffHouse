import {describe,expect,it} from 'vitest';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture} from '../fixtures/core.js';

type F=ReturnType<typeof fixture>;
const send=(f:F,actor:string,text:unknown)=>f.send(actor,'chat:send',{text});

describe('bounded room chat and authoritative delivery',()=>{
  it('trims a message and supplies its author and timestamp from the existing guest and server',()=>{
    const f=fixture();expect(send(f,f.host,'  Hello table!  ').status).toBe('ok');expect(f.view().chat).toEqual([{id:expect.any(String),playerId:f.host,username:'Player 1',text:'Hello table!',at:f.view().serverTime}]);expect(f.view(f.actors[1]).chat).toEqual(f.view().chat);const before=structuredClone(f.room());expect(f.send(f.actors[1]!,'chat:send',{text:'Spoof',playerId:f.host,username:'Admin',at:0}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it.each([null,0,{},[],true,'','   ','\u0000hidden','bad\u007ftext','\ud800'])('rejects invalid or controlled text %j atomically',text=>{
    const f=fixture(),before=structuredClone(f.room());expect(send(f,f.host,text).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('accepts exactly 280 Unicode code points and rejects a 281st point',()=>{
    const f=fixture(),message='😀'.repeat(280);expect(send(f,f.host,message).status).toBe('ok');expect(f.view().chat[0]!.text).toBe(message);f.advance(10000);const before=structuredClone(f.room());expect(send(f,f.host,message+'x').status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('permits tabs and multiline plain text while normalizing Windows newlines',()=>{
    const f=fixture();expect(send(f,f.host,'  First\r\nSecond\tcolumn  ').status).toBe('ok');expect(f.view().chat[0]!.text).toBe('First\nSecond\tcolumn');
  });
  it('stores script and HTML markup as plain text with no interpretation or authority changes',()=>{
    const f=fixture(),text='<script>window.hacked=true</script><b>chips</b>';expect(send(f,f.host,text).status).toBe('ok');expect(f.view().chat[0]!.text).toBe(text);expect(f.view().hostId).toBe(f.host);expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000]);
  });
  it('limits each sender to one message per second while allowing another guest to speak independently',()=>{
    const f=fixture();expect(send(f,f.host,'first').status).toBe('ok');let before=structuredClone(f.room());expect(send(f,f.host,'too soon').status).toBe('rejected');expect(f.room()).toEqual(before);expect(send(f,f.actors[1]!,'independent').status).toBe('ok');f.advance(999);before=structuredClone(f.room());expect(send(f,f.host,'still early').status).toBe('rejected');expect(f.room()).toEqual(before);f.advance(1);expect(send(f,f.host,'exact second').status).toBe('ok');expect(f.view().chat.map(m=>m.text)).toEqual(['first','independent','exact second']);
  });
  it('limits the sliding burst to five messages in ten seconds, expiring the oldest at the exact boundary',()=>{
    const f=fixture();for(let n=0;n<5;n++){if(n)f.advance(1000);expect(send(f,f.host,`Burst ${n}`).status).toBe('ok');}f.advance(1000);let before=structuredClone(f.room());expect(send(f,f.host,'sixth').status).toBe('rejected');expect(f.room()).toEqual(before);f.advance(4999);before=structuredClone(f.room());expect(send(f,f.host,'not quite ten seconds').status).toBe('rejected');expect(f.room()).toEqual(before);f.advance(1);expect(send(f,f.host,'oldest expired').status).toBe('ok');expect(f.view().chat).toHaveLength(6);
  });
  it('retains only the last 100 messages and copies them into reconnect snapshots',()=>{
    const f=fixture();for(let n=0;n<105;n++){expect(send(f,f.host,`Message ${n}`).status).toBe('ok');f.advance(10000);}expect(f.view().chat).toHaveLength(100);expect(f.view().chat[0]!.text).toBe('Message 5');expect(f.view().chat.at(-1)!.text).toBe('Message 104');const messages=structuredClone(f.view().chat);f.manager.presence(f.actors[1]!,false);f.manager.presence(f.actors[1]!,true);expect(f.view(f.actors[1]).chat).toEqual(messages);const v=f.view();v.chat[0]!.text='tampered';expect(f.view().chat).toEqual(messages);
  });
  it('records a successful request once and rejects altered payload retries without consuming another rate slot',()=>{
    const f=fixture(),c=f.command(f.host,'chat:send',{text:'one delivery'}),ack=f.manager.command(f.host,c);expect(ack.status).toBe('ok');const after=structuredClone(f.room());expect(f.manager.command(f.host,c)).toEqual(ack);expect(f.manager.command(f.host,{...c,payload:{text:'changed'}}).status).toBe('rejected');expect(f.room()).toEqual(after);expect(f.view().chat).toHaveLength(1);f.advance(1000);expect(send(f,f.host,'next delivery').status).toBe('ok');
  });
});

describe('chat stays inside authenticated room membership',()=>{
  it('rejects an outsider, stale room and departed participant without leaking another room’s history',()=>{
    const f=fixture();expect(send(f,f.host,'private table message').status).toBe('ok');const target=f.view().instanceId,create=f.send('other-room-guest','room:create',{username:'Other Room'});expect(create.status).toBe('ok');expect(f.manager.snapshot('other-room-guest')!.chat).toEqual([]);const before=structuredClone(f.room());expect(f.send('other-room-guest','chat:send',{text:'cross room'},{roomInstanceId:target}).status).toBe('rejected');expect(send(f,'not-a-member','outsider').status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.actors[1]!,'room:leave').status).toBe('ok');expect(send(f,f.actors[1]!,'after leaving').status).toBe('rejected');expect(f.view().chat).toHaveLength(1);
  });
  it('does not change a live Blackjack decision, its deadline, hand, wagers or chip records',()=>{
    const f=fixture();f.start();f.bet();f.deal();const decision=f.command(f.host,'turn:hit'),before=structuredClone(f.room()),deadline=f.view().deadline;expect(send(f,f.actors[1]!,'Your turn!').status).toBe('ok');expect(f.view().decisionId).toBe(before.decisionId);expect(f.view().deadline).toBe(deadline);expect(f.room().players.map(p=>({hand:p.hand,account:p.account,wager:p.wager,bluffUsed:p.bluffUsed}))).toEqual(before.players.map(p=>({hand:p.hand,account:p.account,wager:p.wager,bluffUsed:p.bluffUsed})));expect(f.manager.command(f.host,decision).status).toBe('ok');expect(f.view().players[0]!.hand).toHaveLength(3);assertRoom(f.room());
  });
  it('keeps emoji and chat rate limits independent without consuming another player’s game decision',()=>{
    const f=fixture();f.start();f.bet();f.deal();const id=f.view().decisionId;expect(send(f,f.host,'Hello').status).toBe('ok');expect(f.send(f.host,'reaction:send',{emoji:'👀'}).status).toBe('ok');expect(send(f,f.host,'Too soon').status).toBe('rejected');expect(f.send(f.host,'reaction:send',{emoji:'👀'}).status).toBe('rejected');expect(f.view().decisionId).toBe(id);expect(f.send(f.host,'turn:stand').status).toBe('ok');assertRoom(f.room());
  });
  it('keeps the room conversation through match replay without retaining a stale lobby authorization',()=>{
    const f=fixture();expect(send(f,f.host,'Before the match').status).toBe('ok');const old=f.command(f.actors[1]!,'chat:send',{text:'delayed lobby message'});f.start();f.advance(72000);expect(f.view().phase).toBe('RESULTS');expect(f.send(f.host,'results:return').status).toBe('ok');expect(f.view().chat.map(m=>m.text)).toEqual(['Before the match']);const before=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,old).status).toBe('rejected');expect(f.room()).toEqual(before);expect(send(f,f.actors[1]!,'Replay ready').status).toBe('ok');expect(f.view().chat).toHaveLength(2);
  });
  it('accepts an otherwise current match message after its incidental round context becomes old',()=>{
    const f=fixture();f.start();const pending=f.command(f.actors[1]!,'chat:send',{text:'Still this match'});f.advance(24000);expect(f.view().round).toBe(2);expect(f.manager.command(f.actors[1]!,pending).status).toBe('ok');expect(f.view().chat[0]!.text).toBe('Still this match');assertRoom(f.room());
  });
});
