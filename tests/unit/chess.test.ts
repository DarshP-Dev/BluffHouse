import {describe,expect,it} from 'vitest';
import {Chess} from 'chess.js';
import {createChess,moveChess,restoreChess,chessOutcome,chessTimeout,hasMatingMaterial} from '../../apps/server/src/game/chess.js';
import type {DuelState,EngineOptions} from '../../apps/server/src/game/state.js';

function engine():EngineOptions {let n=0;return {id:()=>`move-${++n}`,now:()=>1000,shoe:()=>[],randomIndex:()=>0};}
function duel(fen?:string){const e=engine(),created=createChess('white','black',e,1000),d:DuelState={id:'chess-duel',game:'CHESS',inviterId:'white',defenderId:'black',amount:100,status:'playing',startedAt:1000,hardDeadline:61000,deadline:31000,throwNumber:0,scores:{white:0,black:0},choices:{},throws:[],winnerId:null,chess:created.view,chessPgn:created.pgn};
  if(fen){const c=new Chess(fen);d.chess!.fen=c.fen();d.chess!.board=c.board().flatMap(row=>row.flatMap(p=>p?[{square:p.square,piece:p.type,color:p.color}]:[]));d.chess!.turnId=c.turn()==='w'?'white':'black';d.chess!.check=c.isCheck();d.chess!.legalMoves=c.moves({verbose:true}).map(m=>({from:m.from,to:m.to,...(m.promotion?{promotion:m.promotion}:{})}));d.chessPgn=c.pgn();}return {d,e};}
function play(d:DuelState,e:EngineOptions,from:string,to:string,now=1000,promotion?:string){return moveChess(d,d.chess!.turnId,{from,to,...(promotion?{promotion}:{})},e,now);}

