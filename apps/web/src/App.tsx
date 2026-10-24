import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { EMOJIS, RULES, validName, type Card, type Phase, type PlayerView, type RoomView } from '@bluff-house/shared';
import { clearError, enterRoom, getSnapshot, initializeConnection, returnToMenu, sendCommand, subscribe, type ConnectionState } from './connection';

const chips = (value: number) => value.toLocaleString('en-CA');
const suits = { S: '♠', H: '♥', D: '♦', C: '♣' };
const phaseNames: Record<Phase, string> = { LOBBY: 'Private lobby', BETTING: 'Place your bets', DEALING: 'Dealing cards', PLAYER_TURN: 'Player turns', BLUFF_OFFER: 'Call My Bluff', BLUFF_REVEAL: 'The reveal', DEALER_TURN: 'Dealer plays', ROUND_RESULT: 'Round settled', WAITING_FOR_PLAYERS: 'Waiting for players', RESULTS: 'The final reckoning' };
const initials = (name: string) => name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`} aria-label="Bluff House"><span className="brand-mark" aria-hidden="true">♠</span><span>BLUFF<span className="brand-house">HOUSE</span></span></div>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={onClose} aria-labelledby="dialog-title" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-top"><span className="eyebrow">YOU'RE ON THE GUEST LIST</span><button className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div>
    <h2 id="dialog-title">{title}</h2>{children}
  </dialog>;
}

function HowToPlay({ onClose }: { onClose: () => void }) {
  return <Modal title="Know the table." onClose={onClose} wide>
    <p className="muted">A private Blackjack table for 2–6 friends. All chips are fictional.</p>
    <div className="rules-grid">
      <section><span className="rule-number">01</span><h3>Bring your people</h3><p>Create a room, share its code, and ready up. Everyone starts with 1,000 chips. The host starts when at least two connected players are ready.</p></section>
      <section><span className="rule-number">02</span><h3>Place a little trust</h3><p>Bet 50–250 chips in steps of 50. Edit or withdraw before the timer ends. Skip a wager to sit out that round.</p></section>
      <section><span className="rule-number">03</span><h3>Get close to 21</h3><p>Hit for another card or stand to hold. Face cards count as 10; Aces count as 1 or 11. Going over 21 busts. The dealer stands on all 17s.</p></section>
      <section><span className="rule-number">04</span><h3>Make the chips count</h3><p>A win pays 1:1 profit; an initial Blackjack pays 3:2. Ties return your stake. After three rounds, the highest balance wins. Equal balances share the crown.</p></section>
      <section><span className="rule-number">05</span><h3>Call My Bluff</h3><p>Once per round, on your turn with a hard total of 12–20, stake 50–250 chips on “My next hit will not bust.” The first rival to match your stake within 8 seconds accepts. One card is drawn immediately: stay at 21 or below and you win the pot; bust and your challenger wins.</p></section>
      <section><span className="rule-number">06</span><h3>Keep your nerve</h3><p>No challenger? Your reserved stake returns and your turn resumes with at least 5 seconds. A challenge winner receives both stakes, for a profit equal to one stake. Stood, busted, and skipped players can still challenge if they have enough chips. Blackjack settles separately.</p></section>
    </div>
    <p className="rule-note">Your seat follows this browser profile. Refresh to reconnect; use separate browser profiles or devices for different players.</p>
    <button className="button primary full-width" onClick={onClose}>I'm in</button>
  </Modal>;
}

function EntryForm({ mode, onClose, state }: { mode: 'host' | 'join'; onClose: () => void; state: ConnectionState }) {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || !!state.pending;
  return <Modal title={mode === 'host' ? 'Your table awaits.' : 'Pull up a chair.'} onClose={onClose}>
    <p className="muted">{mode === 'host' ? 'Create a private room and invite your friends.' : 'Enter the code your host shared with you.'}</p>
    <form onSubmit={async event => {
      event.preventDefault();
      if (!validName(username)) { setValidation('Use 2–16 letters, numbers, spaces, underscores, or hyphens.'); return; }
      if (mode === 'join' && !code.trim()) { setValidation('Enter your room code.'); return; }
      setValidation(null); setSubmitting(true);
      if (await enterRoom(mode, username, code)) onClose();
      setSubmitting(false);
    }}>
      <label htmlFor="username">Guest name</label>
      <input autoFocus id="username" name="username" autoComplete="nickname" placeholder="What should we call you?" value={username} onChange={event => setUsername(event.target.value)} maxLength={16} required disabled={busy} aria-describedby="name-hint" />
      <p id="name-hint" className="field-hint">2–16 characters. Your friends will see this name.</p>
      {mode === 'join' && <><label htmlFor="room-code">Room code</label><input id="room-code" name="roomCode" className="code-input" placeholder="ROOM CODE" value={code} onChange={event => setCode(event.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={8} required disabled={busy} /></>}
      {(validation || state.error) && <div className="form-error" role="alert">{validation || state.error}</div>}
      <button className="button primary full-width" type="submit" disabled={busy}>{busy ? 'Finding your seat…' : mode === 'host' ? 'Create Room' : 'Join Room'}<span aria-hidden="true">↗</span></button>
    </form>
    <p className="fine-print">No account. No real money. Just your best poker face.</p>
  </Modal>;
}

function Menu({ state }: { state: ConnectionState }) {
  const [modal, setModal] = useState<'host' | 'join' | 'rules' | null>(null);
  const blocked = state.status === 'checking' || state.status === 'connecting';
  return <main className="menu-page">
    <header className="menu-header"><Brand small /><span className="header-note"><span className="status-dot" /> PRIVATE TABLES. REAL RIVALRIES.</span></header>
    <section className="menu-hero">
      <div className="hero-copy"><div className="eyebrow"><span className="gold-line" /> THE NIGHT BELONGS TO THE BOLD</div><h1>Good friends.<br /><em>Bad intentions.</em></h1><p className="hero-tagline">Trust Nobody. Call Their Bluff.</p><p className="hero-description">A seat at the table. A stack of chips.<br />A room full of people who swear you can trust them.</p>
        <div className="entry-actions"><button className="button primary" disabled={blocked} onClick={() => { clearError(); setModal('host'); }}>Host Room <span aria-hidden="true">↗</span></button><button className="button secondary" disabled={blocked} onClick={() => { clearError(); setModal('join'); }}>Join Room <span aria-hidden="true">→</span></button></div>
        <button className="text-button how-link" onClick={() => setModal('rules')}><span className="play-circle" aria-hidden="true">?</span> First time at the table? <strong>How to play</strong></button>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-glow" /><div className="art-caption">THE HOUSE ALWAYS REMEMBERS</div><div className="art-card art-card-back"><span>BH</span></div><div className="art-card art-card-queen"><span className="art-card-corner">Q<small>♥</small></span><span className="art-symbol">♥</span><span className="art-card-corner bottom">Q<small>♥</small></span></div><div className="art-card art-card-ace"><span className="art-card-corner">A<small>♠</small></span><span className="art-symbol">♠</span><span className="art-card-corner bottom">A<small>♠</small></span></div><div className="art-chip chip-red"><span>50</span></div><div className="art-chip chip-gold"><span>100</span></div><div className="art-chip chip-black"><span>BH</span></div><span className="art-spark spark-one">✦</span><span className="art-spark spark-two">✦</span></div>
    </section>
    <footer className="menu-footer"><div><span className="footer-symbol">♣</span><span><strong>2–6 PLAYERS</strong>Bring your own rivals</span></div><div><span className="footer-symbol">♦</span><span><strong>FICTIONAL CHIPS</strong>All the stakes. None of the cash.</span></div><div><span className="footer-symbol">♠</span><span><strong>PRIVATE ROOMS</strong>Your code. Your company.</span></div></footer>
    {state.error && !modal && <div className="menu-error" role="alert">{state.error}<button className="text-button" onClick={clearError}>Dismiss</button></div>}
    {modal === 'rules' && <HowToPlay onClose={() => setModal(null)} />}
    {(modal === 'host' || modal === 'join') && <EntryForm mode={modal} onClose={() => setModal(null)} state={state} />}
  </main>;
}

function Avatar({ player, size = '' }: { player: PlayerView; size?: string }) {
  return <span className={`avatar avatar-${player.seat % 6} ${size}`} aria-hidden="true">{initials(player.name)}</span>;
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="room-code"><span className="eyebrow">ROOM CODE</span><strong>{code}</strong><button className="copy-button" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setFailed(false); window.setTimeout(() => setCopied(false), 2000); } catch { setFailed(true); } }} aria-label={`Copy room code ${code}`}>{copied ? '✓ Copied' : 'Copy Code'}</button>{failed && <small role="status">Select and copy the code above.</small>}</div>;
}

function RoomHeader({ room, onLeave }: { room: RoomView; onLeave: () => void }) {
  return <header className="room-header"><Brand small /><div className="room-header-right"><span className="room-label">PRIVATE ROOM <strong>{room.code}</strong></span><span className="live-pill"><span className="status-dot" /> LIVE</span><button className="text-button leave-button" onClick={onLeave}>Leave Room <span aria-hidden="true">↗</span></button></div></header>;
}

function Lobby({ room, disabled }: { room: RoomView; disabled: boolean }) {
  const me = room.players.find(player => player.id === room.viewerId);
  const connected = room.players.filter(player => player.connected && !player.departed);
  const canStart = connected.length >= 2 && connected.every(player => player.ready);
  const host = room.hostId === room.viewerId;
  return <main className="lobby-page"><div className="lobby-intro"><div><span className="eyebrow">THE EVENING STARTS HERE</span><h1>A familiar company.<br /><em>An uncertain outcome.</em></h1><p className="muted">Share your code. Gather your friends. Keep your tells to yourself.</p></div><CopyCode code={room.code} /></div>
    <div className="lobby-columns"><section className="guest-list"><div className="section-heading"><h2>Your table</h2><span>{connected.length} / {RULES.maxPlayers} connected</span></div><div className="lobby-seats">{Array.from({ length: RULES.maxPlayers }, (_, index) => {
      const player = room.players.find(item => item.seat === index && !item.departed);
      return player ? <div className={`lobby-seat ${player.id === room.viewerId ? 'your-seat' : ''}`} key={index}><Avatar player={player} /><div className="guest-info"><strong>{player.name} {player.id === room.viewerId && <small>YOU</small>}</strong><span>{player.id === room.hostId ? '♛ Host' : 'Guest'} <span aria-hidden="true">·</span> {chips(player.balance)} chips</span></div><span className={`ready-label ${player.connected && player.ready ? 'is-ready' : ''}`}>{!player.connected ? 'Disconnected' : player.ready ? '✓ Ready' : 'Not ready'}</span></div> : <div className="lobby-seat empty-seat" key={index}><span className="empty-avatar">+</span><span>Waiting for a rival<span className="empty-sub">Seat {index + 1} is open</span></span></div>;
    })}</div></section>
    <aside className="lobby-aside"><div className="table-note"><span className="eyebrow">TONIGHT'S TABLE</span><h2>Classic Blackjack</h2><div className="lobby-rule"><span>Starting stack</span><strong>1,000 <small>chips</small></strong></div><div className="lobby-rule"><span>Match length</span><strong>3 <small>rounds</small></strong></div><div className="lobby-rule"><span>Blackjack bets</span><strong>50–250</strong></div><div className="lobby-rule"><span>Natural Blackjack</span><strong>Pays 3:2</strong></div><p>Highest final balance takes the crown. Fictional chips only.</p></div><div className="ready-controls"><button className={`button full-width ${me?.ready ? 'secondary' : 'primary'}`} disabled={disabled || !me} onClick={() => void sendCommand('lobby:ready', { ready: !me?.ready })}>{me?.ready ? 'Cancel Ready' : 'Ready Up'}<span aria-hidden="true">{me?.ready ? '✓' : '→'}</span></button>{host && <button className="button primary full-width" disabled={disabled || !canStart} onClick={() => void sendCommand('match:start')}>Start Game <span aria-hidden="true">↗</span></button>}<p className="fine-print">{connected.length < 2 ? 'At least two connected players are needed.' : !canStart ? 'Waiting for everyone to ready up.' : host ? 'Everyone is ready. The table is yours.' : 'Everyone is ready. Waiting for the host to start.'}</p></div></aside></div>
  </main>;
}

export function PlayingCard({ card, small = false }: { card: Card | null; small?: boolean }) {
  if (!card) return <div className={`playing-card card-hidden ${small ? 'card-small' : ''}`} aria-label="Face-down card"><span aria-hidden="true">♠</span></div>;
  return <div className={`playing-card ${card.suit === 'H' || card.suit === 'D' ? 'red-card' : ''} ${small ? 'card-small' : ''}`} aria-label={`${card.rank} of ${{ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[card.suit]}`}><span className="card-corner">{card.rank}<small>{suits[card.suit]}</small></span><span className="card-suit" aria-hidden="true">{suits[card.suit]}</span><span className="card-corner card-corner-bottom" aria-hidden="true">{card.rank}<small>{suits[card.suit]}</small></span></div>;
}

export function Countdown({ deadline, now, label }: { deadline: number | null; now: number; label: string }) {
  const seconds = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
  return seconds === null ? null : <span className={`countdown ${seconds <= 5 ? 'countdown-urgent' : ''}`} aria-label={`${label}: ${seconds} seconds`}><span aria-hidden="true">◷</span> {seconds}<small>s</small></span>;
}

function PlayerSeat({ player, room }: { player: PlayerView; room: RoomView }) {
  const active = room.activePlayerId === player.id && room.phase === 'PLAYER_TURN';
  const you = player.id === room.viewerId;
  return <article className={`player-seat ${active ? 'active-seat' : ''} ${you ? 'local-seat' : ''} ${player.departed || !player.connected ? 'absent-seat' : ''}`} aria-label={`${player.name}${you ? ', you' : ''}${active ? ', active turn' : ''}`}>
    <div className="seat-heading"><Avatar player={player} size="avatar-small" /><div><strong>{player.name} {you && <small>YOU</small>}</strong><span>{player.departed ? 'Left the table' : !player.connected ? 'Disconnected' : active ? '● Thinking…' : player.id === room.hostId ? 'Host' : 'At the table'}</span></div><div className="seat-balance">{chips(player.balance)}<small>balance</small></div></div>
    <div className="seat-hand">{player.hand.length ? <><div className="cards fan-cards">{player.hand.map(card => <PlayingCard card={card} small key={card.id} />)}</div><span className={`hand-total ${player.value?.bust ? 'total-bust' : ''} ${player.value?.natural ? 'total-blackjack' : ''}`}>{player.value?.bust ? 'BUST' : player.value?.natural ? 'BJ' : player.value?.total}<small>{player.value?.soft && !player.value.natural && !player.value.bust ? 'SOFT' : ''}</small></span></> : <span className="no-hand">{room.phase === 'BETTING' ? player.reserved > 0 ? 'Wager placed' : 'Awaiting wager' : player.status === 'observer' || player.status === 'skipped' ? 'Watching this round' : 'No hand this round'}</span>}</div>
    <div className="seat-bottom"><span>{player.status === 'stood' ? 'Standing' : player.status === 'bust' ? 'Busted' : player.status === 'natural' ? 'Blackjack' : player.status === 'playing' ? 'In play' : player.status === 'won' ? 'Winner' : player.status.replaceAll('_', ' ')}</span>{player.committed > 0 ? <strong><span className="mini-chip" />{chips(player.committed)} committed</strong> : player.reserved > 0 ? <strong><span className="mini-chip" />{chips(player.reserved)} reserved</strong> : <span>—</span>}</div>
  </article>;
}

function Standings({ room }: { room: RoomView }) {
  const ordered = room.players.filter(player => player.status !== 'observer').sort((a, b) => b.balance - a.balance || a.seat - b.seat);
  return <section className="rail-section standings"><h2><span aria-hidden="true">♛</span> The standings</h2>{ordered.map((player, index) => <div className="standing-row" key={player.id}><span className="standing-rank">{index + 1}</span><Avatar player={player} size="avatar-tiny" /><span className="standing-name">{player.name}{player.id === room.viewerId && <small>YOU</small>}</span><strong>{chips(player.balance)}</strong></div>)}</section>;
}

export function EventFeed({ room }: { room: RoomView }) {
  const events = room.events.slice(-7).reverse();
  return <section className="rail-section event-section"><h2>Table talk <span className="live-tiny">LIVE</span></h2><div className="event-feed" aria-live="polite" aria-relevant="additions">{events.length ? events.map(event => <div className={`table-event event-${event.kind}`} key={event.id}><span className="event-dot" /><p>{event.text}</p></div>) : <p className="muted">The night is just getting started.</p>}</div></section>;
}

function BluffControls({ room, me, disabled }: { room: RoomView; me?: PlayerView; disabled: boolean }) {
  const [stake, setStake] = useState(100);
  const eligible = !!me?.value && !me.value.soft && me.value.total >= 12 && me.value.total <= 20 && !me.bluffUsed;
  const amount = me && me.available < stake && me.available >= 50 ? Math.floor(me.available / 50) * 50 : stake;
  return <div className="bluff-controls"><div><strong>My next hit will not bust.</strong><p>{me?.bluffUsed ? 'You have used your one offer this round.' : !eligible ? 'Offer once per round with a hard total of 12–20.' : 'Stake chips and give your rivals 8 seconds to call you.'}</p></div><div className="bluff-stakes" role="group" aria-label="Choose your bluff stake">{[50, 100, 150, 200, 250].map(value => <button className={`bet-chip ${amount === value ? 'selected-chip' : ''}`} key={value} disabled={disabled || !eligible || value > (me?.available ?? 0)} aria-label={`Bluff ${value} chips`} aria-pressed={amount === value} onClick={() => setStake(value)}>{value}</button>)}</div><button className="button bluff-button" disabled={disabled || !eligible || amount > (me?.available ?? 0)} onClick={() => void sendCommand('bluff:offer', { claimType: 'NEXT_HIT_SAFE', amount })}>Call My Bluff <span>{chips(amount)}</span></button>{eligible && (me?.available ?? 0) < 50 && <p className="field-hint">You need 50 available chips to offer.</p>}</div>;
}

function BluffEvent({ room, disabled, now }: { room: RoomView; disabled: boolean; now: number }) {
  const bluff = room.bluff;
  if (!bluff || !['BLUFF_OFFER', 'BLUFF_REVEAL'].includes(room.phase)) return null;
  const me = room.players.find(player => player.id === room.viewerId);
  const claimant = room.players.find(player => player.id === bluff.claimantId);
  const winner = room.players.find(player => player.id === bluff.winnerId);
  const own = bluff.claimantId === room.viewerId;
  const open = room.phase === 'BLUFF_OFFER' && bluff.status === 'open';
  const canAccept = !!me && !own && me.connected && !me.departed && me.status !== 'observer' && me.available >= bluff.amount;
  return <section className={`bluff-event ${open ? 'bluff-open' : 'bluff-revealed'}`} aria-label={open ? 'Bluff challenge' : 'Bluff result'} aria-live="polite"><div className="bluff-event-heading"><span className="eyebrow">{open ? 'A CHALLENGE ON THE TABLE' : 'THE BLUFF IS SETTLED'}</span>{open && <Countdown deadline={bluff.deadline} now={now} label="Challenge closes" />}</div><h2>{open ? `${claimant?.name ?? 'A player'} says…` : `${winner?.name ?? 'The winner'} takes the pot.`}</h2>{open ? <><blockquote>“My next hit will not bust.”</blockquote><p><strong>{chips(bluff.amount)} chips</strong> each · <strong>{chips(bluff.amount * 2)} chip pot</strong>. The first funded challenger gets the call.</p>{own ? <p>Your stake is reserved. Waiting for a rival to accept.</p> : <button className="button primary" disabled={disabled || !canAccept || now >= bluff.deadline} onClick={() => void sendCommand('bluff:accept')}>Accept Challenge <span>{chips(bluff.amount)}</span></button>}{!own && !canAccept && <p className="field-hint">You need an active match seat and {chips(bluff.amount)} available chips to challenge.</p>}</> : <div className="bluff-reveal-content">{bluff.card && <PlayingCard card={bluff.card} small />}<div><p>{claimant?.name ?? 'The claimant'} {bluff.winnerId === bluff.claimantId ? 'stayed safe.' : 'busted.'}</p><p><strong>{chips(bluff.pot ?? bluff.amount * 2)} chips paid</strong> · {chips(bluff.amount)} chip profit.</p><p className="field-hint">Both stakes are settled. Blackjack continues after the reveal.</p></div></div>}</section>;
}

function Reactions({ state, disabled }: { state: ConnectionState; disabled: boolean }) {
  const [cooling, setCooling] = useState(false);
  const cooldown = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (cooldown.current) clearTimeout(cooldown.current); }, []);
  return <section className="reactions" aria-label="Table reactions"><div className="reaction-buttons" role="group" aria-label="Send a reaction">{EMOJIS.map(emoji => <button className="reaction-button" key={emoji} aria-label={`React ${emoji}`} disabled={disabled || cooling} onClick={() => { setCooling(true); cooldown.current = setTimeout(() => setCooling(false), 1000); void sendCommand('reaction:send', { emoji }); }}>{emoji}</button>)}</div><div className="reaction-stream" aria-live="polite" aria-relevant="additions">{state.reactions.slice(-4).map(event => <span className="reaction-bubble" key={event.id}>{event.text}</span>)}</div></section>;
}

export function ActionPanel({ room, me, disabled, now }: { room: RoomView; me?: PlayerView; disabled: boolean; now: number }) {
  const [amount, setAmount] = useState(100);
  useEffect(() => { setAmount(100); }, [room.bettingId]);
  const canBet = !!me && !me.departed && me.status !== 'observer' && me.available + me.reserved >= 50;
  const betting = room.phase === 'BETTING';
  const yourTurn = room.phase === 'PLAYER_TURN' && room.activePlayerId === room.viewerId;
  const deadlinePassed = room.deadline !== null && now >= room.deadline;
  const activeName = room.players.find(player => player.id === room.activePlayerId)?.name;
  return <section className={`action-panel ${yourTurn ? 'your-turn-panel' : ''}`} aria-label="Your game controls"><div className="your-bank"><span className="eyebrow">YOUR AVAILABLE CHIPS</span><strong><span className="mini-chip" />{chips(me?.available ?? 0)}</strong><div className="bank-details"><span>Balance <b>{chips(me?.balance ?? 0)}</b></span><span>Reserved <b>{chips(me?.reserved ?? 0)}</b></span><span>Committed <b>{chips(me?.committed ?? 0)}</b></span></div></div><div className="action-content">
    {betting ? <><div className="action-label"><strong>{canBet ? me?.reserved ? 'Your wager is reserved.' : 'What are you willing to risk?' : 'Watching this round'}</strong><span>{canBet ? 'Submit before betting closes' : 'You need 50 available chips to place a wager.'}</span></div>{canBet && <div className="bet-controls"><div className="bet-chips" role="group" aria-label="Choose your wager">{[50, 100, 150, 200, 250].map(value => <button className={`bet-chip ${amount === value ? 'selected-chip' : ''}`} key={value} disabled={disabled || deadlinePassed || value > (me?.available ?? 0) + (me?.reserved ?? 0)} onClick={() => setAmount(value)} aria-pressed={amount === value} aria-label={`Bet ${value} chips`}>{value}</button>)}</div><button className="button primary" disabled={disabled || deadlinePassed || amount > (me?.available ?? 0) + (me?.reserved ?? 0)} onClick={() => void sendCommand('bet:submit', { amount })}>{me?.reserved ? 'Update Bet' : 'Place Bet'}<span>{chips(amount)}</span></button>{!!me?.reserved && <button className="text-button withdraw-button" disabled={disabled || deadlinePassed} onClick={() => void sendCommand('bet:withdraw')}>Withdraw</button>}</div>}</> : yourTurn ? <><div className="action-label"><strong>Your move, {me?.name}.</strong><span>Hit for a card or stand with your hand.</span></div><div className="turn-controls"><button className="button primary" disabled={disabled || deadlinePassed} onClick={() => void sendCommand('turn:hit')}>Hit <span aria-hidden="true">+</span></button><button className="button secondary" disabled={disabled || deadlinePassed} onClick={() => void sendCommand('turn:stand')}>Stand <span aria-hidden="true">■</span></button></div><BluffControls room={room} me={me} disabled={disabled || deadlinePassed} /></> : <div className="waiting-action"><span className="waiting-symbol" aria-hidden="true">♠</span><div><strong>{room.phase === 'PLAYER_TURN' ? `${activeName || 'A player'} is making their move.` : room.phase === 'ROUND_RESULT' ? 'The chips have spoken.' : room.phase === 'DEALER_TURN' ? 'Let the dealer do the talking.' : room.phase === 'WAITING_FOR_PLAYERS' ? 'Keeping your table open.' : 'Watch the table.'}</strong><span>{room.phase === 'ROUND_RESULT' ? 'The next round follows shortly.' : room.phase === 'WAITING_FOR_PLAYERS' ? 'Waiting for enough players to reconnect.' : room.phase === 'PLAYER_TURN' ? 'All hands are public. Keep an eye on the competition.' : phaseNames[room.phase]}</span></div></div>}
  </div></section>;
}

function Table({ room, disabled, now }: { room: RoomView; disabled: boolean; now: number }) {
  const me = room.players.find(player => player.id === room.viewerId);
  return <main className="table-page"><div className="table-titlebar"><div><span className="eyebrow">CLASSIC BLACKJACK</span><h1>{phaseNames[room.phase]}</h1></div><div className="round-status"><span>ROUND <strong>{room.round}</strong><small>/ {RULES.rounds}</small></span><Countdown deadline={room.deadline} now={now} label={phaseNames[room.phase]} /></div></div>
    {room.recoveryDeadline && <div className="recovery-note" role="status">Waiting for more players to reconnect. Committed wagers still settle.<Countdown deadline={room.recoveryDeadline} now={now} label="Recovery window" /></div>}
    <div className="table-layout"><div className="game-column"><section className="felt-table" aria-label="Blackjack table"><div className="felt-border" /><div className="dealer-area"><span className="dealer-label">THE DEALER <span>STANDS ON ALL 17s</span></span><div className="dealer-hand cards">{room.dealer.length ? room.dealer.map((card, index) => <PlayingCard card={card} key={card?.id ?? `hidden-${index}`} />) : <><div className="empty-card-outline" /><div className="empty-card-outline" /></>}{room.dealerValue && <span className="dealer-total">{room.dealerValue.bust ? 'BUST' : room.dealerValue.natural ? 'BLACKJACK' : room.dealerValue.total}</span>}</div></div><div className="felt-brand" aria-hidden="true"><span>♠</span> BLUFF HOUSE <small>BLACKJACK PAYS 3 TO 2</small></div><div className="player-grid">{room.players.map(player => <PlayerSeat key={player.id} player={player} room={room} />)}</div></section><BluffEvent room={room} disabled={disabled} now={now} /><ActionPanel room={room} me={me} disabled={disabled} now={now} /></div><aside className="table-rail"><Standings room={room} /><EventFeed room={room} /><div className="rail-footnote">PLAY YOUR CARDS.<br /><span>Read your friends.</span></div></aside></div>
  </main>;
}

function Results({ room, disabled }: { room: RoomView; disabled: boolean }) {
  const results = room.results;
  if (!results) return <main className="results-page"><h1>Settling the table…</h1></main>;
  const winners = results.standings.filter(player => results.winners.includes(player.id));
  return <main className="results-page"><span className="eyebrow">{results.reason ? 'MATCH ENDED EARLY' : 'THE FINAL RECKONING'}</span><div className="winner-crown" aria-hidden="true">♛</div><h1>{winners.map(player => player.name).join(' & ')}<br /><em>{winners.length > 1 ? 'share the crown.' : 'takes the crown.'}</em></h1>{results.reason && <p className="muted">{results.reason}</p>}<p className="result-intro">The cards are down. The scores are settled.</p><div className="results-board"><div className="result-row result-table-heading"><span>PLACE</span><span>PLAYER</span><span>BLUFF W / L</span><span>FINAL CHIPS</span></div>{results.standings.map((player, index) => <div className={`result-row ${results.winners.includes(player.id) ? 'winner-row' : ''}`} key={player.id}><strong>{results.winners.includes(player.id) ? '♛' : index + 1}</strong><span>{player.name}{player.id === room.viewerId && <small>YOU</small>}</span><span>{player.bluffWins} / {player.bluffLosses}</span><strong>{chips(player.balance)}</strong></div>)}</div><div className="biggest-bluff"><span className="eyebrow">BIGGEST BLUFF</span>{results.biggestBluff ? <p>{results.standings.find(player => player.id === results.biggestBluff?.winnerId)?.name ?? 'The winner'} won {chips(results.biggestBluff.pot ?? results.biggestBluff.amount * 2)} chips against {results.standings.find(player => player.id === (results.biggestBluff?.winnerId === results.biggestBluff?.claimantId ? results.biggestBluff?.challengerId : results.biggestBluff?.claimantId))?.name ?? 'their rival'}.<br /><small>{chips(results.biggestBluff.amount)} chip profit · earliest challenge wins equal-pot ties</small></p> : <p>No bluff challenges this match.</p>}</div><button className="button primary results-return" disabled={disabled} onClick={() => void sendCommand('results:return')}>Return to Lobby <span aria-hidden="true">↗</span></button><p className="fine-print">Same room. Fresh stacks. One more chance.</p></main>;
}

function ConnectionOverlay({ state }: { state: ConnectionState }) {
  if (!['reconnecting', 'replaced', 'lost'].includes(state.status)) return null;
  const recovery = state.status === 'reconnecting';
  return <div className="connection-overlay"><div className="connection-card" role="alert"><span className={recovery ? 'connection-spinner' : 'connection-symbol'} aria-hidden="true">{recovery ? '' : '♠'}</span><h2>{recovery ? 'Reconnecting to Bluff House…' : state.status === 'replaced' ? 'Your seat moved tabs.' : 'This table has closed.'}</h2><p>{recovery ? 'Restoring your seat and the latest table. Your committed wagers continue to resolve.' : state.error}</p>{!recovery && <button className="button primary full-width" onClick={returnToMenu}>Return to Menu</button>}</div></div>;
}

export default function App() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const [now, setNow] = useState(Date.now());
  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => { void initializeConnection(); }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  const room = state.room;
  const disabled = state.status !== 'connected' || !!state.pending;
  return <><a className="skip-link" href="#app-main">Skip to game</a><div id="app-main">{room ? <><RoomHeader room={room} onLeave={() => { if (room.phase === 'LOBBY' || room.phase === 'RESULTS') void sendCommand('room:leave'); else setConfirmLeave(true); }} />{room.phase === 'LOBBY' ? <Lobby room={room} disabled={disabled} /> : room.phase === 'RESULTS' ? <Results room={room} disabled={disabled} /> : <Table room={room} disabled={disabled} now={now + state.clockOffset} />}<Reactions key={room.instanceId} state={state} disabled={disabled} /></> : <Menu state={state} />}</div>{room && state.error && state.status === 'connected' && <div className="error-toast" role="alert"><span>{state.error}</span><button className="icon-button" aria-label="Dismiss message" onClick={clearError}>×</button></div>}{state.pending && <div className="pending-indicator" role="status">Confirming your action…</div>}<ConnectionOverlay state={state} />{confirmLeave && <Modal title="Leave this match?" onClose={() => setConfirmLeave(false)}><p className="muted">Your submitted and committed wagers will still settle. Leaving gives up your right to return to this match.</p><div className="dialog-actions"><button className="button secondary" onClick={() => setConfirmLeave(false)}>Stay at the table</button><button className="button danger" disabled={disabled} onClick={async () => { if (await sendCommand('room:leave')) setConfirmLeave(false); }}>Leave Match</button></div></Modal>}</>;
}
