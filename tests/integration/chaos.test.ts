import {describe,expect,it} from 'vitest';
import {RULES,type ChaosKind} from '@bluff-house/shared';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {reserve} from '../../apps/server/src/game/ledger.js';
import {fixture} from '../fixtures/core.js';

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
    const f=betting(2);balances(f,[0,100]);card(f,0,'EMERGENCY_FUND');f.advance(RULES.bettingMs+RULES.resultMs);expect(f.view().phase).toBe('SOCIAL');f.advance(20000);expect(f.view().phase).toBe('BETTING');expect(f.view().players[0]!.balance).toBe(0);const held=f.view().party!.chaos.inventories.find(i=>i.playerId===f.host)!.cards.find(c=>c.kind==='EMERGENCY_FUND')!;expect(activate(f,0,held.id).status).toBe('ok');expect(f.view().players[0]!.balance).toBe(100);assertRoom(f.room());
  });
});
