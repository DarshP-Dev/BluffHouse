import type { Rank } from '@bluff-house/shared';
import { fixture, shoe } from './core.js';

/** Normal rounds and a real auction finish before the final Blackjack shoe. */
export function fundedFinale(options: { players?: number; pot?: number; ranks?: Rank[]; enter?: boolean; bidder?: number; betting?: boolean; bettingSeconds?: number; turnSeconds?: number } = {}) {
  const players = options.players ?? 3, f = fixture({ mode: 'PARTY', finale: true, players });
  if (options.bettingSeconds || options.turnSeconds) {
    const v = f.view(), result = f.send(f.host, 'lobby:settings', { settings: v.settings, rounds: v.roundLimit, finale: true, visibility: v.visibility, bettingSeconds: options.bettingSeconds ?? v.bettingSeconds, turnSeconds: options.turnSeconds ?? v.turnSeconds });
    if (result.status !== 'ok') throw new Error(`Finale timers failed: ${result.code}`);
  }
  f.start();
  const pot = options.pot ?? 100;
  if (pot) {
    const bid = f.send(f.actors[options.bidder ?? players - 1]!, 'house:bid', { amount: pot });
    if (bid.status !== 'ok') throw new Error(`Finale funding failed: ${bid.code}`);
  }
  f.advance(22000);
  for (let n = 0; n < 100; n++) {
    const view = f.view(); if (view.phase === 'ROUND_RESULT' && view.round === view.roundLimit) break;
    if (view.deadline === null) throw new Error(`Finale progression stopped in ${view.phase}`);
    f.advance(view.deadline - view.serverTime); if (n === 99) throw new Error('Finale progression exceeded its bounded fixture');
  }
  // Three entrants: Player 1 has 19, Player 2 has 17 and the House has 18.
  f.manager.e.shoe = () => shoe(options.ranks ?? ['10', '9', '10', '9', '8', '8', '10', '2', '3']);
  if (options.enter !== false) { advanceFinale(f); if (!options.betting) dealShadow(f); }
  return f;
}
export type ShadowFixture = ReturnType<typeof fundedFinale>;

export function advanceFinale(f: ShadowFixture) {
  const v = f.view(); if (v.deadline === null) throw new Error(`No deadline in ${v.phase}`); f.advance(Math.max(0, v.deadline - v.serverTime));
}
export function dealShadow(f: ShadowFixture, stakes: number[] = []) {
  if (f.view().phase !== 'SHADOW_BETTING') throw new Error(`Expected Shadow betting, got ${f.view().phase}`);
  stakes.forEach((amount, seat) => {
    if (!amount) return; const result = f.send(f.actors[seat]!, 'bet:submit', { amount });
    if (result.status !== 'ok') throw new Error(`Shadow wager failed: ${result.code}`);
  });
  advanceFinale(f);
  if (f.view().phase !== 'SHADOW_TURN') throw new Error(`Expected Shadow turns, got ${f.view().phase}`);
}
export function finishFinale(f: ShadowFixture) {
  for (let n = 0; n < 100 && f.view().phase !== 'RESULTS'; n++) advanceFinale(f);
  if (f.view().phase !== 'RESULTS') throw new Error('Finale failed to reach results');
}
export function standTo(f: ShadowFixture, seat: number) {
  for (let n = 0; n < 12 && f.view().phase === 'SHADOW_TURN' && f.view().party!.shadow!.activePlayerId !== f.actors[seat]; n++) {
    const active = f.view().party!.shadow!.activePlayerId;
    if (!active) { advanceFinale(f); continue; }
    const result = f.send(active, 'shadow:stand'); if (result.status !== 'ok') throw new Error(`Truthful stand failed: ${result.code}`);
  }
}
export function standRemaining(f: ShadowFixture) {
  for (let n = 0; n < 20 && !['SHADOW_RESULT', 'RESULTS'].includes(f.view().phase); n++) {
    if (f.view().phase === 'SHADOW_TURN' && f.view().party!.shadow!.activePlayerId) {
      const result = f.send(f.view().party!.shadow!.activePlayerId!, 'shadow:stand');
      if (result.status !== 'ok') throw new Error(`Truthful stand failed: ${result.code}`);
    } else advanceFinale(f);
  }
}
export function declareShadow(f: ShadowFixture, seat: number, total: 21 = 21) {
  const result = f.send(f.actors[seat]!, 'shadow:claim', { declaredTotal: total });
  if (result.status !== 'ok') throw new Error(`Shadow claim failed: ${result.code}`); return result;
}
