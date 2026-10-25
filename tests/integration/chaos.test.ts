import {describe,expect,it} from 'vitest';
import {RULES,type ChaosKind} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {reserve} from '../../apps/server/src/game/ledger.js';
import {fixture} from '../fixtures/core.js';
import type {Rank} from '@bluff-house/shared';

type F=ReturnType<typeof fixture>;
function betting(players=3,ranks?:NonNullable<Parameters<typeof fixture>[0]>['ranks']){const f=fixture({mode:'PARTY',players,ranks});f.start();f.advance(22000);expect(f.view().phase).toBe('BETTING');return f;}
let serial=0;
function card(f:F,seat:number,kind:ChaosKind){const id=`injected-chaos-${++serial}`;f.room().party!.chaos.inventories[f.actors[seat]!]=[{id,kind}];return id;}
function activate(f:F,seat:number,id:string){return f.send(f.actors[seat]!,'chaos:activate',{cardId:id});}
function balances(f:F,amounts:number[]){const r=f.room();amounts.forEach((amount,i)=>{r.dealerNet+=amount-r.players[i]!.account.balance;r.players[i]!.account.balance=amount;});assertRoom(r);}
function reserveBonus(f:F,remaining:number){const r=f.room(),p=r.players[0]!,paid=r.party!.bonusReserve-remaining;p.account.balance+=paid;r.party!.bonusReserve=remaining;r.party!.transfers.push({id:`test-bonus-${++serial}`,kind:'bonus',amount:paid,from:'BONUS_RESERVE',to:p.id});assertRoom(r);}
function finish(f:F){for(let n=0;n<30&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);}expect(f.view().phase).toBe('ROUND_RESULT');assertRoom(f.room());}

