import { io, type Socket } from 'socket.io-client';
import type { Ack, Command, CommandType, RoomView, SessionResponse, TableEvent } from '@bluff-house/shared';

export type ConnectionStatus = 'checking' | 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'replaced' | 'lost';
export interface ConnectionState {
  status: ConnectionStatus;
  room: RoomView | null;
  error: string | null;
  pending: CommandType | null;
  clockOffset: number;
  reactions: TableEvent[];
}

let state: ConnectionState = { status: 'checking', room: null, error: null, pending: null, clockOffset: 0, reactions: [] };
let socket: Socket | null = null;
let initialized = false;
let pendingRequestId: string | null = null;
const listeners = new Set<() => void>();
const publish = (patch: Partial<ConnectionState>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
};

export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getSnapshot = () => state;
export const clearError = () => publish({ error: null });

/** Credentials remain in the server-issued HttpOnly cookie. Nothing is stored in localStorage. */
export async function initializeConnection() {
  if (initialized) return;
  initialized = true;
  try {
    const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('The casino is unavailable. Please try again.');
    const session = await response.json() as SessionResponse;
    if (session.error) {
      publish({ status: 'lost', error: session.error });
    } else if (session.authenticated) {
      await connectSocket();
    } else {
      publish({ status: 'idle' });
    }
  } catch (error) {
    publish({ status: 'idle', error: error instanceof Error ? error.message : 'Could not reach Bluff House.' });
  }
}

function messageFrom(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message;
  return fallback;
}

function connectSocket(): Promise<void> {
  if (socket?.connected) return Promise.resolve();
  socket?.disconnect();
  publish({ status: state.room ? 'reconnecting' : 'connecting', error: null });
  const next = io({ autoConnect: false, withCredentials: true, reconnection: true, reconnectionDelayMax: 3000 });
  socket = next;
  next.on('room:state', (room: RoomView) => {
    if (socket !== next) return;
    if (state.room?.instanceId === room.instanceId && room.revision < state.room.revision) return;
    const sameTable = state.room?.instanceId === room.instanceId && state.room?.lobbyId === room.lobbyId;
    publish({ room, status: 'connected', clockOffset: room.serverTime - Date.now(), reactions: sameTable ? state.reactions : [] });
  });
  next.on('room:reaction', ({ roomInstanceId, event }: { roomInstanceId: string; event: TableEvent }) => {
    if (socket !== next || state.status !== 'connected' || state.room?.instanceId !== roomInstanceId || state.reactions.some(item => item.id === event.id)) return;
    // Reactions are transient presentation events; they never replace a game snapshot.
    publish({ reactions: [...state.reactions.slice(-11), event] });
    window.setTimeout(() => {
      if (socket === next && state.reactions.some(item => item.id === event.id)) publish({ reactions: state.reactions.filter(item => item.id !== event.id) });
    }, 3000);
  });
  next.on('session:replaced', () => {
    if (socket !== next) return;
    next.disconnect();
    pendingRequestId = null;
    publish({ status: 'replaced', pending: null, error: 'This guest is now playing in another tab. Continue in that tab to keep your seat.' });
  });
  next.on('recovery:error', (error: unknown) => {
    if (socket !== next) return;
    next.disconnect();
    pendingRequestId = null;
    publish({ status: 'lost', room: null, pending: null, error: messageFrom(error, 'Your previous table is no longer available. You can start a new room.') });
  });
  next.on('disconnect', () => {
    // Calls are admitted only while connected; discard any stale offline buffer.
    next.sendBuffer = [];
    if (socket !== next || state.status === 'replaced' || state.status === 'lost') return;
    pendingRequestId = null;
    publish({ status: 'reconnecting', pending: null });
  });
  next.on('room:left', () => {
    if (socket === next) publish({ room: null, reactions: [] });
  });
  next.on('connect', () => {
    if (socket !== next) return;
    // Recovery is snapshot-first: no old click is queued or replayed after reconnect.
    publish({ status: state.room ? 'reconnecting' : 'connected', error: null, pending: null });
    syncState();
  });
  next.on('connect_error', (error: Error) => {
    if (socket !== next || state.status === 'lost' || state.status === 'replaced') return;
    if (error.message.startsWith('Session unavailable')) {
      next.disconnect();
      pendingRequestId = null;
      publish({ status: 'lost', room: null, pending: null, error: 'Your previous table is no longer available. Return to the menu to start again.' });
    } else publish({ status: 'reconnecting' });
  });
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { reject(new Error('Unable to connect. Check your connection and try again.')); }, 10000);
    next.once('connect', () => { window.clearTimeout(timeout); resolve(); });
    next.connect();
  });
}

