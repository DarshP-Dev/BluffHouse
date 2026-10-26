import type { RoomView } from '@bluff-house/shared';
import BetBuilder from './BetBuilder';
import { sendCommand } from './connection';
import './dealer-bet.css';

const chips = (amount: number) => amount.toLocaleString('en-CA');
const signed = (amount: number) => `${amount > 0 ? '+' : ''}${chips(amount)}`;

export function DealerBetControls({ room, disabled, now }: { room: RoomView; disabled: boolean; now: number }) {
  const bet = room.party?.bank.dealerBet;
  if (!bet || room.party?.houseId !== room.viewerId || !['BETTING', 'SHADOW_BETTING'].includes(room.phase)) return null;
  const expired = room.deadline !== null && now >= room.deadline;
  return <section className="dealer-bet-controls" aria-label="Your dealer bet">
    <div className="dealer-bet-heading"><h2>Your dealer bet</h2><small>Against the table</small></div>
    {bet.maximum >= bet.minimum ? <>
      <p className="dealer-bet-rule">Minimum {chips(bet.minimum)} is reserved automatically. Edit before the deal.</p>
      <BetBuilder key={room.bettingId} funds={bet.maximum} reserved={bet.reserved} minimum={bet.minimum} disabled={disabled || expired} submit={amount => sendCommand('dealer:bet', { amount })} />
    </> : <p className="dealer-bet-skipped" role="status">Below the {chips(bet.minimum)}-chip minimum. No extra bet this round; your bond and the Bank still back the table.</p>}
  </section>;
}

export function DealerBetStatus({ room }: { room: RoomView }) {
  const bet = room.party?.bank.dealerBet;
  if (!bet?.ownerId || bet.ownerId !== room.party?.houseId) return null;
  const settlement = room.party.bank.rounds.find(record => record.roundId === bet.roundId && record.houseId === bet.ownerId);
  const net = settlement ? settlement.dealerProfit - settlement.bondLoss : bet.profit;
  return <section className={`dealer-bet-status dealer-bet-${bet.status.toLowerCase()}`} aria-label="Dealer personal bet">
    <span>Personal bet <strong>{chips(bet.amount)} chips</strong></span>
    {bet.status === 'SETTLED' ? <>
      <span>Stake returned <strong>{chips(bet.returned)}</strong></span>
      <span className={net < 0 ? 'dealer-bet-loss' : 'dealer-bet-win'}>Personal net <strong>{signed(net)}</strong></span>
      {!!settlement?.bondLoss && <small>Includes {chips(settlement.bondLoss)} lost from the standing bond.</small>}
    </> : <small>{bet.status === 'RESERVED' ? 'Reserved · locks before cards' : bet.status === 'COMMITTED' ? 'Committed' : 'Below minimum · no extra stake'}</small>}
  </section>;
}
