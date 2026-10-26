import { describe, expect, it } from 'vitest';
import { collectRequestNotices, requestNoticeKey, requestNoticeScope, requestTargetCanBeSeen, SeenRequestNotices, type NoticeStorage, type RequestNotice } from '../../apps/web/src/request-notification-model.js';
import { fixture } from '../fixtures/core.js';

function social(house = false) {
  const f = fixture({ mode: 'PARTY', players: 3, rounds: 6 }); f.start();
  if (house) expect(f.send(f.host, 'house:bid', { amount: 50 }).status).toBe('ok');
  f.advance(22000); f.advance(24000); expect(f.view().phase).toBe('SOCIAL'); return f;
}
function storage(): NoticeStorage {
  const entries = new Map<string, string>(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); } };
}

describe('only actual live incoming requests create attention notices', () => {
  it('notifies a duel recipient once by ID, never its sender or a spectator, and prunes on elapsed deadline without another snapshot', () => {
    const f = social(), recipient = f.actors[1]!;
    expect(f.send(f.host, 'duel:invite', { defenderId: recipient, amount: 100 }).status).toBe('ok');
    const v = f.view(recipient), invite = v.party!.social!.invites[0]!, notices = collectRequestNotices(v);
    expect(notices).toEqual([expect.objectContaining({ key: requestNoticeKey('duel', invite.id), kind: 'duel', deadline: invite.deadline })]);
    expect(collectRequestNotices(f.view())).toEqual([]); expect(collectRequestNotices(f.view(f.actors[2]))).toEqual([]);
    expect(collectRequestNotices(v, invite.deadline - 1)).toHaveLength(1); expect(collectRequestNotices(v, invite.deadline)).toEqual([]);
    expect(collectRequestNotices({ ...v, revision: v.revision + 200 })).toEqual(notices);
    expect(f.send(recipient, 'duel:reject', undefined, { inviteId: invite.id }).status).toBe('ok'); expect(collectRequestNotices(f.view(recipient))).toEqual([]);
  });

  it('distinguishes a bounty challenge from an ordinary duel invitation and alerts other players to a new funded bounty', () => {
    const f = social(), recipient = f.actors[1]!, challenger = f.actors[2]!;
    expect(f.send(f.host, 'bounty:contribute', { targetId: recipient, amount: 100 }).status).toBe('ok');
    const bounty = f.view().party!.bounties[0]!;
    expect(collectRequestNotices(f.view())).toEqual([]);
    for (const viewer of [recipient, challenger]) expect(collectRequestNotices(f.view(viewer))).toEqual([expect.objectContaining({ key: requestNoticeKey('bounty', bounty.id) })]);
    expect(f.send(challenger, 'bounty:invite', { bountyId: bounty.id }).status).toBe('ok');
    const incoming = f.view(recipient).party!.social!.invites[0]!;
    expect(collectRequestNotices(f.view(recipient)).map(notice => notice.kind)).toEqual(['bounty-invite', 'bounty']);
    expect(collectRequestNotices(f.view(recipient))[0]!.key).toBe(requestNoticeKey('bounty-invite', incoming.id));
  });

  it('marks Split or Steal offers only for their intended defender and removes accepted/cancelled offers', () => {
    const f = social(), recipient = f.actors[1]!;
    expect(f.send(f.host, 'deal:offer', { defenderId: recipient, amount: 50 }).status).toBe('ok');
    const offer = f.view(recipient).party!.social!.dealInvites[0]!;
    expect(collectRequestNotices(f.view(recipient))).toEqual([expect.objectContaining({ key: requestNoticeKey('deal', offer.id) })]);
    expect(collectRequestNotices(f.view())).toEqual([]);
    expect(f.send(recipient, 'deal:accept', undefined, { dealOfferId: offer.id }).status).toBe('ok');
    expect(collectRequestNotices(f.view(recipient))).toEqual([]);
  });

  it('alerts only eligible unvoted ballot recipients, then alerts the actual House during its game-selection request', () => {
    const f = social(true), voter = f.actors[1]!;
    expect(f.send(voter, 'house:ballot').status).toBe('ok');
    const ballot = f.view().party!.social!.ballot!;
    expect(collectRequestNotices(f.view(voter))).toEqual([expect.objectContaining({ key: requestNoticeKey('ballot', ballot.id) })]);
    expect(collectRequestNotices(f.view())).toEqual([expect.objectContaining({ key: requestNoticeKey('ballot', ballot.id) })]);
    const houseSeen = new SeenRequestNotices(requestNoticeScope(f.view())); houseSeen.acknowledge([requestNoticeKey('ballot', ballot.id)]);
    expect(f.send(voter, 'house:vote', { yes: true }).status).toBe('ok'); expect(collectRequestNotices(f.view(voter))).toEqual([]);
    expect(f.send(f.actors[2]!, 'house:vote', { yes: true }).status).toBe('ok');
    expect(collectRequestNotices(f.view())).toEqual([expect.objectContaining({ key: requestNoticeKey('house-choice', ballot.id), deadline: f.view().deadline })]);
    expect(houseSeen.unseen(collectRequestNotices(f.view()))).toHaveLength(1);
    expect(collectRequestNotices(f.view(voter))).toEqual([]);
  });

  it('stops all attention after room exit, results, a disconnected viewer, observer status or bounty settlement', () => {
    const f = social(); f.send(f.host, 'bounty:contribute', { targetId: f.actors[1], amount: 100 }); const v = f.view(f.actors[1]);
    expect(collectRequestNotices(v)).toHaveLength(1); expect(collectRequestNotices(null)).toEqual([]);
    expect(collectRequestNotices({ ...v, phase: 'RESULTS' })).toEqual([]);
    for (const change of [{ connected: false }, { departed: true }, { status: 'observer' }]) expect(collectRequestNotices({ ...v, players: v.players.map(p => p.id === v.viewerId ? { ...p, ...change } : p) })).toEqual([]);
    v.party!.bounties[0]!.status = 'refunded'; expect(collectRequestNotices(v)).toEqual([]);
  });
});