function envelope(type: CommandType, payload?: Record<string, unknown>, context?: Pick<Command, 'inviteId'>): Command {
  const room = state.room;
  return {
    // getRandomValues also works on HTTP LAN origins, where randomUUID is absent.
    requestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''), type, payload,
    ...(room && {
      roomInstanceId: room.instanceId, lobbyId: room.lobbyId, matchId: room.matchId,
      roundId: room.roundId, decisionId: room.decisionId, bettingId: room.bettingId,
      offerId: room.bluff?.id, auctionId: room.party?.auction.id,
      socialId: room.party?.social?.id, socialSlotId: room.party?.social?.slotId, duelId: room.party?.social?.duel?.id,
      throwId: room.party?.social?.duel?.throwId,
      moveId: room.party?.social?.duel?.connect4?.moveId ?? room.party?.social?.duel?.chess?.moveId,
      ballotId: room.party?.social?.ballot?.id,
      chaosWindowId: room.phase === 'HAND_CHAOS' ? room.party?.chaos.handWindow?.id : room.party?.chaos.potTwist?.id,
    }),
    ...context,
  };
}

function syncState() {
  if (!socket?.connected) return;
  const syncingSocket = socket;
  syncingSocket.timeout(5000).emit('command', envelope('state:sync'), (error: Error | null, ack?: Ack) => {
    if (socket !== syncingSocket || state.status === 'lost' || state.status === 'replaced') return;
    if (!error && ack?.status === 'ok' && !state.room && state.status === 'reconnecting') publish({ status: 'connected' });
  });
}

/** Every click has one request ID. Unknown outcomes trigger a snapshot, never a new-ID retry. */
export async function sendCommand(type: CommandType, payload?: Record<string, unknown>, context?: Pick<Command, 'inviteId'>): Promise<boolean> {
  if (!socket?.connected || state.status !== 'connected') {
    publish({ error: 'Wait until the connection is restored before taking an action.' });
    return false;
  }
  if (state.pending) return false;
  const command = envelope(type, payload, context);
  const sendingSocket = socket;
  pendingRequestId = command.requestId;
  publish({ pending: type, error: null });
  return new Promise(resolve => {
    sendingSocket.timeout(5000).emit('command', command, (error: Error | null, ack?: Ack) => {
      if (sendingSocket !== socket || pendingRequestId !== command.requestId || state.status === 'replaced' || state.status === 'lost') { resolve(false); return; }
      pendingRequestId = null;
      publish({ pending: null });
      if (error || !ack || ack.requestId !== command.requestId) {
        publish({ status: state.room ? 'reconnecting' : state.status, error: 'Confirmation was interrupted. Refreshing the table to check what happened.' });
        syncState();
        resolve(false);
      } else if (ack.status === 'rejected') {
        publish({ error: ack.message || 'That action is no longer available. The table has been updated.' });
        syncState();
        resolve(false);
      } else {
        if (type === 'room:leave') publish({ room: null });
        resolve(true);
      }
    });
  });
}

export async function enterRoom(mode: 'host' | 'join', username: string, roomCode: string): Promise<boolean> {
  publish({ error: null });
  try {
    if (!socket?.connected) {
      // Guest creation is only triggered by the player's explicit room-entry action.
      const response = await fetch('/api/guest', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Could not create a guest session. Please try again.');
      await connectSocket();
    }
    return await sendCommand(mode === 'host' ? 'room:create' : 'room:join', mode === 'host' ? { username: username.trim() } : { username: username.trim(), roomCode: roomCode.trim().toUpperCase() });
  } catch (error) {
    publish({ error: error instanceof Error ? error.message : 'Could not enter the room.', status: 'idle', pending: null });
    return false;
  }
}

export function returnToMenu() {
  const old = socket;
  socket = null;
  pendingRequestId = null;
  old?.disconnect();
  publish({ status: 'idle', room: null, pending: null, error: null, reactions: [] });
}
