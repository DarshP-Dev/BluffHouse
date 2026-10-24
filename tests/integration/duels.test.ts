import {describe,expect,it,vi} from 'vitest';
import {RULES,type CoinSide,type RpsChoice,type DuelGame} from '@bluff-house/shared';
import {Chess} from 'chess.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {reserve,release} from '../../apps/server/src/game/ledger.js';
import {fixture} from '../fixtures/core.js';

type F=ReturnType<typeof fixture>;
function social(players=3,randomIndex:(length:number)=>number=()=>0){
  const f=fixture({mode:'PARTY',players,randomIndex});f.start();f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);
  expect(f.view().phase).toBe('SOCIAL');expect(f.view().round).toBe(1);return f;
}
function invite(f:F,from=0,to=1,amount=100){expect(f.send(f.actors[from]!,'duel:invite',{defenderId:f.actors[to],amount}).status).toBe('ok');return f.view().party!.social!.invites.at(-1)!;}
function accept(f:F,id:string,defender=1,game:DuelGame='RPS',coinSide:CoinSide='HEADS'){
  const result=f.send(f.actors[defender]!,'duel:accept',{game,...(game==='COIN'?{coinSide}:{})},{inviteId:id});expect(result.status).toBe('ok');return result;
}
function choose(f:F,a:RpsChoice,b:RpsChoice){expect(f.send(f.actors[0]!,'duel:choose',{choice:a}).status).toBe('ok');expect(f.send(f.actors[1]!,'duel:choose',{choice:b}).status).toBe('ok');assertRoom(f.room());}
function clean(f:F){expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);assertRoom(f.room());}

