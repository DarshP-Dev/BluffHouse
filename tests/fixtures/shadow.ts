import type {Rank} from '@bluff-house/shared';
import {fixture,shoe} from './core.js';

/** A real auction funds the pot; normal rounds finish before the fresh shoe. */
export function fundedFinale(options:{players?:number;pot?:number;ranks?:Rank[];enter?:boolean;bidder?:number}={}){
  const players=options.players??3,f=fixture({mode:'PARTY',finale:true,players});f.start();
  const pot=options.pot??100;
  if(pot){const bid=f.send(f.actors[options.bidder??0]!,'house:bid',{amount:pot});if(bid.status!=='ok')throw new Error(`Finale funding failed: ${bid.code}`);}
  f.advance(22000);
  for(let n=0;n<100;n++){
    const view=f.view();if(view.phase==='ROUND_RESULT'&&view.round===view.roundLimit)break;
    if(view.deadline===null)throw new Error(`Finale progression stopped in ${view.phase}`);f.advance(view.deadline-view.serverTime);
    if(n===99)throw new Error('Finale progression exceeded its bounded fixture');
  }
  const ranks=options.ranks??['10','9','10','9','8','7','10','2','3'];f.manager.e.shoe=()=>shoe(ranks);
  if(options.enter!==false)f.advance(f.view().deadline!-f.view().serverTime);
  return f;
}
export type ShadowFixture=ReturnType<typeof fundedFinale>;

export function advanceFinale(f:ShadowFixture){const v=f.view();if(v.deadline===null)throw new Error(`No deadline in ${v.phase}`);f.advance(v.deadline-v.serverTime);}
export function finishFinale(f:ShadowFixture){for(let n=0;n<60&&f.view().phase!=='RESULTS';n++)advanceFinale(f);if(f.view().phase!=='RESULTS')throw new Error('Finale failed to reach results');}
export function lockShadowHands(f:ShadowFixture,drawSeats:number[]=[]){
  for(let n=0;n<6&&f.view().phase==='SHADOW_DRAW';n++){
    const active=f.view().party!.shadow!.activePlayerId!,index=f.actors.indexOf(active),result=f.send(active,drawSeats.includes(index)?'shadow:draw':'shadow:stand');
    if(result.status!=='ok')throw new Error(`Shadow hand lock failed: ${result.code}`);
  }
  if(f.view().phase!=='SHADOW_CLAIM')throw new Error(`Expected claim stage, got ${f.view().phase}`);
}
export function declareShadow(f:ShadowFixture,seat:number,total:number){const result=f.send(f.actors[seat]!,'shadow:claim',{declaredTotal:total});if(result.status!=='ok')throw new Error(`Shadow declaration failed: ${result.code}`);return result;}