describe('seen identities persist per server, room and viewer without revision retriggers', () => {
  const notice = (id: string): RequestNotice => ({ key: requestNoticeKey('deal', id), kind: 'deal', id, title: 'Incoming offer', deadline: 5000 });
  it('retains unseen requests across refresh and remembers acknowledgement without suppressing another room or viewer', () => {
    const saved = storage(), f = social(), scope = requestNoticeScope(f.view()), n = notice('offer-1');
    const first = new SeenRequestNotices(scope, saved); expect(first.unseen([n])).toEqual([n]);
    expect(new SeenRequestNotices(scope, saved).unseen([n])).toEqual([n]);
    expect(first.acknowledge([n.key])).toBe(true); expect(first.acknowledge([n.key])).toBe(false);
    expect(new SeenRequestNotices(scope, saved).unseen([n])).toEqual([]);
    expect(new SeenRequestNotices(requestNoticeScope(f.view(f.actors[1])), saved).unseen([n])).toEqual([n]);
    expect(new SeenRequestNotices(requestNoticeScope({ ...f.view(), instanceId: 'different-room' }), saved).unseen([n])).toEqual([n]);
    expect(new SeenRequestNotices(requestNoticeScope({ ...f.view(), serverInstanceId: 'restarted-server' }), saved).unseen([n])).toEqual([n]);
  });

  it('keeps already-seen active bounty IDs when bounded past request history is pruned', () => {
    const saved = storage(), ledger = new SeenRequestNotices('scope', saved), active = notice('long-lived-bounty');
    ledger.unseen([active]); ledger.acknowledge([active.key]);
    for (let n = 0; n < 600; n++) { const recent = notice(String(n)); ledger.unseen([active, recent]); ledger.acknowledge([recent.key]); }
    expect(ledger.unseen([active])).toEqual([]); expect(new SeenRequestNotices('scope', saved).unseen([active])).toEqual([]);
  });

  it('survives malformed or denied storage while retaining in-memory seen behavior', () => {
    const n = notice('one'), malformed = new SeenRequestNotices('scope', { getItem: () => '{bad', setItem: () => {} });
    expect(malformed.unseen([n])).toEqual([n]); malformed.acknowledge([n.key]); expect(malformed.unseen([n])).toEqual([]);
    const denied = new SeenRequestNotices('scope', { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Denied'); } });
    expect(denied.acknowledge([n.key])).toBe(true); expect(denied.has(n.key)).toBe(true);
  });
});

describe('seeing a request requires a visible, focused and unobscured target', () => {
  const visible = { visibleRatio: 1, documentVisible: true, focused: true, unobscured: true };
  it.each([{ focused: false }, { documentVisible: false }, { visibleRatio: 0 }, { visibleRatio: .49 }, { unobscured: false }])('keeps %j unseen', state => expect(requestTargetCanBeSeen({ ...visible, ...state })).toBe(false));
  it('accepts the actual visible target, including a partially visible card once half is in view', () => {
    expect(requestTargetCanBeSeen(visible)).toBe(true); expect(requestTargetCanBeSeen({ ...visible, visibleRatio: .5 })).toBe(true);
  });
});