describe('funded social invitations and bounded admission',()=>{
  it('opens only between non-final Party rounds and resumes Blackjack after twenty unused seconds',()=>{
    const f=social();const s=f.view().party!.social!;expect(s.admissionDeadline-s.openedAt).toBe(20000);expect(s.hardDeadline-s.openedAt).toBe(90000);
    f.advance(19999);expect(f.view().phase).toBe('SOCIAL');f.advance(1);expect(f.view()).toMatchObject({phase:'BETTING',round:2});clean(f);
    f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('SOCIAL');f.advance(20000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('RESULTS');clean(f);
  });
  it.each([0,1,49,75,300,-50,50.5,'100',null])('rejects invalid stake %s without creating a reservation',(amount)=>{
    const f=social(),before=structuredClone(f.room());expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('reserves one outgoing invitation, releases a rejection, and prevents self or nonmember targets',()=>{
    const f=social(),i=invite(f);expect(f.view().players[0]).toMatchObject({balance:1000,reserved:100,available:900,committed:0});
    const before=structuredClone(f.room());expect(f.send(f.host,'duel:invite',{defenderId:f.actors[2],amount:50}).status).toBe('rejected');expect(f.room()).toEqual(before);
    expect(f.send(f.actors[2]!,'duel:reject',undefined,{inviteId:i.id}).status).toBe('rejected');expect(f.room()).toEqual(before);
    expect(f.send(f.actors[1]!,'duel:reject',undefined,{inviteId:i.id}).status).toBe('ok');clean(f);
    for(const defenderId of [f.host,'outsider'])expect(f.send(f.host,'duel:invite',{defenderId,amount:50}).status).toBe('rejected');clean(f);
  });
  it('expires invitations after eight seconds and caps late invitations at the immutable admission close',()=>{
    const f=social();const i=invite(f);expect(i.deadline-f.view().serverTime).toBe(8000);f.advance(7999);expect(f.view().players[0]!.reserved).toBe(100);
    f.advance(1);expect(f.view().party!.social!.invites.find(x=>x.id===i.id)?.status).toBe('expired');clean(f);
    f.advance(11999);const late=invite(f);expect(late.deadline).toBe(f.view().party!.social!.admissionDeadline);f.advance(1);expect(f.view().phase).toBe('BETTING');clean(f);
    const before=structuredClone(f.room());expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:late.id}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('commits both stakes atomically, cancels competing offers and accepts the winning request only once',()=>{
    const f=social(4),i=invite(f),other=invite(f,2,3,250),cmd=f.command(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:i.id}),ack=f.manager.command(f.actors[1]!,cmd);
    expect(ack.status).toBe('ok');expect(f.view().phase).toBe('DUEL');expect(f.view().players.map(p=>[p.balance,p.reserved,p.committed])).toEqual([[900,0,100],[900,0,100],[1000,0,0],[1000,0,0]]);
    expect(f.view().party!.social!.invites.find(x=>x.id===other.id)?.status).toBe('cancelled');const after=structuredClone(f.room());
    expect(f.manager.command(f.actors[1]!,cmd)).toEqual(ack);expect(f.room()).toEqual(after);
    expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:i.id}).status).toBe('rejected');expect(f.send(f.actors[3]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:other.id}).status).toBe('rejected');expect(f.room()).toEqual(after);assertRoom(f.room());
  });
  it('rolls back unaffordable acceptance and leaves the original reserved offer available',()=>{
    const f=social(),i=invite(f,0,1,250);invite(f,1,2,150);const a=f.room().players[1]!.account;reserve(a,'other-binding-money',800);const before=structuredClone(f.room());
    expect(f.send(f.actors[1]!,'duel:accept',{game:'RPS'},{inviteId:i.id}).status).toBe('rejected');expect(f.room()).toEqual(before);release(f.room().players[1]!.account,'other-binding-money');accept(f,i.id);assertRoom(f.room());
  });
  it('releases a defender’s conflicting outgoing reservation before checking the matched acceptance funds',()=>{
    const f=social(),i=invite(f,0,1,250),other=invite(f,1,2,250);reserve(f.room().players[1]!.account,'independent-money',700);
    expect(f.view(f.actors[1]).players[1]!.available).toBe(50);accept(f,i.id);expect(f.view().party!.social!.invites.find(x=>x.id===other.id)?.status).toBe('cancelled');expect(f.view().players[1]).toMatchObject({balance:750,reserved:700,available:50,committed:250});assertRoom(f.room());
  });
  it('rejects stale contexts, unavailable games, foreign acceptance and client-selected winners without mutation',()=>{
    const f=social(),i=invite(f),before=structuredClone(f.room());
    for(const [actor,payload,extra] of [[f.actors[1],{game:'UNRELEASED'},{inviteId:i.id}],[f.actors[1],{game:'COIN'},{inviteId:i.id}],[f.actors[1],{game:'RPS',winnerId:f.host},{inviteId:i.id}],[f.actors[2],{game:'RPS'},{inviteId:i.id}],[f.actors[1],{game:'RPS'},{inviteId:'stale'}],[f.actors[1],{game:'RPS'},{inviteId:i.id,socialId:'stale'}]] as const){expect(f.send(actor!,'duel:accept',payload,extra).status).toBe('rejected');expect(f.room()).toEqual(before);}
  });
  it('cancels only unaccepted invitations when their sender disconnects or leaves',()=>{
    for(const leave of [false,true]){const f=social(4),roomId=f.view().instanceId;invite(f);if(leave)f.send(f.host,'room:leave');else f.manager.presence(f.host,false);const room=f.manager.rooms.get(roomId)!;expect(room.players[0]!.account.reservations).toEqual({});assertRoom(room);}
  });
  it('does not open a new contest below two connected players at the round boundary',()=>{
    const f=fixture({mode:'PARTY'});f.start();f.advance(22000);f.manager.presence(f.actors[1]!,false);f.advance(RULES.bettingMs+RULES.resultMs);
    expect(f.view().phase).toBe('WAITING_FOR_PLAYERS');expect(f.view().party!.social?.duel).toBeFalsy();f.advance(60000);expect(f.view().phase).toBe('RESULTS');clean(f);
  });
});

