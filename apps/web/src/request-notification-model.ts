import type { RoomView } from '@bluff-house/shared';

export type RequestNoticeKind = 'duel' | 'bounty-invite' | 'bounty' | 'ballot' | 'house-choice' | 'deal';
export interface RequestNotice { key: string; kind: RequestNoticeKind; id: string; title: string; deadline: number | null }
export const REQUEST_SEEN_DWELL_MS = 800;
export const REQUEST_SOUND_INTERVAL_MS = 3000;
export const REQUEST_SOUND_PREFERENCE_KEY = 'bluffhouse.request-sounds.v1';
export const requestNoticeKey = (kind: RequestNoticeKind, id: string) => `${kind}:${id}`;
export function requestNoticeScope(room: RoomView | null): string {
  return room ? [room.serverInstanceId, room.instanceId, room.viewerId].map(encodeURIComponent).join(':') : '';
}

/** Only the server's live, recipient-owned requests can become notifications. */
export function collectRequestNotices(room: RoomView | null, now = room?.serverTime ?? 0): RequestNotice[] {
  const party = room?.party, me = room?.players.find(p => p.id === room.viewerId);
  if (!room || !party || !me?.connected || me.departed || me.status === 'observer' || ['LOBBY', 'RESULTS'].includes(room.phase)) return [];
  const notices: RequestNotice[] = [];
  const name = (id: string) => room.players.find(p => p.id === id)?.name ?? 'A player';
  const add = (kind: RequestNoticeKind, id: string, title: string, deadline: number | null) => notices.push({ key: requestNoticeKey(kind, id), kind, id, title, deadline });
  const social = party.social;
  if (room.phase === 'SOCIAL' && social) {
    for (const invite of social.invites) if (invite.defenderId === room.viewerId && invite.status === 'pending' && invite.deadline > now) {
      add(invite.purpose === 'BOUNTY' ? 'bounty-invite' : 'duel', invite.id, `${name(invite.inviterId)} sent ${invite.purpose === 'BOUNTY' ? 'a bounty challenge' : 'a duel invitation'}`, invite.deadline);
    }
    for (const offer of social.dealInvites) if (offer.defenderId === room.viewerId && offer.status === 'pending' && offer.deadline > now) add('deal', offer.id, `${name(offer.inviterId)} offered Split or Steal`, offer.deadline);
  }
  const ballot = social?.ballot;
  if (ballot?.status === 'open' && ballot.deadline > now && (ballot.houseId === room.viewerId || ballot.eligibleVoterIds.includes(room.viewerId) && !ballot.votes.some(v => v.playerId === room.viewerId))) add('ballot', ballot.id, ballot.houseId === room.viewerId ? 'Players opened a ballot to overthrow your House' : 'A House overthrow ballot needs your vote', ballot.deadline);
  if (ballot?.status === 'selecting' && ballot.houseId === room.viewerId && (room.deadline ?? ballot.deadline) > now) add('house-choice', ballot.id, 'Choose your game for the House’s Last Stand', room.deadline ?? ballot.deadline);
  for (const bounty of party.bounties) if (bounty.status === 'active' && (bounty.targetId === room.viewerId || bounty.contributions.some(c => c.playerId !== room.viewerId))) add('bounty', bounty.id, bounty.targetId === room.viewerId ? 'A new bounty is on you' : `A new bounty is on ${name(bounty.targetId)}`, null);
  return notices;
}

export interface NoticeStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
/** Seen identities survive refresh; notification payloads and private data do not. */
export class SeenRequestNotices {
  private seen = new Set<string>();
  private active = new Set<string>();
  private readonly key: string;
  constructor(scope: string, private storage?: NoticeStorage) {
    this.key = `bluffhouse.seen-requests.v1:${scope}`;
    try { const saved: unknown = JSON.parse(storage?.getItem(this.key) ?? '[]'); if (Array.isArray(saved)) this.seen = new Set(saved.filter((key): key is string => typeof key === 'string').slice(-512)); } catch { /* Storage may be unavailable or contain an older value. */ }
  }
  has(key: string): boolean { return this.seen.has(key); }
  acknowledge(keys: readonly string[]): boolean {
    let changed = false;
    for (const key of keys) if (!this.seen.has(key)) { this.seen.add(key); changed = true; }
    if (!changed) return false;
    if (this.seen.size > 512) {
      const live = [...this.seen].filter(key => this.active.has(key)).slice(-512), remaining = 512 - live.length;
      const history = [...this.seen].filter(key => !this.active.has(key));
      this.seen = new Set((remaining ? history.slice(-remaining) : []).concat(live));
    }
    try { this.storage?.setItem(this.key, JSON.stringify([...this.seen])); } catch { /* In-memory acknowledgement still works. */ }
    return true;
  }
  unseen(notices: readonly RequestNotice[]): RequestNotice[] { this.active = new Set(notices.map(notice => notice.key)); return notices.filter(notice => !this.seen.has(notice.key)); }
}

export function requestTargetCanBeSeen(state: { visibleRatio: number; documentVisible: boolean; focused: boolean; unobscured: boolean }): boolean {
  return state.visibleRatio >= .5 && state.documentVisible && state.focused && state.unobscured;
}
