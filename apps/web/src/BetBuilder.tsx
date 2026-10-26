import { useEffect, useRef, useState } from 'react';
import { BET_CHIPS } from '@bluff-house/shared';
import './bet-builder.css';

type Pot = { counts: Record<number, number>; remainder: number };
const emptyPot = (): Pot => ({ counts: {}, remainder: 0 });
const totalOf = (pot: Pot) => Object.entries(pot.counts).reduce((total, [chip, count]) => total + Number(chip) * count, pot.remainder);
const makePot = (amount: number): Pot => {
  const counts: Record<number, number> = {};
  for (const chip of [...BET_CHIPS].reverse()) {
    const count = Math.floor(amount / chip);
    if (count) { counts[chip] = count; amount -= chip * count; }
  }
  return { counts, remainder: amount };
};

export default function BetBuilder({ funds, reserved, disabled, backedMaximum, submit, withdraw }: {
  funds: number; reserved: number; disabled: boolean; backedMaximum?: number;
  submit: (amount: number) => Promise<boolean>; withdraw: () => Promise<boolean>;
}) {
  const [pot, setPot] = useState<Pot>(() => makePot(reserved || Math.min(100, funds)));
  const [history, setHistory] = useState<Pot[]>([]);
  const previousReservation = useRef(reserved);
  useEffect(() => {
    if (previousReservation.current === reserved) return;
    previousReservation.current = reserved;
    // Funded Chaos multipliers also change the wager; keep the tray honest.
    // Ordinary snapshots leave an unsent draft and its chip composition intact.
    setPot(current => totalOf(current) === reserved ? current : makePot(reserved));
    setHistory([]);
  }, [reserved]);
  const amount = totalOf(pot);
  const fullyBacked = backedMaximum === undefined || amount <= backedMaximum;
  const edit = (next: Pot) => { setHistory(previous => [...previous.slice(-99), pot]); setPot(next); };
  const shortcut = (fraction: number) => fraction === 1 ? funds : Math.floor(funds * fraction / 10) * 10;
  return <form className="bet-builder" aria-label="Build your Blackjack wager" onSubmit={event => { event.preventDefault(); if (!disabled && amount > 0 && amount <= funds && fullyBacked) void submit(amount); }}>
    <section className="bet-chip-workspace" aria-label="Choose your wager chips">
      <div className="chip-workspace-heading"><span>YOUR CHIPS</span><span className="bet-funds">{funds.toLocaleString('en-CA')} available</span></div>
      <div className={`personal-pot ${amount ? 'has-chips' : ''}`} aria-label="Chips in your betting pot">
        {BET_CHIPS.filter(chip => pot.counts[chip]).map(chip => <button type="button" key={chip} className={`pot-stack chip-value-${chip}`} disabled={disabled} aria-label={`Remove one ${chip} chip`} title={`Remove one ${chip} chip`} onClick={() => edit({ ...pot, counts: { ...pot.counts, [chip]: pot.counts[chip] - 1 } })}><span className="stack-chip">{chip}</span><strong>×{pot.counts[chip].toLocaleString('en-CA')}</strong></button>)}
        {!!pot.remainder && <button type="button" className="pot-remainder" disabled={disabled} aria-label={`Remove ${pot.remainder} remainder chips`} onClick={() => edit({ ...pot, remainder: 0 })}>{pot.remainder}<small>remainder</small></button>}
        {!amount && <span className="empty-pot">Choose your chips</span>}
      </div>
      <div className="chip-denominations" role="group" aria-label="Add chips to your wager">{BET_CHIPS.map(chip => <button type="button" className={`bet-chip chip-value-${chip} ${pot.counts[chip] ? 'chip-in-pot' : ''}`} key={chip} disabled={disabled || amount + chip > funds} aria-label={`Bet ${chip} chips`} title={`Add ${chip} chips`} onClick={() => edit({ ...pot, counts: { ...pot.counts, [chip]: (pot.counts[chip] ?? 0) + 1 } })}>{chip >= 1000 ? '1K' : chip}<span className="chip-add" aria-hidden="true">+</span></button>)}</div>
      <div className="pot-edit-actions"><button type="button" disabled={disabled || !history.length} onClick={() => { setPot(history.at(-1)!); setHistory(previous => previous.slice(0, -1)); }}>Undo</button><button type="button" disabled={disabled || !amount} onClick={() => edit(emptyPot())}>Clear Pot</button></div>
    </section>
    <section className="bet-summary" aria-label="Confirm your wager">
      <div className="personal-pot-heading"><label htmlFor="personal-pot-total">Your betting pot</label><output id="personal-pot-total" aria-live="polite">{amount.toLocaleString('en-CA')} <small>chips</small></output></div>
      <div className="bet-shortcuts" role="group" aria-label="Wager shortcuts">{([{ label: 'All-In', fraction: 1 }, { label: 'Half', fraction: .5 }, { label: 'Quarter', fraction: .25 }]).map(item => <button type="button" className={item.fraction === 1 ? 'shortcut-all-in' : undefined} key={item.label} disabled={disabled || shortcut(item.fraction) < 1} onClick={() => edit(makePot(shortcut(item.fraction)))}>{item.label}</button>)}</div>
      {backedMaximum !== undefined && <p className="bet-backing" aria-label="Backed maximum wager">Backed max <strong>{backedMaximum.toLocaleString('en-CA')} chips</strong></p>}
      {amount > funds && <p className="bet-builder-error" role="alert">Your pot exceeds the {funds.toLocaleString('en-CA')} chips available.</p>}
      {amount <= funds && !fullyBacked && <p className="bet-builder-error" role="alert">The Bank backs up to {backedMaximum!.toLocaleString('en-CA')} chips. Reduce your pot.</p>}
      <div className="bet-submit-actions"><button type="submit" className="button primary" disabled={disabled || amount < 1 || amount > funds || !fullyBacked}>{reserved ? 'Update Bet' : 'Place Bet'} <span>{amount.toLocaleString('en-CA')}</span></button>{reserved > 0 && <button type="button" className="text-button withdraw-button" disabled={disabled} onClick={async () => { if (await withdraw()) edit(emptyPot()); }}>Withdraw</button>}</div>
    </section>
  </form>;
}