describe('private five-throw RPS and funded results',()=>{
  it('reveals locked choices only to their owner until resolution, then shares the identical throw publicly',()=>{
    const f=social(),i=invite(f);accept(f,i.id);expect(f.send(f.host,'duel:choose',{choice:'ROCK'}).status).toBe('ok');
    for(const actor of f.actors){const d=f.view(actor).party!.social!.duel!;expect(d.lockedPlayerIds).toEqual([f.host]);expect(d.throws).toEqual([]);expect(d).not.toHaveProperty('choices');if(actor===f.host)expect(d.ownChoice).toBe('ROCK');else expect(d).not.toHaveProperty('ownChoice');}
    const locked=structuredClone(f.room());expect(f.send(f.host,'duel:choose',{choice:'PAPER'}).status).toBe('rejected');expect(f.room()).toEqual(locked);
    f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().party!.social!.duel!.ownChoice).toBe('ROCK');expect(f.send(f.actors[1]!,'duel:choose',{choice:'SCISSORS'}).status).toBe('ok');
    for(const actor of f.actors)expect(f.view(actor).party!.social!.duel!.throws).toEqual([{number:1,choices:{[f.host]:'ROCK',[f.actors[1]!]:'SCISSORS'},winnerId:f.host}]);
  });
  it('stops at the first three wins, awards the entire pot once and resumes the next Blackjack round',()=>{
    const f=social(),i=invite(f,0,1,250);accept(f,i.id);for(let n=0;n<3;n++)choose(f,'ROCK','SCISSORS');
    const d=f.view().party!.social!.duel!;expect(f.view().phase).toBe('DUEL_RESULT');expect(d).toMatchObject({winnerId:f.host,status:'settled',scores:{[f.host]:3,[f.actors[1]!]:0}});expect(d.throws).toHaveLength(3);
    expect(f.view().players.map(p=>p.balance)).toEqual([1250,750,1000]);expect(f.room().dealerNet).toBe(0);expect(f.view().party!.transfers.filter(t=>t.kind==='commission')).toEqual([]);clean(f);
    const settled=structuredClone(f.room());expect(f.send(f.host,'duel:resign').status).toBe('rejected');expect(f.room()).toEqual(settled);f.advance(1999);expect(f.view().phase).toBe('DUEL_RESULT');f.advance(1);expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.view().party!.duelHistory).toHaveLength(1);clean(f);
  });
  it('counts tied throws toward the five-throw cap and refunds an equal final score',()=>{
    const f=social(),i=invite(f);accept(f,i.id);for(let n=0;n<5;n++)choose(f,'PAPER','PAPER');
    expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel).toMatchObject({winnerId:null,scores:{[f.host]:0,[f.actors[1]!]:0}});expect(f.view().party!.social!.duel!.throws).toHaveLength(5);expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000,1000]);clean(f);
  });
  it('uses the greater score after five throws even without three wins',()=>{
    const f=social(),i=invite(f);accept(f,i.id);choose(f,'ROCK','SCISSORS');choose(f,'ROCK','PAPER');choose(f,'ROCK','SCISSORS');choose(f,'PAPER','PAPER');choose(f,'ROCK','ROCK');
    expect(f.view().party!.social!.duel).toMatchObject({winnerId:f.host,scores:{[f.host]:2,[f.actors[1]!]:1}});expect(f.view().players.map(p=>p.balance)).toEqual([1100,900,1000]);clean(f);
  });
  it('forfeits each missing throw, draws simultaneous omissions and never extends an eight-second decision',()=>{
    const f=social(),i=invite(f);accept(f,i.id);const first=f.view().party!.social!.duel!;expect(first.deadline-first.startedAt).toBe(8000);expect(first.hardDeadline-first.startedAt).toBe(60000);
    f.advance(8000);expect(f.view().party!.social!.duel!.throws[0]).toMatchObject({winnerId:null,choices:{[f.host]:null,[f.actors[1]!]:null}});
    for(let n=0;n<3;n++){expect(f.send(f.host,'duel:choose',{choice:'PAPER'}).status).toBe('ok');f.advance(8000);}
    expect(f.view().party!.social!.duel!.winnerId).toBe(f.host);expect(f.view().party!.social!.duel!.throws).toHaveLength(4);clean(f);
  });
  it('rejects exact-deadline and previous-throw choices without affecting the next decision',()=>{
    const f=social(),i=invite(f);accept(f,i.id);const late=f.command(f.host,'duel:choose',{choice:'ROCK'});f.advance(8000);const next=structuredClone(f.room());
    expect(f.manager.command(f.host,late).status).toBe('rejected');expect(f.room()).toEqual(next);choose(f,'ROCK','PAPER');expect(f.manager.command(f.host,{...late,requestId:'another-old-throw'}).status).toBe('rejected');
  });
  it('rejects spectator, stale-duel and invalid choices, and detects changed payload retries after a choice locks',()=>{
    const f=social(),i=invite(f);accept(f,i.id);const before=structuredClone(f.room());
    expect(f.send(f.actors[2]!,'duel:choose',{choice:'ROCK'}).status).toBe('rejected');expect(f.send(f.host,'duel:choose',{choice:'LIZARD'}).status).toBe('rejected');expect(f.send(f.host,'duel:choose',{choice:'ROCK'},{duelId:'stale-duel'}).status).toBe('rejected');expect(f.room()).toEqual(before);
    const c=f.command(f.host,'duel:choose',{choice:'ROCK'}),ack=f.manager.command(f.host,c);expect(ack.status).toBe('ok');const locked=structuredClone(f.room());expect(f.manager.command(f.host,c)).toEqual(ack);expect(f.manager.command(f.host,{...c,payload:{choice:'PAPER'}}).code).toBe('REQUEST_CONFLICT');expect(f.room()).toEqual(locked);
  });
  it('keeps accepted stakes binding through disconnect, and an explicit resignation awards the opponent',()=>{
    const f=social(),i=invite(f);accept(f,i.id);f.manager.presence(f.host,false);expect(f.room().players[0]!.account.balance).toBe(900);expect(Object.values(f.room().players[0]!.account.escrows)).toEqual([100]);f.advance(8000);f.manager.presence(f.host,true);
    expect(f.send(f.host,'duel:resign').status).toBe('ok');expect(f.view().party!.social!.duel!.winnerId).toBe(f.actors[1]);expect(f.view().players.map(p=>p.balance)).toEqual([900,1100,1000]);clean(f);
  });
  it('drains accepted contests during low-player recovery before settling final results',()=>{
    const f=social(2),i=invite(f);accept(f,i.id);f.manager.presence(f.actors[1]!,false);f.advance(40000);expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel!.throws).toHaveLength(5);clean(f);
    f.advance(2000);expect(f.view().phase).toBe('WAITING_FOR_PLAYERS');f.advance(18000);expect(f.view().phase).toBe('RESULTS');clean(f);
  });
});

