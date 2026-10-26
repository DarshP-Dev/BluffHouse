import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RoomView } from '@bluff-house/shared';
import { collectRequestNotices, requestNoticeScope, SeenRequestNotices, requestTargetCanBeSeen, REQUEST_SEEN_DWELL_MS, REQUEST_SOUND_INTERVAL_MS, REQUEST_SOUND_PREFERENCE_KEY, type RequestNotice } from './request-notification-model';
import './request-notifications.css';

export { requestNoticeKey } from './request-notification-model';
export type { RequestNotice, RequestNoticeKind } from './request-notification-model';
export interface RequestNotifications {
  notices: RequestNotice[]; unseen: RequestNotice[]; unseenKeys: ReadonlySet<string>;
  acknowledge(keys: string | readonly string[]): void;
  soundEnabled: boolean; soundUnlocked: boolean; toggleSound(): void;
}
export const RequestNotificationsContext = createContext<RequestNotifications | null>(null);

function soundPreference(): boolean { try { return localStorage.getItem(REQUEST_SOUND_PREFERENCE_KEY) !== 'muted'; } catch { return true; } }
function sessionStore() { try { return sessionStorage; } catch { return undefined; } }

export function useRequestNotifications(room: RoomView | null): RequestNotifications {
  const scope = requestNoticeScope(room);
  const ledger = useMemo(() => new SeenRequestNotices(scope, sessionStore()), [scope]);
  const [, rerender] = useState(0);
  const clock = useRef({ server: room?.serverTime ?? 0, receipt: performance.now(), scope });
  if (clock.current.scope !== scope || clock.current.server !== (room?.serverTime ?? 0)) clock.current = { server: room?.serverTime ?? 0, receipt: performance.now(), scope };
  const now = clock.current.server + Math.max(0, performance.now() - clock.current.receipt);
  const notices = collectRequestNotices(room, now), unseen = ledger.unseen(notices);
  const activeKeys = useRef(new Set<string>()); activeKeys.current = new Set(notices.map(notice => notice.key));
  const acknowledge = useCallback((keys: string | readonly string[]) => {
    const active = (typeof keys === 'string' ? [keys] : keys).filter(key => activeKeys.current.has(key));
    if (ledger.acknowledge(active)) rerender(n => n + 1);
  }, [ledger]);
  useEffect(() => { if (!scope) return; const timer = window.setInterval(() => rerender(n => n + 1), 250); return () => window.clearInterval(timer); }, [scope]);

  const [soundEnabled, setSoundEnabled] = useState(soundPreference);
  const [soundUnlocked, setSoundUnlocked] = useState(false);
  const context = useRef<AudioContext | null>(null), oscillators = useRef(new Set<OscillatorNode>()), mounted = useRef(true), lastCue = useRef(-Infinity);
  const stopCue = useCallback(() => { for (const oscillator of oscillators.current) { try { oscillator.stop(); } catch { /* Already ended. */ } oscillator.disconnect(); } oscillators.current.clear(); }, []);
  const unlock = useCallback(() => {
    try {
      const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const audio = context.current ?? new Ctor(); context.current = audio;
      if (audio.state === 'running') setSoundUnlocked(true);
      else void audio.resume().then(() => { if (mounted.current && context.current === audio) setSoundUnlocked(audio.state === 'running'); }).catch(() => {});
    } catch { /* The visual notification remains available when audio is blocked. */ }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const gesture = () => unlock();
    document.addEventListener('pointerdown', gesture, { capture: true }); document.addEventListener('keydown', gesture, { capture: true });
    return () => { mounted.current = false; document.removeEventListener('pointerdown', gesture, true); document.removeEventListener('keydown', gesture, true); stopCue(); const old = context.current; context.current = null; if (old) void old.close().catch(() => {}); };
  }, [unlock, stopCue]);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === REQUEST_SOUND_PREFERENCE_KEY) setSoundEnabled(event.newValue !== 'muted'); };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, []);
  const toggleSound = useCallback(() => {
    unlock(); setSoundEnabled(previous => { const next = !previous; try { localStorage.setItem(REQUEST_SOUND_PREFERENCE_KEY, next ? 'enabled' : 'muted'); } catch { /* Local preference can remain in memory. */ } return next; });
  }, [unlock]);
  const signature = unseen.map(notice => notice.key).join('|');
  useEffect(() => {
    if (!scope || !signature || !soundEnabled || !soundUnlocked) { stopCue(); return; }
    const cue = () => {
      const audio = context.current;
      if (!audio || audio.state !== 'running' || performance.now() - lastCue.current < 1200) return;
      lastCue.current = performance.now();
      for (const [frequency, delay] of [[660, 0], [880, .13]]) {
        const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + delay;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.035, start + .025); gain.gain.exponentialRampToValueAtTime(.001, start + .22);
        oscillator.connect(gain); gain.connect(audio.destination); oscillators.current.add(oscillator);
        oscillator.onended = () => { oscillators.current.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start); oscillator.stop(start + .24);
      }
    };
    cue(); const timer = window.setInterval(cue, REQUEST_SOUND_INTERVAL_MS);
    return () => { window.clearInterval(timer); stopCue(); };
  }, [scope, signature, soundEnabled, soundUnlocked, stopCue]);
  return { notices, unseen, unseenKeys: new Set(unseen.map(notice => notice.key)), acknowledge, soundEnabled, soundUnlocked, toggleSound };
}

