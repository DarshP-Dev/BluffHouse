import {RULES,type Card,type Command,type CommandType,type Rank} from '@bluff-house/shared';
import {RoomManager} from '../../apps/server/src/rooms.js';

/** Two funded hands of 10/12 against dealer 17, with low cards for later hits. */
export function shoe(ranks:Rank[]=['5','6','10','5','6','7','2','3','4','10','9','8']):Card[] {
  return [...ranks,...Array<Rank>(80).fill('10')].map((rank,index)=>({id:`test-card-${index}`,rank,suit:'S'}));
}

export function fixture(options:{players?:number;ranks?:Rank[];maxRooms?:number}={}) {
  let now=1000,serial=0,requests=0;
  const manager=new RoomManager('test-server',{now:()=>now,id:()=>`entity-${++serial}`,shoe:()=>shoe(options.ranks)},options.maxRooms);
  const actors=Array.from({length:options.players??2},(_,i)=>`player-${i+1}`);
  const host=actors[0]!;
  const view=(actor=host)=>manager.snapshot(actor)!;
  const room=()=>manager.roomFor(host)!;
  const command=(actor:string,type:CommandType,payload?:Record<string,unknown>,extra:Partial<Command>={}):Command=>{
    const state=manager.snapshot(actor);
    return {requestId:`request-${++requests}`,type,...(state?{roomInstanceId:state.instanceId,lobbyId:state.lobbyId,matchId:state.matchId,roundId:state.roundId,decisionId:state.decisionId,bettingId:state.bettingId,offerId:state.bluff?.id}:{}),...(payload?{payload}:{}),...extra};
  };
  const send=(actor:string,type:CommandType,payload?:Record<string,unknown>,extra:Partial<Command>={})=>manager.command(actor,command(actor,type,payload,extra));
  for(const [i,actor] of actors.entries()){
    const result=send(actor,i===0?'room:create':'room:join',{username:`Player ${i+1}`,...(i?{roomCode:view().code}:{})});
    if(result.status!=='ok')throw new Error(`Fixture entry failed: ${result.code}`);
  }
  const start=()=>{
    for(const actor of actors){const ready=send(actor,'lobby:ready',{ready:true});if(ready.status!=='ok')throw new Error(`Fixture ready failed: ${ready.code}`);}
    const result=send(host,'match:start');if(result.status!=='ok')throw new Error(`Fixture start failed: ${result.code}`);
  };
  const advance=(ms:number)=>{now+=ms;manager.reconcile();};
  const bet=(amount=100)=>{for(const actor of actors){const result=send(actor,'bet:submit',{amount});if(result.status!=='ok')throw new Error(`Fixture bet failed: ${result.code}`);}};
  const deal=()=>advance(RULES.bettingMs+RULES.dealingMs);
  return {manager,actors,host,view,room,command,send,start,advance,bet,deal};
}