describe('secure Coin Flip and scoped settlement retries',()=>{
  it.each([[0,'HEADS',true],[0,'TAILS',false],[1,'TAILS',true],[1,'HEADS',false]] as const)('maps injected flip %s and defender %s to the funded outcome',(index,side,defenderWins)=>{
    const random=vi.fn(()=>index),f=social(3,random),i=invite(f,0,1,150);accept(f,i.id,1,'COIN',side);expect(random).toHaveBeenCalledExactlyOnceWith(2);
    const d=f.view().party!.social!.duel!;expect(d.coinResult).toBe(index===0?'HEADS':'TAILS');expect(d.winnerId).toBe(f.actors[defenderWins?1:0]);expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().players.map(p=>p.balance)).toEqual(defenderWins?[850,1150,1000]:[1150,850,1000]);clean(f);
  });
  it('retains history and stats for observers, clears them on replay, and cannot settle an old acceptance twice',()=>{
    const f=social(),i=invite(f),cmd=f.command(f.actors[1]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:i.id}),ack=f.manager.command(f.actors[1]!,cmd);expect(ack.status).toBe('ok');f.advance(2000);
    expect(f.view().party!.duelHistory).toHaveLength(1);expect(f.view().party!.duelStats.find(s=>s.playerId===f.actors[1])).toMatchObject({wins:1,losses:0,draws:0});
    f.advance(RULES.bettingMs+RULES.resultMs);f.advance(20000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('RESULTS');const after=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,cmd)).toEqual(ack);expect(f.room()).toEqual(after);clean(f);
    expect(f.send(f.host,'results:return').status).toBe('ok');f.start();expect(f.view().party).toMatchObject({social:null,duelHistory:[]});expect(f.view().party!.duelStats.every(s=>s.wins===0&&s.losses===0&&s.draws===0)).toBe(true);expect(f.manager.command(f.actors[1]!,{...cmd,requestId:'new-id-old-match'}).status).toBe('rejected');clean(f);
  });
});