describe('maintained chess rules and serializable history',()=>{
  it('starts standard with twenty legal moves, two thirty-second clocks and white to move',()=>{const {d}=duel();expect(d.chess).toMatchObject({whiteId:'white',blackId:'black',turnId:'white',remainingMs:{white:30000,black:30000},clockStartedAt:1000,check:false});expect(d.chess!.board).toHaveLength(32);expect(d.chess!.legalMoves).toHaveLength(20);expect(restoreChess(d).fen()).toBe(new Chess().fen());});
  it('charges only the side that moved, changes the decision ID and retains replayable full history',()=>{const {d,e}=duel(),first=d.chess!.moveId;expect(play(d,e,'e2','e4',2500)).toBeNull();expect(d.chess).toMatchObject({turnId:'black',remainingMs:{white:28500,black:30000},clockStartedAt:2500,lastMove:{from:'e2',to:'e4'}});expect(d.chess!.moveId).not.toBe(first);play(d,e,'e7','e5',4000);expect(d.chess!.remainingMs).toEqual({white:28500,black:28500});expect(restoreChess(structuredClone(d)).history()).toEqual(['e4','e5']);});
  it.each([{from:'e2',to:'e5'},{from:'a9',to:'a8'},{from:'e2',to:'e4',promotion:'king'},{from:'e2',to:'e4',promotion:'Q'},{from:'b1',to:'b3'}])('rejects illegal move %j without charging or pausing a clock',(payload)=>{const {d,e}=duel(),before=structuredClone(d);expect(()=>moveChess(d,'white',payload,e,2500)).toThrow();expect(d).toEqual(before);});
  it('rejects the opponent or an exact-flag move without mutation',()=>{for(const [player,at] of [['black',1500],['white',31000]] as const){const {d,e}=duel(),before=structuredClone(d);expect(()=>moveChess(d,player,{from:'e2',to:'e4'},e,at)).toThrow();expect(d).toEqual(before);}});
  it('allows legal castling and moves the rook, while refusing castling through check',()=>{const {d,e}=duel('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');play(d,e,'e1','g1');expect(restoreChess(d).get('g1')).toMatchObject({type:'k',color:'w'});expect(restoreChess(d).get('f1')).toMatchObject({type:'r',color:'w'});const bad=duel('r3kr1r/8/8/8/8/8/8/R3K2R w KQ - 0 1'),before=structuredClone(bad.d);expect(()=>play(bad.d,bad.e,'e1','g1')).toThrow();expect(bad.d).toEqual(before);});
  it('handles en passant and removes the passed pawn',()=>{const {d,e}=duel();for(const [from,to] of [['e2','e4'],['a7','a6'],['e4','e5'],['d7','d5'],['e5','d6']])play(d,e,from,to);expect(restoreChess(d).get('d6')).toMatchObject({type:'p',color:'w'});expect(restoreChess(d).get('d5')).toBeUndefined();expect(restoreChess(d).history().at(-1)).toBe('exd6');});
  it.each(['q','r','b','n'])('requires an explicit legal promotion and supports underpromotion to %s',(promotion)=>{const {d,e}=duel('7k/P7/8/8/8/8/8/7K w - - 0 1'),before=structuredClone(d);expect(()=>play(d,e,'a7','a8')).toThrow();expect(d).toEqual(before);play(d,e,'a7','a8',1000,promotion);expect(restoreChess(d).get('a8')).toMatchObject({type:promotion,color:'w'});});
  it('recognizes checkmate before draw rules',()=>{const {d,e}=duel();play(d,e,'f2','f3');play(d,e,'e7','e5');play(d,e,'g2','g4');expect(play(d,e,'d8','h4')).toEqual({winnerId:'black',reason:'Checkmate.'});expect(d.chess!.check).toBe(true);});
  it.each([['7k/5Q2/6K1/8/8/8/8/8 b - - 0 1','Stalemate.'],['7k/8/6K1/8/8/8/8/8 w - - 0 1','Insufficient material.'],['7k/8/6K1/8/8/8/R7/8 w - - 100 51','Fifty-move rule.']])('recognizes library-supported draw %s',(fen,reason)=>{expect(chessOutcome(new Chess(fen),'white','black')).toEqual({winnerId:null,reason});});
  it('retains threefold repetition across serialized candidates instead of rebuilding from FEN alone',()=>{const {d,e}=duel();let outcome=null;for(let cycle=0;cycle<2;cycle++)for(const [from,to] of [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']])outcome=play(d,e,from,to);expect(outcome).toEqual({winnerId:null,reason:'Threefold repetition.'});expect(restoreChess(structuredClone(d)).isThreefoldRepetition()).toBe(true);});
  it('rejects inconsistent serialized history instead of accepting a substituted board',()=>{const {d,e}=duel();play(d,e,'e2','e4');d.chess!.fen=new Chess().fen();expect(()=>restoreChess(d)).toThrow();});
});

describe('per-side flag-fall material policy',()=>{
  it.each([
    ['7k/8/8/8/8/8/8/KQ6 w - - 0 1','w',true],
    ['7k/8/8/8/8/8/8/KQ6 w - - 0 1','b',false],
    ['7k/8/8/8/8/8/8/KN6 w - - 0 1','w',false],
    ['7k/8/8/8/8/8/8/KB6 w - - 0 1','w',false],
    ['7k/8/8/8/8/8/8/KNN5 w - - 0 1','w',true],
    ['6qk/8/8/8/8/8/8/KN6 w - - 0 1','w',false],
    ['6rk/8/8/8/8/8/8/KN6 w - - 0 1','w',true],
    ['7k/6p1/8/8/8/8/8/KN6 w - - 0 1','w',true],
    ['6bk/8/8/8/8/8/8/KN6 w - - 0 1','w',true],
    ['6bk/8/8/8/8/8/8/KB6 w - - 0 1','w',false],
    ['5b1k/8/8/8/8/8/8/KB6 w - - 0 1','w',true],
    ['7k/6p1/8/8/8/8/8/KB6 w - - 0 1','w',true]
  ] as const)('classifies side %s material in %s without using the global draw flag',(fen,color,canMate)=>{expect(hasMatingMaterial(new Chess(fen),color)).toBe(canMate);});
  it('draws a queen-side flag when its bare-king opponent cannot possibly mate',()=>{const {d}=duel('7k/8/8/8/8/8/8/KQ6 w - - 0 1');expect(restoreChess(d).isInsufficientMaterial()).toBe(false);expect(chessTimeout(d,31000).winnerId).toBeNull();});
  it('awards a flag to an opponent with material and clamps the spent clock at zero',()=>{const {d}=duel();expect(chessTimeout(d,31500)).toMatchObject({winnerId:'black'});expect(d.chess!.remainingMs.white).toBe(0);});
  it('draws the immutable wall-clock cap while the active side still has time',()=>{const {d}=duel();d.chess!.clockStartedAt=60000;d.chess!.remainingMs.white=30000;expect(chessTimeout(d,61000)).toMatchObject({winnerId:null,reason:expect.stringContaining('60-second')});});
  it('draws a hard-cap deadline even when a side clock expires at that same instant',()=>{const {d}=duel();d.chess!.clockStartedAt=31000;d.chess!.remainingMs.white=30000;expect(chessTimeout(d,61000)).toMatchObject({winnerId:null,reason:expect.stringContaining('60-second')});});
});
