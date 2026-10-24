import {Chess,type Color} from 'chess.js';
import type {ChessMove,ChessView} from '@bluff-house/shared';
import {requireRule,type DuelState,type EngineOptions} from './state.js';
import type {BoardOutcome} from './connect4.js';

function snapshot(chess:Chess,whiteId:string,blackId:string,moveId:string,remainingMs:Record<string,number>,now:number,lastMove?:ChessMove):ChessView{
  return {fen:chess.fen(),board:chess.board().flatMap(row=>row.flatMap(piece=>piece?[{square:piece.square,piece:piece.type,color:piece.color}]:[])),whiteId,blackId,turnId:chess.turn()==='w'?whiteId:blackId,moveId,remainingMs,clockStartedAt:now,check:chess.isCheck(),legalMoves:chess.moves({verbose:true}).map(move=>({from:move.from,to:move.to,...(move.promotion?{promotion:move.promotion}:{})})),...(lastMove?{lastMove}:{})};
}
export function createChess(whiteId:string,blackId:string,e:EngineOptions,now:number){
  const chess=new Chess();
  return {view:snapshot(chess,whiteId,blackId,e.id(),{[whiteId]:30000,[blackId]:30000},now),pgn:chess.pgn()};
}
export function restoreChess(d:DuelState):Chess{
  requireRule(d.chess,'CHESS_STATE_MISSING');
  const chess=new Chess();
  if(d.chessPgn)chess.loadPgn(d.chessPgn);else chess.load(d.chess.fen);
  requireRule(chess.fen()===d.chess.fen,'CHESS_HISTORY_INVARIANT');
  return chess;
}

/** Per-side material policy for flag fall, independent of global draw detection.
 * Bare kings cannot mate. A lone knight needs opponent material other than only
 * queens; bishops need more than a single square color unless pawns/knights can
 * assist. Pawns, rooks, queens, two knights and mixed minors may permit mate.
 * This deliberately does not attempt a fortress or arbitrary position solver.
 */
export function hasMatingMaterial(chess:Chess,color:Color):boolean{
  const pieces=chess.board().flat().filter(piece=>piece!==null);
  const own=pieces.filter(piece=>piece.color===color&&piece.type!=='k');
  if(own.some(piece=>['p','r','q'].includes(piece.type)))return true;
  if(!own.length)return false;
  const knights=own.filter(piece=>piece.type==='n');
  if(knights.length){
    if(own.length>1)return true;
    return pieces.some(piece=>piece.color!==color&&!['k','q'].includes(piece.type));
  }
  // At this point the side has only bishops. A pawn/knight anywhere or bishops
  // spanning both square colors may allow a cooperative mating position.
  if(pieces.some(piece=>piece.type==='p'||piece.type==='n'))return true;
  const colors=new Set(pieces.filter(piece=>piece.type==='b').map(piece=>chess.squareColor(piece.square)));
  return colors.size>1;
}
export function chessOutcome(chess:Chess,whiteId:string,blackId:string):BoardOutcome|null{
  if(chess.isCheckmate())return {winnerId:chess.turn()==='w'?blackId:whiteId,reason:'Checkmate.'};
  if(chess.isStalemate())return {winnerId:null,reason:'Stalemate.'};
  if(chess.isThreefoldRepetition())return {winnerId:null,reason:'Threefold repetition.'};
  if(chess.isInsufficientMaterial())return {winnerId:null,reason:'Insufficient material.'};
  if(chess.isDrawByFiftyMoves())return {winnerId:null,reason:'Fifty-move rule.'};
  return null;
}
export function moveChess(d:DuelState,playerId:string,payload:Record<string,unknown>|undefined,e:EngineOptions,now:number):BoardOutcome|null{
  const view=d.chess;requireRule(view,'CHESS_STATE_MISSING');requireRule(view.turnId===playerId,'NOT_YOUR_TURN');
  const {from,to,promotion}=payload??{};
  requireRule(typeof from==='string'&&typeof to==='string'&&/^[a-h][1-8]$/.test(from)&&/^[a-h][1-8]$/.test(to),'INVALID_MOVE');
  requireRule(promotion===undefined||typeof promotion==='string'&&['q','r','b','n'].includes(promotion),'INVALID_PROMOTION');
  const chess=restoreChess(d);
  const legal=view.legalMoves.find(move=>move.from===from&&move.to===to&&move.promotion===promotion);requireRule(legal,'ILLEGAL_MOVE');
  const remaining=view.remainingMs[playerId]-(now-view.clockStartedAt);requireRule(remaining>0&&now<d.hardDeadline,'MOVE_DEADLINE');
  chess.move(legal);
  const clocks={...view.remainingMs,[playerId]:remaining};
  d.chess=snapshot(chess,view.whiteId,view.blackId,e.id(),clocks,now,legal);d.chessPgn=chess.pgn();
  d.deadline=Math.min(now+clocks[d.chess.turnId],d.hardDeadline);
  return chessOutcome(chess,view.whiteId,view.blackId);
}
export function chessTimeout(d:DuelState,at:number):BoardOutcome{
  const view=d.chess;requireRule(view,'CHESS_STATE_MISSING');
  const remaining=view.remainingMs[view.turnId]-(at-view.clockStartedAt);
  if(at>=d.hardDeadline)return {winnerId:null,reason:'The 60-second total play limit was reached.'};
  const opponentId=view.turnId===view.whiteId?view.blackId:view.whiteId;
  view.remainingMs[view.turnId]=Math.max(0,remaining);view.clockStartedAt=at;
  const color:Color=opponentId===view.whiteId?'w':'b';
  return hasMatingMaterial(restoreChess(d),color)?{winnerId:opponentId,reason:'The opponent ran out of time.'}:{winnerId:null,reason:'Time expired, but the opponent has no mating material under the published rule.'};
}