describe('funded Connect 4 and Bullet Chess contests',()=>{
  function board(game:'CONNECT4'|'CHESS',randomIndex:(length:number)=>number=()=>0){const f=social(3,randomIndex),i=invite(f);accept(f,i.id,1,game);return f;}
  function drop(f:F,column:number){const id=f.view().party!.social!.duel!.connect4!.activePlayerId;expect(f.send(id,'duel:move',{column}).status).toBe('ok');assertRoom(f.room());}
  function move(f:F,from:string,to:string,promotion?:string){const id=f.view().party!.social!.duel!.chess!.turnId;expect(f.send(id,'duel:move',{from,to,...(promotion?{promotion}:{})}).status).toBe('ok');assertRoom(f.room());}
  it.each([0,1])('randomly assigns Connect 4 first turn with injected index %s and shares an identical spectator board',(index)=>{const random=vi.fn(()=>index),f=board('CONNECT4',random),d=f.view().party!.social!.duel!;expect(random).toHaveBeenCalledExactlyOnceWith(2);expect(d.connect4!.activePlayerId).toBe(f.actors[index]);expect(d.hardDeadline-d.startedAt).toBe(45000);expect(d.deadline-d.startedAt).toBe(8000);drop(f,3);for(const actor of f.actors)expect(f.view(actor).party!.social!.duel!.connect4).toEqual(f.view().party!.social!.duel!.connect4);cleanAccepted(f);});
  function cleanAccepted(f:F){expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([100,100]);assertRoom(f.room());}
  it('settles a funded four-in-a-row exactly once and preserves the completed public board',()=>{const f=board('CONNECT4');for(let n=0;n<3;n++){drop(f,0);drop(f,1);}const cmd=f.command(f.host,'duel:move',{column:0}),ack=f.manager.command(f.host,cmd);expect(ack.status).toBe('ok');expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel!.winnerId).toBe(f.host);expect(f.view().players.map(p=>p.balance)).toEqual([1100,900,1000]);const after=structuredClone(f.room());expect(f.manager.command(f.host,cmd)).toEqual(ack);expect(f.room()).toEqual(after);clean(f);});
  it('rejects old move IDs, spectator turns, full columns, wrong games and altered retries without mutations',()=>{const f=board('CONNECT4'),first=f.command(f.host,'duel:move',{column:2});expect(f.manager.command(f.host,first).status).toBe('ok');for(let n=0;n<5;n++)drop(f,2);const before=structuredClone(f.room());for(const [actor,payload,extra] of [[f.host,{column:2},{}],[f.host,{column:1},{moveId:first.moveId}],[f.actors[2],{column:1},{}],[f.actors[1],{column:1},{}],[f.host,{from:'e2',to:'e4'},{}]] as const){expect(f.send(actor!,'duel:move',payload,extra).status).toBe('rejected');expect(f.room()).toEqual(before);}expect(f.manager.command(f.host,{...first,payload:{column:0}}).code).toBe('REQUEST_CONFLICT');expect(f.room()).toEqual(before);});
  it('forfeits at the exact eight-second move deadline and keeps disconnected accepted stakes binding',()=>{const f=board('CONNECT4'),late=f.command(f.host,'duel:move',{column:0});f.manager.presence(f.host,false);f.advance(7999);expect(f.view().phase).toBe('DUEL');expect(f.view().players[0]!.committed).toBe(100);f.manager.presence(f.host,true);expect(f.view().party!.social!.duel!.deadline-f.view().serverTime).toBe(1);f.advance(1);expect(f.view().party!.social!.duel!.winnerId).toBe(f.actors[1]);expect(f.view().players.map(p=>p.balance)).toEqual([900,1100,1000]);const after=structuredClone(f.room());expect(f.manager.command(f.host,late).status).toBe('rejected');expect(f.room()).toEqual(after);clean(f);});
  it('refunds an unfinished Connect 4 board at forty-five seconds without extending its hard limit',()=>{const f=board('CONNECT4');for(let n=0;n<6;n++){f.advance(7000);drop(f,n);}f.advance(2999);expect(f.view().phase).toBe('DUEL');f.advance(1);expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel).toMatchObject({winnerId:null,reason:expect.stringContaining('45-second')});expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000,1000]);clean(f);});
  it.each([0,1])('randomly assigns chess colors with injected index %s and publishes only serializable common board state',(index)=>{const random=vi.fn(()=>index),f=board('CHESS',random),d=f.view().party!.social!.duel!;expect(random).toHaveBeenCalledExactlyOnceWith(2);expect(d.chess!.whiteId).toBe(f.actors[index]);expect(d.chess!.blackId).toBe(f.actors[index?0:1]);expect(d.hardDeadline-d.startedAt).toBe(60000);expect(d.deadline-d.startedAt).toBe(30000);move(f,'e2','e4');for(const actor of f.actors){const view=f.view(actor).party!.social!.duel!;expect(view.chess).toEqual(f.view().party!.social!.duel!.chess);expect(view).not.toHaveProperty('chessPgn');}cleanAccepted(f);});
  it('never changes the board or pauses a running chess clock after an illegal or stale move',()=>{const f=board('CHESS'),old=f.command(f.host,'duel:move',{from:'e2',to:'e4'});f.advance(1234);const before=structuredClone(f.room());for(const [actor,payload,extra] of [[f.host,{from:'e2',to:'e5'},{}],[f.actors[1],{from:'e7',to:'e5'},{}],[f.host,{from:'e2',to:'e4',promotion:'Q'},{}],[f.actors[2],{from:'e2',to:'e4'},{}]] as const){expect(f.send(actor!,'duel:move',payload,extra).status).toBe('rejected');expect(f.room()).toEqual(before);}expect(f.manager.command(f.host,old).status).toBe('ok');expect(f.view().party!.social!.duel!.chess!.remainingMs[f.host]).toBe(28766);move(f,'e7','e5');const next=structuredClone(f.room());expect(f.manager.command(f.host,{...old,requestId:'old-move-new-request'}).status).toBe('rejected');expect(f.room()).toEqual(next);cleanAccepted(f);});
  it('retains fractional monotonic timestamps and charges them without rounding or rejecting legal moves',()=>{const f=board('CHESS'),base=f.manager.e.now;f.manager.e.now=()=>base()+0.25;f.advance(1);move(f,'e2','e4');expect(f.view().party!.social!.duel!.chess!.remainingMs[f.host]).toBe(29998.75);cleanAccepted(f);});
  it('charges the moving side only and retains clock time across disconnect and reconnect',()=>{const f=board('CHESS');f.advance(1500);move(f,'e2','e4');f.manager.presence(f.actors[1]!,false);f.advance(7000);f.manager.presence(f.actors[1]!,true);const current=f.view().party!.social!.duel!;expect(current.deadline-f.view().serverTime).toBe(23000);expect(current.chess!.remainingMs).toEqual({[f.host]:28500,[f.actors[1]!]:30000});move(f,'e7','e5');expect(f.view().party!.social!.duel!.chess!.remainingMs).toEqual({[f.host]:28500,[f.actors[1]!]:23000});cleanAccepted(f);});
  it('awards a real standard-position flag exactly once and rejects a move at zero time',()=>{const f=board('CHESS'),late=f.command(f.host,'duel:move',{from:'e2',to:'e4'});f.advance(29999);expect(f.view().phase).toBe('DUEL');f.advance(1);expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel!.winnerId).toBe(f.actors[1]);expect(f.view().players.map(p=>p.balance)).toEqual([900,1100,1000]);const after=structuredClone(f.room());expect(f.manager.command(f.host,late).status).toBe('rejected');expect(f.room()).toEqual(after);clean(f);});
  it('awards a legal checkmate and refunds a full-history threefold draw',()=>{for(const mate of [true,false]){const f=board('CHESS');if(mate){for(const [from,to] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']])move(f,from,to);}else for(let n=0;n<2;n++)for(const [from,to] of [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']])move(f,from,to);expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel!.reason).toBe(mate?'Checkmate.':'Threefold repetition.');expect(f.view().players.map(p=>p.balance)).toEqual(mate?[900,1100,1000]:[1000,1000,1000]);clean(f);}});
  it('draws a queen-side flag against a bare king using test-only internal position injection',()=>{const f=board('CHESS'),d=f.room().party!.social!.duel!,c=new Chess('7k/8/8/8/8/8/8/KQ6 w - - 0 1');d.chess!.fen=c.fen();d.chessPgn=c.pgn();d.chess!.board=c.board().flatMap(row=>row.flatMap(p=>p?[{square:p.square,piece:p.type,color:p.color}]:[]));d.chess!.legalMoves=c.moves({verbose:true}).map(m=>({from:m.from,to:m.to,...(m.promotion?{promotion:m.promotion}:{})}));f.advance(30000);expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel!.winnerId).toBeNull();expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000,1000]);clean(f);});
  it('freezes the authoritative chess clock on resignation and preserves that final time in history',()=>{const f=board('CHESS');f.advance(1234);expect(f.send(f.host,'duel:resign').status).toBe('ok');const settled=f.view().party!.social!.duel!;expect(settled.chess!.remainingMs[f.host]).toBe(28766);expect(settled.chess!.clockStartedAt).toBe(f.view().serverTime);expect(f.view().party!.duelHistory[0]!.chess).toEqual(settled.chess);f.advance(1000);expect(f.view().party!.social!.duel!.chess).toEqual(settled.chess);expect(f.view().players.map(p=>p.balance)).toEqual([900,1100,1000]);clean(f);});
  it('refunds a controlled sixty-second cap branch even when a clock expires simultaneously',()=>{const f=board('CHESS'),d=f.room().party!.social!.duel!;
    // Test-only clock setup isolates hard-cap precedence; normal play may flag earlier.
    d.chess!.clockStartedAt=d.startedAt+30000;d.deadline=d.hardDeadline;f.room().deadline=d.hardDeadline;f.advance(60000);expect(f.view().phase).toBe('DUEL_RESULT');expect(f.view().party!.social!.duel).toMatchObject({winnerId:null,reason:expect.stringContaining('60-second')});expect(f.view().players.map(p=>p.balance)).toEqual([1000,1000,1000]);clean(f);});
});