function unobscured(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right), top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return false;
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const style = getComputedStyle(element); if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  return !!hit && (hit === element || element.contains(hit));
}

export function RequestNotificationTarget({ notifications: supplied, noticeKeys, children, className = '' }: { notifications?: RequestNotifications | null; noticeKeys: readonly string[]; children: ReactNode; className?: string }) {
  const inherited = useContext(RequestNotificationsContext), notifications = supplied ?? inherited;
  const ref = useRef<HTMLDivElement>(null);
  const unseen = noticeKeys.filter(key => notifications?.unseenKeys.has(key));
  const signature = unseen.join('|'), acknowledge = notifications?.acknowledge;
  useEffect(() => {
    const element = ref.current; if (!element || !signature || !acknowledge) return;
    const keys = signature.split('|'); let ratio = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => requestTargetCanBeSeen({ visibleRatio: ratio, documentVisible: document.visibilityState === 'visible', focused: document.hasFocus(), unobscured: unobscured(element) });
    const schedule = () => { if (timer) clearTimeout(timer); timer = undefined; if (visible()) timer = setTimeout(() => { if (visible()) acknowledge(keys); }, REQUEST_SEEN_DWELL_MS); };
    const observer = new IntersectionObserver(entries => { ratio = entries[0]?.intersectionRatio ?? 0; schedule(); }, { threshold: [0, .5] });
    observer.observe(element); window.addEventListener('focus', schedule); window.addEventListener('blur', schedule); document.addEventListener('visibilitychange', schedule);
    return () => { observer.disconnect(); if (timer) clearTimeout(timer); window.removeEventListener('focus', schedule); window.removeEventListener('blur', schedule); document.removeEventListener('visibilitychange', schedule); };
  }, [signature, acknowledge]);
  const seenByInteraction = () => { if (unseen.length && ref.current && document.visibilityState === 'visible' && document.hasFocus() && unobscured(ref.current)) acknowledge?.(unseen); };
  return <div ref={ref} className={`request-notification-target ${unseen.length ? 'request-unseen' : ''} ${className}`} data-unseen={unseen.length ? 'true' : 'false'} data-notice-keys={noticeKeys.join(' ')} onPointerDownCapture={seenByInteraction} onFocusCapture={seenByInteraction}>{unseen.length > 0 && <span className="request-unseen-label" role="status">New request</span>}{children}</div>;
}

export function RequestSoundToggle({ notifications: supplied }: { notifications?: RequestNotifications | null }) {
  const inherited = useContext(RequestNotificationsContext), notifications = supplied ?? inherited;
  if (!notifications) return null;
  return <button type="button" className="request-sound-toggle" aria-label={notifications.soundEnabled ? 'Mute request sounds' : 'Unmute request sounds'} aria-pressed={notifications.soundEnabled} data-sound-unlocked={notifications.soundUnlocked ? 'true' : 'false'} onClick={notifications.toggleSound} title={notifications.soundEnabled && !notifications.soundUnlocked ? 'Request sounds start after you interact with this page.' : undefined}><span aria-hidden="true">{notifications.soundEnabled ? '♪' : '♩'}</span> Request sounds {notifications.soundEnabled ? 'on' : 'off'}</button>;
}
