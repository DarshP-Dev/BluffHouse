import { useId, useState } from 'react';
import type { DuelView, RoomView } from '@bluff-house/shared';
import { sendCommand } from './connection';
import './chess-duel.css';

const pieceNames: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const pieceSymbols: Record<string, string> = { wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔', bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚' };

export default function ChessDuelBoard({ duel, room, disabled, now }: { duel: DuelView; room: RoomView; disabled: boolean; now: number }) {
  const [selection, setSelection] = useState<{ position: string; square: string } | null>(null);
  const [promotion, setPromotion] = useState('q');
  const promotionId = useId();
  const chess = duel.chess;
  if (!chess) return null;

  const playing = duel.status === 'playing';
  const ownColor = room.viewerId === chess.whiteId ? 'w' : room.viewerId === chess.blackId ? 'b' : null;
  const ownTurn = playing && chess.turnId === room.viewerId;
  const position = `${duel.id}:${chess.moveId}`;
  // A selection belongs to one server position, so a move or reconnect cannot reuse it.
  const selected = selection?.position === position ? selection.square : null;
  const moves = chess.legalMoves.filter(move => move.from === selected);
  const name = (id: string) => room.players.find(player => player.id === id)?.name ?? 'Player';
  const bottomId = ownColor === 'b' ? chess.blackId : chess.whiteId;
  const topId = bottomId === chess.whiteId ? chess.blackId : chess.whiteId;
  const canMove = !disabled && ownTurn && now < duel.deadline && now < duel.hardDeadline;

  const moveTo = (to: string) => {
    const choices = moves.filter(move => move.to === to);
    const choice = choices.find(move => move.promotion === promotion) ?? choices.find(move => !move.promotion);
    if (!choice || !canMove) return;
    void sendCommand('duel:move', { from: choice.from, to: choice.to, ...(choice.promotion ? { promotion: choice.promotion } : {}) });
    setSelection(null);
  };

  const playerBar = (id: string, placement: 'opponent' | 'self') => {
    const active = playing && chess.turnId === id;
    // remainingMs is measured at clockStartedAt, not when this component mounts.
    const remaining = Math.max(0, (chess.remainingMs[id] ?? 0) - (active ? Math.max(0, now - chess.clockStartedAt) : 0));
    const seconds = Math.ceil(remaining / 1000);
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const color = id === chess.whiteId ? 'White' : 'Black';
    return <div className={`chess-player-bar chess-player-${placement} ${active ? 'running-clock' : ''}`} data-player-id={id}>
      <span className={`chess-player-icon ${id === chess.whiteId ? 'white-side' : 'black-side'}`} aria-hidden="true">{id === chess.whiteId ? '♔' : '♚'}</span>
      <span className="chess-player-identity"><strong>{name(id)}{id === room.viewerId ? ' (you)' : ''}</strong><small>{color}{active ? ' · To move' : ''}</small></span>
      <strong className={`chess-player-clock ${active && seconds <= 5 ? 'chess-clock-urgent' : ''}`} aria-label={`${name(id)} chess clock: ${seconds} seconds`}><span aria-hidden="true">◷ </span>{clock}</strong>
    </div>;
  };

  return <div className="board-duel chess-duel">
    <div className="chess-match" aria-label="Chess clocks">
      {playerBar(topId, 'opponent')}
      <div className="chess-board" role="grid" aria-label="Chess board">{Array.from({ length: 8 }, (_, row) => <div role="row" className="chess-rank" key={row}>{Array.from({ length: 8 }, (_, column) => {
        const file = ownColor === 'b' ? 7 - column : column;
        const rank = ownColor === 'b' ? row + 1 : 8 - row;
        const square = `${'abcdefgh'[file]}${rank}`;
        const piece = chess.board.find(item => item.square === square);
        const destination = moves.some(move => move.to === square);
        const canSelect = piece?.color === ownColor && chess.legalMoves.some(move => move.from === square);
        const label = `${square}: ${piece ? `${piece.color === 'w' ? 'white' : 'black'} ${pieceNames[piece.piece]}` : 'empty'}`;
        const lastMove = chess.lastMove && [chess.lastMove.from, chess.lastMove.to].includes(square);
        return <div role="gridcell" key={square}><button className={`chess-square ${(file + rank) % 2 === 0 ? 'dark-square' : 'light-square'} ${selected === square ? 'selected-square' : ''} ${destination ? 'legal-square' : ''} ${lastMove ? 'last-move-square' : ''}`} aria-label={label} aria-pressed={selected === square} disabled={!canMove || (!canSelect && !destination)} onClick={() => { if (destination) moveTo(square); else setSelection(selected === square ? null : { position, square }); }}><span aria-hidden="true" className={piece?.color === 'w' ? 'white-piece' : 'black-piece'}>{piece ? pieceSymbols[`${piece.color}${piece.piece}`] : destination ? '·' : ''}</span><small aria-hidden="true">{square}</small></button></div>;
      })}</div>)}</div>
      {playerBar(bottomId, 'self')}
    </div>
    <div className="chess-controls"><p className="board-turn" role="status">{playing ? `${name(chess.turnId)} to move${chess.check ? ' — CHECK' : ''}.` : 'Chess complete.'}{playing && !ownColor ? ' Watching.' : ownTurn && selected ? ` ${selected} selected.` : ''}</p>{ownColor && <label className="chess-promotion" htmlFor={promotionId}>Promote pawn to<select id={promotionId} value={promotion} disabled={!canMove} onChange={event => setPromotion(event.target.value)}><option value="q">Queen</option><option value="r">Rook</option><option value="b">Bishop</option><option value="n">Knight</option></select></label>}</div>
  </div>;
}
