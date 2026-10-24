import {describe,expect,it} from 'vitest';
import {createConnect4,moveConnect4 as move,connect4Winner} from '../../apps/server/src/game/connect4.js';
import type {Connect4View} from '@bluff-house/shared';
import type {EngineOptions} from '../../apps/server/src/game/state.js';

function engine():EngineOptions {let n=0;return {id:()=>`move-${++n}`,now:()=>1000,shoe:()=>[],randomIndex:()=>0};}
function moveConnect4(b:Connect4View,id:string,column:unknown,e:EngineOptions){return move(b,id,column,id==='a'?'b':'a',e);}

describe('authoritative Connect 4 board',()=>{
  it('creates an empty independent six by seven board and alternates turns after gravity placement',()=>{
    const e=engine(),b=createConnect4('a','b',e),old=b.moveId;
    expect(b.cells).toEqual(Array.from({length:6},()=>Array(7).fill(null)));expect(b.firstPlayerId).toBe('a');expect(b.activePlayerId).toBe('a');
    expect(moveConnect4(b,'a',3,e)).toBeNull();expect(b.cells[5][3]).toBe('a');expect(b.moveId).not.toBe(old);expect(b.activePlayerId).toBe('b');
    expect(moveConnect4(b,'b',3,e)).toBeNull();expect(b.cells[4][3]).toBe('b');expect(b.cells[3][3]).toBeNull();
  });
  it.each([[0,1],[1,0],[1,1],[1,-1]] as const)('detects four connected cells in direction %s,%s',(dr,dc)=>{
    const cells=Array.from({length:6},()=>Array<string|null>(7).fill(null));const col=dc<0?4:1;
    for(let n=0;n<4;n++)cells[1+n*dr][col+n*dc]='a';expect(connect4Winner(cells)).toBe('a');
    cells[1+3*dr][col+3*dc]=null;expect(connect4Winner(cells)).toBeNull();
  });
  it('awards a legal vertical win and never requires a fifth counter',()=>{
    const e=engine(),b=createConnect4('a','b',e);for(let n=0;n<3;n++){expect(moveConnect4(b,'a',0,e)).toBeNull();expect(moveConnect4(b,'b',1,e)).toBeNull();}
    expect(moveConnect4(b,'a',0,e)).toMatchObject({winnerId:'a'});expect(b.cells.filter(row=>row[0]==='a')).toHaveLength(4);
  });
  it.each([-1,7,1.5,NaN,'0',null])('rejects invalid column %s without changing the board',(column)=>{
    const e=engine(),b=createConnect4('a','b',e),before=structuredClone(b);expect(()=>moveConnect4(b,'a',column,e)).toThrow();expect(b).toEqual(before);
  });
  it('rejects spectators, out-of-turn players and full columns atomically',()=>{
    const e=engine(),b=createConnect4('a','b',e);for(let n=0;n<6;n++)moveConnect4(b,n%2?'b':'a',2,e);const before=structuredClone(b);
    for(const [id,column] of [['b',0],['outsider',0],['a',2]] as const){expect(()=>moveConnect4(b,id,column,e)).toThrow();expect(b).toEqual(before);}
  });
  it('returns a full-board draw when the final legal cell creates no line',()=>{
    const e=engine(),b=createConnect4('a','b',e);b.cells=Array.from({length:6},(_,r)=>Array.from({length:7},(_,c)=>(Math.floor(c/2)+r)%2?'b':'a'));
    expect(connect4Winner(b.cells)).toBeNull();b.cells[0][0]=null;expect(moveConnect4(b,'a',0,e)).toMatchObject({winnerId:null});expect(b.cells.flat().every(Boolean)).toBe(true);
  });
});
