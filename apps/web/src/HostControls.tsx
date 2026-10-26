import { useState } from 'react';
import type { RoomSettings, RoomView } from '@bluff-house/shared';
import { sendCommand } from './connection';
import './host-controls.css';

const features: { key: Exclude<keyof RoomSettings, 'maxPlayers'>; label: string }[] = [
  { key: 'house', label: 'House auction and player dealer' }, { key: 'duels', label: 'Direct duels' }, { key: 'overthrow', label: 'House overthrow' }, { key: 'chaos', label: 'Chaos cards' }, { key: 'bounties', label: 'Bounties' }, { key: 'deals', label: 'Split or Steal deals' }, { key: 'doubleDown', label: 'Ordinary Double Down' }, { key: 'extraClaims', label: 'Additional bluff claims' },
];

export default function HostControls({ room, disabled }: { room: RoomView; disabled: boolean }) {
  const [settings, setSettings] = useState<RoomSettings>({ ...room.settings });
  const [visibility, setVisibility] = useState(room.visibility);
  const [rounds, setRounds] = useState(room.roundLimit);
  const [startingChips, setStartingChips] = useState(room.startingChips);
  const [bettingSeconds, setBettingSeconds] = useState(room.bettingSeconds);
  const [turnSeconds, setTurnSeconds] = useState(room.turnSeconds);
  const host = room.viewerId === room.hostId;
  const occupied = room.players.filter(player => !player.departed).length;
  const dependency = settings.overthrow && (!settings.house || !settings.duels) ? 'House overthrow requires House and direct duels.' : settings.bounties && !settings.duels ? 'Bounties require direct duels.' : settings.maxPlayers < occupied ? 'Capacity must include every occupied seat.' : null;
  return <section className="room-settings-editor host-controls" aria-label="Room settings"><h2>Host Settings</h2><form onSubmit={event => { event.preventDefault(); if (host && !dependency) void sendCommand('lobby:settings', { settings, rounds, finale: room.finaleEnabled, visibility, startingChips, bettingSeconds, turnSeconds }); }}><fieldset disabled={disabled || !host}>
    <div className="host-numeric-settings">
      <label htmlFor="settings-rounds">Blackjack rounds<input id="settings-rounds" type="number" min={1} max={20} step={1} value={rounds} onChange={event => setRounds(Number(event.target.value))} /></label>
      <label htmlFor="settings-stack">Starting chips<input id="settings-stack" type="number" min={100} max={100000} step={10} value={startingChips} onChange={event => setStartingChips(Number(event.target.value))} /></label>
      <label htmlFor="settings-betting">Betting timer (seconds)<input id="settings-betting" type="number" min={5} max={120} step={1} value={bettingSeconds} onChange={event => setBettingSeconds(Number(event.target.value))} /></label>
      <label htmlFor="settings-turn">Decision timer (seconds)<input id="settings-turn" type="number" min={5} max={120} step={1} value={turnSeconds} onChange={event => setTurnSeconds(Number(event.target.value))} /></label>
    </div>
    <label htmlFor="settings-visibility">Table visibility<select id="settings-visibility" value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="PRIVATE">Private · code invitations</option><option value="PUBLIC">Public · Quick Play with default settings</option></select></label>
    <label htmlFor="settings-capacity">Player capacity<select id="settings-capacity" value={settings.maxPlayers} onChange={event => setSettings(current => ({ ...current, maxPlayers: Number(event.target.value) }))}>{[2, 3, 4, 5, 6].map(capacity => <option key={capacity} value={capacity} disabled={capacity < occupied}>{capacity} players</option>)}</select></label>
    <div className="settings-switches">{features.map(item => <label key={item.key}><input type="checkbox" checked={settings[item.key]} disabled={room.mode === 'CLASSIC'} onChange={event => setSettings(current => ({ ...current, [item.key]: event.target.checked }))} />{item.label}</label>)}</div>
    {dependency && <p className="settings-dependency" role="status">{dependency}</p>}
    <p className="field-hint">{host ? 'Changes reset readiness. Settings lock when the match starts.' : 'The host controls these settings.'}</p>
    <button className="button secondary full-width" type="submit" disabled={!!dependency}>Apply Room Settings</button>
  </fieldset></form></section>;
}
