import type {Connect4View} from '@bluff-house/shared';
import {requireRule,type EngineOptions} from './state.js';

export interface BoardOutcome {winnerId:string|null;reason:string}
export function createConnect4(firstPlayerId:string,_secondPlayerId:string,e:EngineOptions):Connect4View{
  return {cells:Array.from({length:6},()=>Array<string|null>(7).fill(null)),firstPlayerId,activePlayerId:firstPlayerId,moveId:e.id()};
}
export function connect4Winner(cells:(string|null)[][]):string|null{
  for(let row=0;row<6;row++)for(let column=0;column<7;column++){
    const id=cells[row][column];if(!id)continue;
    for(const [dr,dc] of [[0,1],[1,0],[1,1],[1,-1]]){
      let count=1;
      while(count<4&&cells[row+dr*count]?.[column+dc*count]===id)count++;
      if(count===4)return id;
    }
  }
  return null;
}
export function moveConnect4(board:Connect4View,playerId:string,column:unknown,otherPlayerId:string,e:EngineOptions):BoardOutcome|null{
  requireRule(board.activePlayerId===playerId,'NOT_YOUR_TURN');
  requireRule(typeof column==='number'&&Number.isInteger(column)&&column>=0&&column<7,'INVALID_COLUMN');
  let row=5;while(row>=0&&board.cells[row][column]!==null)row--;
  requireRule(row>=0,'COLUMN_FULL');
  board.cells[row][column]=playerId;
  board.activePlayerId=otherPlayerId;board.moveId=e.id();
  const winnerId=connect4Winner(board.cells);
  if(winnerId)return {winnerId,reason:'Four in a row.'};
  if(board.cells[0].every(cell=>cell!==null))return {winnerId:null,reason:'The board is full.'};
  return null;
}
