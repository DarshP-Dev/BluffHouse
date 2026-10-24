import {randomInt,randomUUID} from 'node:crypto';
import {RULES,EMOJIS,validName,type Ack,type Command,type CommandType,type RoomView,type TableEvent} from '@bluff-house/shared';
import {makeShoe} from './game/cards.js';
import {account} from './game/ledger.js';
import {GameError,requireRule,type Room,type EngineOptions} from './game/state.js';
import {addEvent,assertRoom,connected,createRoom,deadlineTransition,gameCommand,makePlayer,roundBoundary,startMatch} from './game/engine.js';
import {project} from './projection.js';
import {cancelBluff} from './game/bluff.js';
import {cancelPlayerInvites} from './game/duels.js';

const TYPES:CommandType[]=['room:create','room:join','lobby:ready','lobby:mode','house:bid','duel:invite','duel:reject','duel:accept','duel:choose','duel:resign','match:start','bet:submit','bet:withdraw','turn:hit','turn:stand','bluff:offer','bluff:accept','reaction:send','room:leave','results:return','state:sync'];
const fields=['requestId','type','roomInstanceId','lobbyId','matchId','roundId','decisionId','bettingId','offerId','auctionId','socialId','inviteId','duelId','throwId','payload'];
const payloadFields:Partial<Record<CommandType,string[]>>={'room:create':['username'],'room:join':['username','roomCode'],'lobby:ready':['ready'],'lobby:mode':['mode'],'house:bid':['amount'],'duel:invite':['defenderId','amount'],'duel:accept':['game','coinSide'],'duel:choose':['choice'],'bet:submit':['amount'],'bluff:offer':['amount','claimType'],'reaction:send':['emoji']};
function canonical(value:unknown):string {if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')}}`;return JSON.stringify(value);}
export function validateCommand(raw:unknown):Command {
  requireRule(raw&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_REQUEST');
  const c=raw as Command;requireRule(typeof c.requestId==='string'&&/^[\w-]{8,128}$/.test(c.requestId),'INVALID_REQUEST_ID');
  requireRule(TYPES.includes(c.type),'INVALID_ACTION');requireRule(Object.keys(c).every(k=>fields.includes(k)),'INVALID_REQUEST');
  for(const key of fields.filter(k=>!['type','payload','requestId'].includes(k))){const value=(c as unknown as Record<string,unknown>)[key];requireRule(value===undefined||(typeof value==='string'&&value.length<=128),'INVALID_CONTEXT');}
  requireRule(c.payload===undefined||(c.payload&&typeof c.payload==='object'&&!Array.isArray(c.payload)),'INVALID_PAYLOAD');
  requireRule(Object.keys(c.payload??{}).every(k=>(payloadFields[c.type]??[]).includes(k)),'INVALID_PAYLOAD');
  return c;
}
interface Recorded {fingerprint:string;ack:Ack;roomId?:string}
export class RoomManager {
  readonly rooms=new Map<string,Room>();readonly codes=new Map<string,string>();readonly membership=new Map<string,string>();
  readonly records=new Map<string,Recorded>();readonly settlementArchive=new Map<string,Record<string,number>[]>();
  readonly lastReaction=new Map<string,number>();
  readonly e:EngineOptions;
  onChange:(room:Room)=>void=()=>{};
  onReaction:(room:Room,event:TableEvent)=>void=()=>{};
  onClose:(room:Room)=>void=()=>{};
  constructor(readonly instanceId:string,options:Partial<EngineOptions>={},readonly maxRooms=20){this.e={now:options.now??(()=>Date.now()),id:options.id??randomUUID,shoe:options.shoe??makeShoe,randomIndex:options.randomIndex??(length=>randomInt(length))};}
  roomFor(id:string){return this.rooms.get(this.membership.get(id)??'');}
  snapshot(id:string):RoomView|null{const r=this.roomFor(id);return r?project(r,id,this.instanceId,this.e.now()):null;}
  private commit(previous:Room,candidate:Room){assertRoom(candidate);candidate.revision=previous.revision+1;this.rooms.set(candidate.instanceId,candidate);this.onChange(candidate);}
  private update(r:Room,fn:(candidate:Room)=>void){const candidate=structuredClone(r);fn(candidate);this.commit(r,candidate);return candidate;}
  private code(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let i=0;i<100;i++){let code='';for(let n=0;n<6;n++)code+=chars[randomInt(chars.length)];if(!this.codes.has(code))return code;}throw new GameError('ROOM_LIMIT');}
  private transferHost(r:Room,at:number){const next=connected(r).sort((a,b)=>a.joinedAt-b.joinedAt||a.seat-b.seat)[0];r.hostId=next?.id??null;r.hostDeadline=null;if(next)addEvent(r,this.e,'host',`${next.name} is now the host.`,at,next.id);}
  private presenceRules(r:Room,at:number){
    const host=r.players.find(p=>p.id===r.hostId);
    if(!host||host.departed){this.transferHost(r,at);}else if(!host.connected){r.hostDeadline??=at+(r.phase==='LOBBY'?30000:60000);}else r.hostDeadline=null;
    if(r.phase!=='LOBBY'&&r.phase!=='RESULTS'){
      if(connected(r).length<2){if(!r.terminationConfirmed&&r.recoveryDeadline===null){r.recoveryDeadline=at+60000;addEvent(r,this.e,'recovery','Waiting up to 60 seconds for players to reconnect. Current wagers continue.',at);}}
      else if(!r.terminationConfirmed){r.recoveryDeadline=null;if(r.phase==='WAITING_FOR_PLAYERS')roundBoundary(r,this.e,at);}
    }
    if(r.phase==='LOBBY'){r.emptySince=r.players.some(p=>p.connected&&!p.departed)?null:r.emptySince??at;}
  }
  presence(id:string,isConnected:boolean){
    this.reconcile();const r=this.roomFor(id);if(!r)return;
    if(isConnected&&r.phase==='RESULTS')r.resultsSince=this.e.now();
    const p=r.players.find(p=>p.id===id);if(!p||p.departed||p.connected===isConnected)return;
    this.update(r,d=>{const player=d.players.find(p=>p.id===id)!;player.connected=isConnected;player.disconnectedAt=isConnected?null:this.e.now();if(!isConnected){player.ready=false;cancelPlayerInvites(d,id,this.e,this.e.now());if(d.phase==='BLUFF_OFFER'&&d.bluff?.claimantId===id){cancelBluff(d,this.e,this.e.now(),'cancelled');addEvent(d,this.e,'bluff','Offer cancelled after claimant disconnect; reservation returned.',this.e.now(),id);}}addEvent(d,this.e,'presence',`${player.name} ${isConnected?'reconnected':'disconnected'}.`,this.e.now(),id);this.presenceRules(d,this.e.now());});
  }
  command(id:string,raw:unknown):Ack {
    let c:Command|undefined,recordKey:string|undefined,recordFingerprint:string|undefined;
    try {
      c=validateCommand(raw);this.reconcile();
      if(c.type==='state:sync'){const r=this.roomFor(id);if(r?.phase==='RESULTS'&&r.players.some(p=>p.id===id&&p.connected&&!p.departed))r.resultsSince=this.e.now();return {requestId:c.requestId,status:'ok',code:'SYNCED',currentRevision:r?.revision??0};}
      const scope=c.roomInstanceId??'entry',key=`${id}|${scope}|${c.matchId??c.lobbyId??'entry'}|${c.requestId}`;
      const fingerprint=canonical(c),old=this.records.get(key);
      recordKey=key;recordFingerprint=fingerprint;
      if(old){requireRule(old.fingerprint===fingerprint,'REQUEST_CONFLICT','That request ID was already used with different data.');return old.ack;}
      requireRule(this.records.size<100000,'REQUEST_LIMIT','This server has reached its request memory limit.');
      let r=this.roomFor(id),targetId:string|undefined;
      if(c.type==='room:create'){
        requireRule(!r,'ALREADY_IN_ROOM','Return to your existing room or leave it first.');requireRule(this.rooms.size<this.maxRooms,'ROOM_LIMIT','All tables are occupied. Try again later.');
        const name=validName(c.payload?.username);requireRule(name,'INVALID_NAME','Use 2–16 letters, numbers, spaces, underscores or hyphens.');
        r=createRoom(this.code(),makePlayer(id,name,0,this.e.now()),this.e);addEvent(r,this.e,'join',`${name} opened the table.`,this.e.now(),id);r.revision=1;
        this.rooms.set(r.instanceId,r);this.codes.set(r.code,r.instanceId);this.membership.set(id,r.instanceId);targetId=r.instanceId;this.onChange(r);
      }else if(c.type==='room:join'){
        requireRule(!r,'ALREADY_IN_ROOM','Return to your existing room or leave it first.');
        const name=validName(c.payload?.username),code=c.payload?.roomCode;requireRule(name,'INVALID_NAME');requireRule(typeof code==='string'&&/^[A-Z2-9]{6}$/.test(code.trim().toUpperCase()),'INVALID_CODE','Enter the six-character room code.');
        const target=this.rooms.get(this.codes.get(code.trim().toUpperCase())??'');requireRule(target,'ROOM_MISSING','That room is unavailable.');requireRule(target.phase==='LOBBY','ROOM_IN_PROGRESS','This match has already started.');requireRule(target.players.length<RULES.maxPlayers,'ROOM_FULL','This room is full.');
        requireRule(!target.players.some(p=>p.name.toLowerCase()===name.toLowerCase()),'NAME_TAKEN','That name is already at the table.');
        const slot=Array.from({length:6},(_,n)=>n).find(n=>!target.players.some(p=>p.seat===n))!;
        r=this.update(target,d=>{d.players.push(makePlayer(id,name,slot,this.e.now()));d.players.sort((a,b)=>a.seat-b.seat);d.emptySince=null;if(!d.hostId)this.transferHost(d,this.e.now());addEvent(d,this.e,'join',`${name} joined the table.`,this.e.now(),id);});
        this.membership.set(id,target.instanceId);targetId=r.instanceId;
      }else {
        requireRule(r,'NO_MEMBERSHIP','This room is no longer available.');requireRule(c.roomInstanceId===r.instanceId,'STALE_ROOM');targetId=r.instanceId;
        if(c.type==='reaction:send'){
          const player=r.players.find(p=>p.id===id);requireRule(player&&player.connected&&!player.departed,'NO_MEMBERSHIP');
          if(r.phase==='LOBBY')requireRule(c.lobbyId===r.lobbyId,'STALE_LOBBY');else requireRule(c.matchId===r.matchId,'STALE_MATCH');
          const emoji=c.payload?.emoji,now=this.e.now();
          requireRule(typeof emoji==='string'&&(EMOJIS as readonly string[]).includes(emoji),'INVALID_REACTION');
          requireRule(now-(this.lastReaction.get(id)??-Infinity)>=1000,'REACTION_COOLDOWN','One reaction per second.');
          const ack:Ack={requestId:c.requestId,status:'ok',code:'OK',appliedRevision:r.revision,currentRevision:r.revision};
          this.lastReaction.set(id,now);this.records.set(key,{fingerprint,ack,roomId:r.instanceId});
          if(r.phase==='RESULTS')r.resultsSince=now;
          this.onReaction(r,{id:this.e.id(),kind:'reaction',text:`${player.name} ${emoji}`,playerId:id,at:now,revision:r.revision});
          return ack;
        }
        const was=r;const command=c;
        r=this.update(was,d=>{
          const p=d.players.find(p=>p.id===id);requireRule(p&&!p.departed&&p.connected,'NO_MEMBERSHIP');
          if(d.phase==='LOBBY')requireRule(command.lobbyId===d.lobbyId,'STALE_LOBBY');
          else requireRule(command.matchId===d.matchId,'STALE_MATCH');
          const now=this.e.now();
          switch(command.type){
            case 'lobby:mode':{
              requireRule(d.phase==='LOBBY','PHASE_LOCKED');requireRule(d.hostId===id,'NOT_HOST');
              const mode=command.payload?.mode;requireRule(mode==='CLASSIC'||mode==='PARTY','INVALID_MODE');
              if(d.mode!==mode){d.mode=mode;d.lobbyId=this.e.id();for(const player of d.players)player.ready=false;addEvent(d,this.e,'mode',`${mode==='PARTY'?'Party':'Classic'} selected. Everyone must ready up again.`,now);}
              break;
            }
            case 'lobby:ready':requireRule(d.phase==='LOBBY','PHASE_LOCKED');requireRule(typeof command.payload?.ready==='boolean','INVALID_READY');p.ready=command.payload.ready;break;
            case 'match:start':requireRule(d.phase==='LOBBY','PHASE_LOCKED');requireRule(d.hostId===id,'NOT_HOST');startMatch(d,this.e,now);break;
            case 'room:leave':
              cancelPlayerInvites(d,id,this.e,now);
              if(d.phase==='BLUFF_OFFER'&&d.bluff?.claimantId===id)cancelBluff(d,this.e,now,'cancelled');
              p.connected=false;p.departed=true;p.ready=false;p.disconnectedAt=now;
              if(d.phase==='LOBBY')d.players=d.players.filter(p=>p.id!==id);
              addEvent(d,this.e,'leave',`${p.name} left the table.`,now,id);this.presenceRules(d,now);break;
            case 'results:return':{
              requireRule(d.phase==='RESULTS','PHASE_LOCKED');
              // Archive economic records outside the reset gameplay state.
              d.phase='LOBBY';d.lobbyId=this.e.id();d.matchId=undefined;d.roundId=undefined;d.round=0;d.initialChips=0;d.dealerNet=0;d.shoe=[];d.cursor=0;d.dealer=[];d.dealerRevealed=false;d.deadline=null;d.decisionId=undefined;d.bettingId=undefined;d.bluff=null;d.biggestBluff=null;d.bluffOutcomes=[];d.results=null;d.resultsSince=null;d.recoveryDeadline=null;d.terminationConfirmed=false;
              d.players=d.players.filter(p=>!p.departed);for(const player of d.players){player.account=account();player.hand=[];player.wager=0;player.wagerId=undefined;player.status='waiting';player.ready=false;player.participating=false;player.bluffUsed=false;player.bluffWins=0;player.bluffLosses=0;if(!player.connected)player.disconnectedAt=now;}
              d.party=null;d.roundPayouts=[];
              d.hostDeadline=null;this.presenceRules(d,now);addEvent(d,this.e,'lobby','Back at the table. Ready up for a fresh match.',now);break;
            }
            default:requireRule(command.roundId===d.roundId,'STALE_ROUND');gameCommand(d,p,command,this.e,now);
          }
        });
        if(c.type==='room:leave'){this.membership.delete(id);this.lastReaction.delete(id);}
        if(c.type==='results:return')this.settlementArchive.set(was.instanceId,[...(this.settlementArchive.get(was.instanceId)??[]),...was.players.map(p=>({...p.account.settlements}))]);
      }
      const ack:Ack={requestId:c.requestId,status:'ok',code:'OK',appliedRevision:r.revision,currentRevision:r.revision};
      this.records.set(key,{fingerprint,ack,roomId:targetId});return ack;
    }catch(error){
      const ack:Ack={requestId:c?.requestId??'',status:'rejected',code:error instanceof GameError?error.code:(error instanceof Error?error.message:'INVALID_REQUEST'),message:error instanceof Error?error.message:'Invalid request.',currentRevision:this.roomFor(id)?.revision??0};
      // A validated retry keeps its original rejection as well as its original success.
      if(recordKey&&recordFingerprint&&!this.records.has(recordKey)&&this.records.size<100000)this.records.set(recordKey,{fingerprint:recordFingerprint,ack,roomId:this.membership.get(id)});
      return ack;
    }
  }
  reconcile(){
    const now=this.e.now();
    for(const original of this.rooms.values()){
      let r=this.rooms.get(original.instanceId)!;
      for(let transitions=0;transitions<500;transitions++){
        const due:{kind:string;at:number;id?:string}[]=[];
        if(r.deadline!==null)due.push({kind:'phase',at:r.deadline});
        if(r.hostDeadline!==null)due.push({kind:'host',at:r.hostDeadline});
        if(r.recoveryDeadline!==null)due.push({kind:'recovery',at:r.recoveryDeadline});
        if(r.phase==='LOBBY')for(const p of r.players)if(!p.connected&&p.disconnectedAt!==null)due.push({kind:'seat',id:p.id,at:p.disconnectedAt+60000});
        if(r.phase==='LOBBY'&&r.emptySince!==null)due.push({kind:'cleanup',at:r.emptySince+600000});
        if(r.phase==='RESULTS'&&r.resultsSince!==null)due.push({kind:'cleanup',at:r.resultsSince+900000});
        due.sort((a,b)=>a.at-b.at||(a.kind==='recovery'?-1:1));const next=due[0];if(!next||next.at>now)break;
        if(next.kind==='cleanup'){
          this.rooms.delete(r.instanceId);this.codes.delete(r.code);for(const [id,roomId] of this.membership)if(roomId===r.instanceId){this.membership.delete(id);this.lastReaction.delete(id);}for(const [key,record] of this.records)if(record.roomId===r.instanceId)this.records.delete(key);this.settlementArchive.delete(r.instanceId);this.onClose(r);break;
        }
        r=this.update(r,d=>{
          if(next.kind==='phase')deadlineTransition(d,this.e,next.at);
          else if(next.kind==='host')this.transferHost(d,next.at);
          else if(next.kind==='recovery'){d.recoveryDeadline=null;d.terminationConfirmed=true;if(d.phase==='WAITING_FOR_PLAYERS')roundBoundary(d,this.e,next.at);}
          else if(next.kind==='seat'){d.players=d.players.filter(p=>p.id!==next.id);if(d.hostId===next.id)this.transferHost(d,next.at);}
        });
        if(next.kind==='seat'&&this.membership.get(next.id!)===r.instanceId){this.membership.delete(next.id!);this.lastReaction.delete(next.id!);}
      }
    }
  }
}
