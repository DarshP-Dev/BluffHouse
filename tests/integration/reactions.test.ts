import {describe,it,expect} from 'vitest';
import {fixture} from '../fixtures/core.js';
import type {TableEvent} from '@bluff-house/shared';

describe('bounded ephemeral reactions',()=>{
  it('emits once, preserves the decision and revision, and enforces a per-player cooldown',()=>{
    const f=fixture();f.start();f.bet();f.deal();
    const events:TableEvent[]=[];f.manager.onReaction=(_room,event)=>events.push(event);
    const before=structuredClone(f.room()),reaction=f.command(f.host,'reaction:send',{emoji:'👀'});
    const ack=f.manager.command(f.host,reaction);expect(ack.status).toBe('ok');
    expect(f.manager.command(f.host,reaction)).toEqual(ack);expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({kind:'reaction',playerId:f.host,revision:before.revision});
    expect(f.room()).toEqual(before);
    expect(f.send(f.host,'reaction:send',{emoji:'🔥'}).code).toBe('REACTION_COOLDOWN');
    expect(f.send(f.actors[1]!,'reaction:send',{emoji:'🔥'}).status).toBe('ok');
    f.advance(999);expect(f.send(f.host,'reaction:send',{emoji:'🔥'}).code).toBe('REACTION_COOLDOWN');
    f.advance(1);expect(f.send(f.host,'reaction:send',{emoji:'🔥'}).status).toBe('ok');
    expect(f.send(f.host,'turn:hit',undefined,{decisionId:before.decisionId}).status).toBe('ok');
  });
  it('rejects arbitrary text and absent senders without changing state',()=>{
    const f=fixture();const before=structuredClone(f.room());
    expect(f.send(f.host,'reaction:send',{emoji:'<script>hello</script>'}).code).toBe('INVALID_REACTION');
    expect(f.room()).toEqual(before);
    f.manager.presence(f.host,false);
    expect(f.send(f.host,'reaction:send',{emoji:'👀'}).code).toBe('NO_MEMBERSHIP');
  });
});