describe('funded monetary Chaos activation',()=>{
  it('grants real cards after settled non-final rounds, restores them on reconnect, and consumes an earned card next round',()=>{
    const f=betting(3);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('SOCIAL');const inventories=f.view().party!.chaos.inventories;expect(inventories.map(i=>i.cards.map(c=>c.kind))).toEqual([['DOUBLE_DOWN'],['DOUBLE_DOWN'],['DOUBLE_DOWN']]);const id=inventories.find(i=>i.playerId===f.host)!.cards[0]!.id;
    f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().party!.chaos.inventories).toEqual(inventories);f.advance(20000);expect(f.send(f.host,'bet:submit',{amount:100}).status).toBe('ok');expect(activate(f,0,id).status).toBe('ok');expect(f.view().players[0]!.reserved).toBe(200);assertRoom(f.room());
  });
  it('accepts a final pre-deadline activation, rejects a different card at the exact close, and keeps the settled command idempotent',()=>{
    const f=betting(2);f.bet(100);const first=card(f,0,'DOUBLE_DOWN'),late=card(f,1,'TRIPLE_DOWN');f.advance(RULES.bettingMs-1);const cmd=f.command(f.host,'chaos:activate',{cardId:first}),ack=f.manager.command(f.host,cmd);expect(ack.status).toBe('ok');const lateCommand=f.command(f.actors[1]!,'chaos:activate',{cardId:late});f.advance(1);const closed=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,lateCommand).status).toBe('rejected');expect(f.manager.command(f.host,cmd)).toEqual(ack);expect(f.room()).toEqual(closed);expect(f.view().players.map(p=>p.committed)).toEqual([200,100]);
  });
  it.each([['DOUBLE_DOWN',2],['TRIPLE_DOWN',3]] as const)('funds %s immediately and settles a natural at the full 3:2 rate',(kind,factor)=>{
    const f=betting(2,['10','A','10','7','K','7']);f.bet(250);const id=card(f,1,kind),cmd=f.command(f.actors[1]!,'chaos:activate',{cardId:id}),ack=f.manager.command(f.actors[1]!,cmd);expect(ack.status).toBe('ok');
    expect(f.view().players[1]).toMatchObject({balance:1000,wager:250*factor,reserved:250*factor,available:1000-250*factor});expect(f.view().party!.chaos.usedThisRound).toBe(false);expect(f.view(f.actors[1]).party!.chaos.usedThisRound).toBe(true);
    const after=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,cmd)).toEqual(ack);expect(f.room()).toEqual(after);f.deal();finish(f);
    expect(f.view().roundPayouts[1]).toMatchObject({stake:250*factor,returned:625*factor,profit:375*factor});expect(f.view().players[1]!.balance).toBe(1000+375*factor);assertRoom(f.room());
  });
  it('calculates House commission from actual multiplied natural profit without reducing the return',()=>{
    const f=fixture({mode:'PARTY',ranks:['10','A','10','7','K','7']});f.start();expect(f.send(f.host,'house:bid',{amount:50}).status).toBe('ok');f.advance(22000);f.bet(250);expect(activate(f,1,card(f,1,'TRIPLE_DOWN')).status).toBe('ok');f.deal();finish(f);
    expect(f.view().roundPayouts[1]).toMatchObject({stake:750,returned:1875,profit:1125,houseCommission:33});expect(f.view().players.map(p=>p.balance)).toEqual([983,2125]);expect(f.room().dealerNet).toBe(1158);assertRoom(f.room());
  });
  it('rejects unfunded multiplication atomically and retains both the held card and activation allowance',()=>{
    const f=betting();f.bet(250);reserve(f.room().players[0]!.account,'other-funds',600);const id=card(f,0,'TRIPLE_DOWN'),before=structuredClone(f.room());expect(activate(f,0,id).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it.each(['bet:withdraw','bet:submit'] as const)('clears the wager multiplier on %s without refunding the consumed card or allowance',(action)=>{
    const f=betting(),id=card(f,0,'TRIPLE_DOWN');f.bet(250);expect(activate(f,0,id).status).toBe('ok');expect(f.send(f.host,action,action==='bet:submit'?{amount:100}:undefined).status).toBe('ok');
    expect(f.room().party!.chaos.multipliers[f.host]).toBeUndefined();expect(f.view().players[0]!.reserved).toBe(action==='bet:submit'?100:0);expect(f.view().party!.chaos.usedThisRound).toBe(true);expect(f.view().party!.chaos.inventories.find(i=>i.playerId===f.host)?.cards).toEqual([]);
    expect(activate(f,0,card(f,0,'DOUBLE_DOWN')).status).toBe('rejected');assertRoom(f.room());
  });
  it('rejects foreign cards, stale round/betting IDs and client-selected effect fields without mutation',()=>{
    const f=betting(),id=card(f,1,'DOUBLE_DOWN');f.bet();const before=structuredClone(f.room());
    for(const [actor,payload,extra] of [[f.host,{cardId:id},{}],[f.actors[1],{cardId:id},{bettingId:'old'}],[f.actors[1],{cardId:id},{roundId:'old'}],[f.actors[1],{cardId:id,amount:750},{}]] as const){expect(f.send(actor!,'chaos:activate',payload,extra).status).toBe('rejected');expect(f.room()).toEqual(before);}
  });
  it('does not expose Chaos functionality in Classic or permit activation after betting closes',()=>{
    const classic=fixture();classic.start();const unchanged=structuredClone(classic.room());expect(classic.send(classic.host,'chaos:activate',{cardId:'invented'}).status).toBe('rejected');expect(classic.room()).toEqual(unchanged);
    const f=betting(),id=card(f,0,'DOUBLE_DOWN');f.bet();f.deal();const before=structuredClone(f.room());expect(activate(f,0,id).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
});

describe('voluntary Pot Twist deadline and funding',()=>{
  it('rejects a second Pot Twist without consuming that owner’s card or allowance',()=>{const f=betting();f.bet();const first=card(f,0,'POT_TWIST'),second=card(f,1,'POT_TWIST');expect(activate(f,0,first).status).toBe('ok');const before=structuredClone(f.room());expect(activate(f,1,second).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view(f.actors[1]).party!.chaos.usedThisRound).toBe(false);});
  it('opens five seconds after ordinary betting, doubles only opt-ins, rejects stacking, and commits once',()=>{
    const f=betting(4);for(const a of f.actors.slice(0,3))f.send(a,'bet:submit',{amount:250});const pot=card(f,0,'POT_TWIST');expect(activate(f,0,pot).status).toBe('ok');expect(activate(f,1,card(f,1,'DOUBLE_DOWN')).status).toBe('ok');f.advance(RULES.bettingMs);
    expect(f.view().phase).toBe('POT_TWIST');expect(f.view().deadline!-f.view().serverTime).toBe(5000);expect(f.view().players.map(p=>p.committed)).toEqual([0,0,0,0]);const window=f.view().party!.chaos.potTwist!.id;
    const before=structuredClone(f.room());for(const seat of [1,3]){expect(f.send(f.actors[seat]!,'chaos:optin').status).toBe('rejected');expect(f.room()).toEqual(before);}
    expect(f.send(f.host,'chaos:optin',undefined,{chaosWindowId:'old'}).status).toBe('rejected');expect(f.room()).toEqual(before);
    const cmd=f.command(f.host,'chaos:optin'),ack=f.manager.command(f.host,cmd);expect(ack.status).toBe('ok');expect(f.manager.command(f.host,cmd)).toEqual(ack);expect(f.send(f.actors[2]!,'chaos:optin').status).toBe('ok');expect(f.view().players.map(p=>p.wager)).toEqual([500,500,500,0]);
    expect(f.view(f.actors[2]).party!.chaos.usedThisRound).toBe(true);f.advance(4999);expect(f.view().phase).toBe('POT_TWIST');f.advance(1);expect(f.view().phase).toBe('DEALING');expect(f.view().players.map(p=>p.committed)).toEqual([500,500,500,0]);
    const closed=structuredClone(f.room());expect(f.send(f.actors[2]!,'chaos:optin',undefined,{chaosWindowId:window}).status).toBe('rejected');expect(f.room()).toEqual(closed);assertRoom(f.room());
  });
  it('preserves an unfunded recipient action and lets the reservation owner decline without extra chips',()=>{
    const f=betting(2);f.bet(250);expect(activate(f,0,card(f,0,'POT_TWIST')).status).toBe('ok');reserve(f.room().players[1]!.account,'other-money',600);f.advance(RULES.bettingMs);const before=structuredClone(f.room());expect(f.send(f.actors[1]!,'chaos:optin').status).toBe('rejected');expect(f.room()).toEqual(before);f.advance(5000);expect(f.view().players.map(p=>p.wager)).toEqual([250,250]);assertRoom(f.room());
  });
  it('continues the published opt-in deadline through disconnect, drains wagers, and never starts a new contest after recovery expires',()=>{
    const f=betting(2);f.bet(100);expect(activate(f,0,card(f,0,'POT_TWIST')).status).toBe('ok');f.advance(RULES.bettingMs);expect(f.send(f.host,'chaos:optin').status).toBe('ok');f.manager.presence(f.actors[1]!,false);const deadline=f.view().deadline;f.advance(5000);expect(f.view().phase).toBe('DEALING');expect(f.room().players.map(p=>p.wager)).toEqual([200,100]);expect(deadline).not.toBeNull();f.advance(100000);
    expect(f.view().phase).toBe('RESULTS');expect(f.room().players.flatMap(p=>Object.values(p.account.escrows))).toEqual([]);expect(f.room().players.flatMap(p=>Object.values(p.account.reservations))).toEqual([]);assertRoom(f.room());
  });
});

describe('finite Emergency Fund',()=>{
  it('credits the displayed award from reserve once before wagering, then forbids a second award in a later round',()=>{
    const f=betting(),id=card(f,0,'EMERGENCY_FUND');expect(f.view().party!.chaos.emergencyAmount).toBe(100);expect(activate(f,0,id).status).toBe('ok');expect(f.view().players[0]!.balance).toBe(1100);expect(f.view().party!.bonusReserve).toBe(200);expect(f.view().party!.transfers.filter(t=>t.kind==='bonus')).toHaveLength(1);
    f.advance(RULES.bettingMs+RULES.resultMs+20000);expect(f.view().round).toBe(2);const again=card(f,0,'EMERGENCY_FUND'),before=structuredClone(f.room());expect(activate(f,0,again).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('requires no submitted wager and retains the card on an empty reserve',()=>{
    const f=betting(),id=card(f,1,'EMERGENCY_FUND');expect(f.send(f.actors[1]!,'bet:submit',{amount:50}).status).toBe('ok');let before=structuredClone(f.room());expect(activate(f,1,id).status).toBe('rejected');expect(f.room()).toEqual(before);
    f.send(f.actors[1]!,'bet:withdraw');reserveBonus(f,0);expect(f.view(f.actors[1]).party!.chaos.emergencyAmount).toBe(0);before=structuredClone(f.room());expect(activate(f,1,id).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('discloses a smaller final award and resolves competing spenders without overdrawing or consuming the losing card',()=>{
    const f=betting();reserveBonus(f,37);const first=card(f,1,'EMERGENCY_FUND'),second=card(f,2,'EMERGENCY_FUND');expect(f.view(f.actors[1]).party!.chaos.emergencyAmount).toBe(37);expect(activate(f,1,first).status).toBe('ok');expect(f.view().party!.bonusReserve).toBe(0);expect(f.view().players[1]!.balance).toBe(1037);const before=structuredClone(f.room());expect(activate(f,2,second).status).toBe('rejected');expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('allows a held funded Emergency card to avert premature affordability termination without automatically crediting it',()=>{
    const f=betting(2);balances(f,[0,100]);card(f,0,'EMERGENCY_FUND');f.advance(RULES.bettingMs+RULES.resultMs);if(f.view().phase==='SOCIAL')f.advance(20000);expect(f.view()).toMatchObject({phase:'BETTING',round:2});expect(f.view().players[0]!.balance).toBe(0);const held=f.view().party!.chaos.inventories.find(i=>i.playerId===f.host)!.cards.find(c=>c.kind==='EMERGENCY_FUND')!;expect(activate(f,0,held.id).status).toBe('ok');expect(f.view().players[0]!.balance).toBe(100);assertRoom(f.room());
  });
});

function movement(players=3,ranks?:Rank[]){
  const order=ranks??[...Array.from({length:players},(_,i)=>String(i+4) as Rank),'10',...Array.from({length:players},(_,i)=>String(i+5) as Rank),'7','3','2','10'];
  const f=betting(players,order);f.bet();f.advance(RULES.bettingMs+RULES.dealingMs);expect(f.view().phase).toBe('HAND_CHAOS');return f;
}
function ordinary(ranks:Rank[]=['6','9','10','6','8','7','3','2','10']){const f=betting(2,ranks);f.bet();f.deal();expect(f.view().phase).toBe('PLAYER_TURN');return f;}
const ids=(f:F)=>f.room().players.map(p=>p.hand.map(c=>c.id));
const play=(f:F,seat:number,id:string,targetId?:string)=>f.send(f.actors[seat]!,'chaos:activate',{cardId:id,...(targetId?{targetId}:{})});

describe('shared pre-turn Hand Swap and Table Turn window',()=>{
  it.each([2,3,4,5,6])('publishes one shared five-second window and swaps real cards at %i seats',players=>{
    const f=movement(players),before=ids(f),target=players-1,id=card(f,0,'HAND_SWAP'),wagers=f.room().players.map(p=>p.wager),dealer=structuredClone(f.room().dealer),window=f.view().party!.chaos.handWindow!;
    expect(window).toMatchObject({deadline:f.view().serverTime+5000,resolved:false,eligibleIds:f.actors});expect(f.view().decisionId).toBeUndefined();
    expect(f.view().party!.chaos.handTargets).toEqual(f.actors.slice(1));expect(play(f,0,id,f.actors[target]).status).toBe('ok');
    [before[0],before[target]]=[before[target]!,before[0]!];expect(ids(f)).toEqual(before);expect(f.room().dealer).toEqual(dealer);expect(f.room().players.map(p=>p.wager)).toEqual(wagers);
    expect(f.view().party!.chaos.usedThisRound).toBe(true);expect(f.view(f.actors[target]).party!.chaos.usedThisRound).toBe(false);expect(f.view().party!.chaos.handWindow!.resolved).toBe(true);expect(f.view().party!.chaos.handTargets).toEqual([]);
    f.advance(5000);expect(f.view().phase).toBe('PLAYER_TURN');expect(f.view().deadline!-f.view().serverTime).toBe(RULES.decisionMs);assertRoom(f.room());
  });
  it.each([2,3,4,5,6])('rotates every eligible hand one seat left at %i seats',players=>{
    const f=movement(players),before=ids(f),id=card(f,players-1,'TABLE_TURN'),cursor=f.room().cursor;
    expect(play(f,players-1,id).status).toBe('ok');expect(ids(f)).toEqual([...before.slice(1),before[0]]);expect(f.room().cursor).toBe(cursor);expect(f.room().discarded).toEqual([]);expect(f.room().players.map(p=>p.seat)).toEqual(Array.from({length:players},(_,i)=>i));assertRoom(f.room());
  });
  it('opens the window without a held movement card and never exposes the dealer hole card early',()=>{
    const f=movement();expect(f.view().party!.chaos.inventories.flatMap(i=>i.cards)).toEqual([]);expect(f.view().dealer[1]).toBeNull();f.advance(5000);expect(f.view().phase).toBe('PLAYER_TURN');expect(f.view().dealer[1]).toBeNull();
  });
  it('protects natural hands and skips the whole window when the dealer has a natural',()=>{
    const f=movement(3,['A','6','7','10','K','6','8','7','3']);expect(f.view().players[0]!.status).toBe('natural');expect(f.view().party!.chaos.handWindow!.eligibleIds).toEqual(f.actors.slice(1));expect(f.view().party!.chaos.handTargets).toEqual([]);
    const natural=structuredClone(f.room().players[0]!.hand),id=card(f,1,'TABLE_TURN');expect(play(f,1,id).status).toBe('ok');expect(f.room().players[0]!.hand).toEqual(natural);assertRoom(f.room());
    const dealer=betting(2,['6','9','A','6','8','K']);dealer.bet();dealer.advance(RULES.bettingMs+RULES.dealingMs);expect(dealer.view().phase).toBe('ROUND_RESULT');expect(dealer.view().party!.chaos.handWindow).toBeNull();assertRoom(dealer.room());
  });
  it('recomputes eligible targets after disconnect and reconnect without extending the deadline',()=>{
    const f=movement(4),id=card(f,0,'HAND_SWAP'),deadline=f.view().deadline;f.manager.presence(f.actors[1]!,false);
    expect(f.view().party!.chaos.handWindow!.eligibleIds).toEqual([f.host,...f.actors.slice(2)]);expect(f.view().party!.chaos.handTargets).toEqual(f.actors.slice(2));const before=structuredClone(f.room());expect(play(f,0,id,f.actors[1]).status).toBe('rejected');expect(f.room()).toEqual(before);
    f.advance(2000);f.manager.presence(f.actors[1]!,true);expect(f.view().deadline).toBe(deadline);expect(f.view().party!.chaos.handTargets).toContain(f.actors[1]);expect(play(f,0,id,f.actors[1]).status).toBe('ok');assertRoom(f.room());
  });
  it('rotates around absent and departed seats and preserves their hands and wagers',()=>{
    const f=movement(4),before=ids(f),id=card(f,0,'TABLE_TURN'),wagers=f.room().players.map(p=>p.wager);f.manager.presence(f.actors[1]!,false);expect(f.send(f.actors[2]!,'room:leave').status).toBe('ok');
    expect(play(f,0,id).status).toBe('ok');expect(ids(f)).toEqual([before[3],before[1],before[2],before[0]]);expect(f.room().players.map(p=>p.wager)).toEqual(wagers);assertRoom(f.room());
  });
  it('lets only the first competing effect resolve and preserves the losing held card and allowance',()=>{
    const f=movement(),first=card(f,0,'TABLE_TURN'),second=card(f,1,'HAND_SWAP'),a=f.command(f.host,'chaos:activate',{cardId:first}),b=f.command(f.actors[1]!,'chaos:activate',{cardId:second,targetId:f.actors[2]}),ack=f.manager.command(f.host,a);
    expect(ack.status).toBe('ok');const after=structuredClone(f.room());expect(f.manager.command(f.actors[1]!,b).status).toBe('rejected');expect(f.room()).toEqual(after);expect(f.view(f.actors[1]).party!.chaos.usedThisRound).toBe(false);expect(f.view().party!.chaos.inventories.find(i=>i.playerId===f.actors[1])!.cards).toEqual([{id:second,kind:'HAND_SWAP'}]);expect(f.manager.command(f.host,a)).toEqual(ack);expect(f.room()).toEqual(after);
  });
  it('keeps seat-owned bluff and Chaos allowances and rejects movement after a wager effect was already used',()=>{
    const f=betting(3);f.bet();const multiplier=card(f,0,'DOUBLE_DOWN');expect(play(f,0,multiplier).status).toBe('ok');const swap=card(f,0,'HAND_SWAP');f.advance(RULES.bettingMs+RULES.dealingMs);const before=structuredClone(f.room());expect(play(f,0,swap,f.actors[1]).status).toBe('rejected');expect(f.room()).toEqual(before);
    const turn=card(f,1,'TABLE_TURN');expect(play(f,1,turn).status).toBe('ok');expect(f.view().players.map(p=>p.wager)).toEqual([200,100,100]);expect(f.room().players.map(p=>p.bluffUsed)).toEqual([false,false,false]);expect(f.room().party!.chaos.usedRound[f.actors[2]!]).toBeUndefined();assertRoom(f.room());
  });
  it('rejects self, missing, unknown, foreign and unfunded targets atomically',()=>{
    const f=movement(),held=card(f,0,'HAND_SWAP'),foreign=card(f,1,'TABLE_TURN');
    for(const payload of [{cardId:held},{cardId:held,targetId:f.host},{cardId:held,targetId:'unknown-player'},{cardId:foreign,targetId:f.actors[1]},{cardId:held,targetId:f.actors[1],amount:100}]){const before=structuredClone(f.room());expect(f.send(f.host,'chaos:activate',payload).status).toBe('rejected');expect(f.room()).toEqual(before);}
    const p=f.room().players[1]!;p.status='skipped';const before=structuredClone(f.room());expect(play(f,0,held,p.id).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('rejects stale contexts and an exact-deadline command without consuming the held card',()=>{
    const f=movement(),id=card(f,0,'TABLE_TURN');
    for(const key of ['roomInstanceId','matchId','roundId','chaosWindowId'] as const){const before=structuredClone(f.room());expect(f.send(f.host,'chaos:activate',{cardId:id},{[key]:'old-context'}).status).toBe('rejected');expect(f.room()).toEqual(before);}
    const late=f.command(f.host,'chaos:activate',{cardId:id});f.advance(5000);const closed=structuredClone(f.room());expect(f.manager.command(f.host,late).status).toBe('rejected');expect(f.room()).toEqual(closed);expect(f.view().party!.chaos.usedThisRound).toBe(false);expect(f.view().party!.chaos.inventories[0]!.cards).toHaveLength(1);
  });
  it('settles moved hands against their original wager owners and ranks final balances correctly',()=>{
    const f=betting(2,['10','10','10','9','6','7']);expect(f.send(f.host,'bet:submit',{amount:50}).status).toBe('ok');expect(f.send(f.actors[1]!,'bet:submit',{amount:200}).status).toBe('ok');f.advance(RULES.bettingMs+RULES.dealingMs);const swap=card(f,0,'HAND_SWAP');expect(play(f,0,swap,f.actors[1]).status).toBe('ok');f.advance(5000);finish(f);
    expect(f.view().roundPayouts.map(p=>({playerId:p.playerId,stake:p.stake,returned:p.returned}))).toEqual([{playerId:f.host,stake:50,returned:0},{playerId:f.actors[1],stake:200,returned:400}]);expect(f.view().players.map(p=>p.balance)).toEqual([950,1200]);
    f.advance(RULES.resultMs+20000);expect(f.view().round).toBe(2);expect(f.room().discarded).toEqual([]);f.advance(RULES.bettingMs+RULES.resultMs+20000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('RESULTS');expect(f.view().results!.standings.map(p=>p.id)).toEqual([f.actors[1],f.host]);assertRoom(f.room());
  });
  it('accepts a movement in the final millisecond without extending the published window',()=>{
    const f=movement(),id=card(f,0,'TABLE_TURN'),deadline=f.view().deadline;f.advance(4999);expect(play(f,0,id).status).toBe('ok');expect(f.view().deadline).toBe(deadline);expect(f.view().phase).toBe('HAND_CHAOS');f.advance(1);expect(f.view().phase).toBe('PLAYER_TURN');expect(f.view().deadline!-f.view().serverTime).toBe(RULES.decisionMs);assertRoom(f.room());
  });
  it('keeps the single shared clock running when fewer than two movement recipients remain',()=>{
    const f=movement(),id=card(f,0,'TABLE_TURN'),deadline=f.view().deadline;for(const actor of f.actors.slice(1))f.manager.presence(actor,false);const before=structuredClone(f.room());expect(play(f,0,id).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().deadline).toBe(deadline);f.advance(5000);expect(f.view().phase).toBe('PLAYER_TURN');expect(f.view().party!.chaos.inventories[0]!.cards).toHaveLength(1);assertRoom(f.room());
  });
  it('accepts finite fractional clock deadlines throughout the movement window',()=>{
    const f=fixture({mode:'PARTY',ranks:['6','9','10','6','8','7','3']});f.advance(0.5);f.start();f.advance(22000);f.bet();f.advance(RULES.bettingMs+RULES.dealingMs);expect(f.view().phase).toBe('HAND_CHAOS');expect(f.view().deadline!%1).toBe(0.5);const id=card(f,0,'HAND_SWAP');expect(play(f,0,id,f.actors[1]).status).toBe('ok');assertRoom(f.room());f.advance(5000);expect(f.view().phase).toBe('PLAYER_TURN');expect(f.view().deadline!-f.view().serverTime).toBe(RULES.decisionMs);assertRoom(f.room());
  });
});

describe('Second Chance replaces one ordinary hit without rewriting truth',()=>{
  it('survives reconnect, redraws once, issues a fresh bounded decision and rejects old decision races',()=>{
    const f=ordinary(),id=card(f,0,'SECOND_CHANCE');expect(f.send(f.host,'turn:hit').status).toBe('ok');const hand=structuredClone(f.room().players[0]!.hand),cursor=f.room().cursor,oldHit=f.command(f.host,'turn:hit'),decision=f.view().decisionId;
    f.manager.presence(f.host,false);f.manager.presence(f.host,true);expect(f.view().party!.chaos.actions.find(a=>a.cardId===id)?.eligible).toBe(true);f.advance(7000);
    const redraw=f.command(f.host,'chaos:activate',{cardId:id}),ack=f.manager.command(f.host,redraw);expect(ack.status).toBe('ok');expect(f.view().players[0]!.hand).toEqual([...hand.slice(0,-1),f.room().shoe[cursor]]);expect(f.view().discarded).toEqual([hand.at(-1)]);expect(f.room().cursor).toBe(cursor+1);expect(f.view().decisionId).not.toBe(decision);expect(f.view().deadline!-f.view().serverTime).toBe(RULES.decisionMs);
    const after=structuredClone(f.room());expect(f.manager.command(f.host,oldHit).code).toBe('STALE_DECISION');expect(f.manager.command(f.host,redraw)).toEqual(ack);expect(f.room()).toEqual(after);expect(f.view().party!.chaos.usedThisRound).toBe(true);expect(f.room().party!.chaos.ordinaryHits[f.host]).toBeUndefined();assertRoom(f.room());
  });
  it('replaces the latest of multiple ordinary hits and can produce a final bust without refunding the card',()=>{
    const f=ordinary(),id=card(f,0,'SECOND_CHANCE');expect(f.send(f.host,'turn:hit').status).toBe('ok');const firstHit=f.room().players[0]!.hand.at(-1)!;expect(f.send(f.host,'turn:hit').status).toBe('ok');const latest=f.room().players[0]!.hand.at(-1)!;expect(play(f,0,id).status).toBe('ok');
    expect(f.view().players[0]).toMatchObject({status:'bust',value:{total:25,bust:true}});expect(f.view().players[0]!.hand).toContainEqual(firstHit);expect(f.view().discarded).toEqual([latest]);expect(f.view().activePlayerId).toBe(f.actors[1]);expect(f.view().party!.chaos.inventories[0]!.cards).toEqual([]);assertRoom(f.room());
  });
  it.each<Rank>(['9','K'])('cannot undo an ordinary %s hit that reaches 21 or bust',hit=>{
    const f=ordinary(['6','9','10','6','8','7',hit,'2']),id=card(f,0,'SECOND_CHANCE');expect(f.send(f.host,'turn:hit').status).toBe('ok');const before=structuredClone(f.room());expect(play(f,0,id).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().discarded).toEqual([]);expect(f.view().party!.chaos.inventories[0]!.cards).toHaveLength(1);
  });
  it('cannot redraw before an ordinary hit, for another owner, or with a stale decision',()=>{
    const f=ordinary(),id=card(f,0,'SECOND_CHANCE'),foreign=card(f,1,'SECOND_CHANCE');let before=structuredClone(f.room());expect(play(f,0,id).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.host,'turn:hit').status).toBe('ok');before=structuredClone(f.room());
    expect(play(f,1,foreign).status).toBe('rejected');expect(f.send(f.host,'chaos:activate',{cardId:id},{decisionId:'old-decision'}).status).toBe('rejected');expect(f.send(f.host,'chaos:activate',{cardId:foreign}).status).toBe('rejected');expect(f.room()).toEqual(before);
  });
  it('cannot consume the same round allowance twice or recursively redraw the replacement',()=>{
    const f=ordinary(),first=card(f,0,'SECOND_CHANCE');expect(f.send(f.host,'turn:hit').status).toBe('ok');expect(play(f,0,first).status).toBe('ok');const second=card(f,0,'SECOND_CHANCE'),before=structuredClone(f.room());expect(play(f,0,second).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().discarded).toHaveLength(1);expect(f.view().party!.chaos.inventories[0]!.cards).toEqual([{id:second,kind:'SECOND_CHANCE'}]);
  });
  it('retains the card, marker, decision and original hand when the shoe is exhausted',()=>{
    const f=ordinary(),id=card(f,0,'SECOND_CHANCE');f.send(f.host,'turn:hit');f.room().shoe.length=f.room().cursor;const before=structuredClone(f.room());expect(play(f,0,id)).toMatchObject({status:'rejected',code:'SHOE_EXHAUSTED'});expect(f.room()).toEqual(before);assertRoom(f.room());
  });
  it('consumes only the chosen redraw card while retaining another held card in the full inventory',()=>{
    const f=ordinary(),chosen=card(f,0,'SECOND_CHANCE');f.room().party!.chaos.inventories[f.host]!.push({id:'held-table-turn',kind:'TABLE_TURN'});f.send(f.host,'turn:hit');expect(play(f,0,chosen).status).toBe('ok');expect(f.view().party!.chaos.inventories[0]!.cards).toEqual([{id:'held-table-turn',kind:'TABLE_TURN'}]);expect(f.view().party!.chaos.usedThisRound).toBe(true);assertRoom(f.room());
  });
  it('cannot rewrite an accepted challenge, but a later ordinary hit may be redrawn without altering historical truth',()=>{
    const f=ordinary(),id=card(f,0,'SECOND_CHANCE');expect(f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:100}).status).toBe('ok');expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('ok');const truth=structuredClone(f.room().bluffOutcomes),biggest=structuredClone(f.room().biggestBluff);let before=structuredClone(f.room());expect(play(f,0,id).status).toBe('rejected');expect(f.room()).toEqual(before);
    f.advance(RULES.revealMs);before=structuredClone(f.room());expect(play(f,0,id).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.send(f.host,'turn:hit').status).toBe('ok');expect(play(f,0,id).status).toBe('ok');expect(f.room().bluffOutcomes).toEqual(truth);expect(f.room().biggestBluff).toEqual(biggest);expect(f.view().players[0]!.hand).toContainEqual(truth[0]!.card);expect(f.view().discarded).not.toContainEqual(truth[0]!.card);assertRoom(f.room());
  });
  it('clears the old ordinary-hit permission when a later accepted challenge becomes the newest draw',()=>{
    const f=ordinary(),id=card(f,0,'SECOND_CHANCE');f.send(f.host,'turn:hit');expect(f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:100}).status).toBe('ok');expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('ok');f.advance(RULES.revealMs);const before=structuredClone(f.room());expect(play(f,0,id).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.room().party!.chaos.ordinaryHits[f.host]).toBeUndefined();
  });
  it('rejects redraw at the exact decision deadline and leaves the consumed hand unchanged',()=>{
    const f=ordinary(),id=card(f,0,'SECOND_CHANCE');f.send(f.host,'turn:hit');const late=f.command(f.host,'chaos:activate',{cardId:id});f.advance(RULES.decisionMs);const before=structuredClone(f.room());expect(f.manager.command(f.host,late).status).toBe('rejected');expect(f.room()).toEqual(before);expect(f.view().players[0]!.status).toBe('stood');expect(f.view().discarded).toEqual([]);
  });
  it('settles the replacement hand once, then clears consumed discards and hit markers for the next round and replay',()=>{
    const f=ordinary(),id=card(f,0,'SECOND_CHANCE');f.send(f.host,'turn:hit');expect(play(f,0,id).status).toBe('ok');finish(f);expect(f.view().players.map(p=>p.balance)).toEqual([900,1000]);expect(f.view().discarded).toHaveLength(1);const round=f.view().roundId;
    f.advance(RULES.resultMs+20000);expect(f.view().round).toBe(2);expect(f.view().roundId).not.toBe(round);expect(f.view().discarded).toEqual([]);expect(f.room().party!.chaos.ordinaryHits).toEqual({});expect(f.view().party!.chaos.handWindow).toBeNull();
    f.advance(RULES.bettingMs+RULES.resultMs+20000);f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('RESULTS');expect(f.send(f.host,'results:return').status).toBe('ok');expect(f.view().discarded).toEqual([]);f.start();expect(f.view().phase).toBe('HOUSE_AUCTION');expect(f.view().discarded).toEqual([]);expect(f.room().party!.chaos.ordinaryHits).toEqual({});assertRoom(f.room());
  });
});
