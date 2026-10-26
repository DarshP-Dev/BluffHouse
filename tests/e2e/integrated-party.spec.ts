import {test,expect,scriptedShoe} from '../fixtures/browser.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';

test('four guests carry funded claims, sequential contests, earned Chaos and a private Vault finale through six Party rounds and replay',async({table})=>{
  test.setTimeout(90000);
  // Only the existing server constructor's clock, RNG and shoe are controlled.
  // Every player action below goes through the same browser controls as a guest.
  table.server.manager.e.randomIndex=()=>0;
  table.server.manager.e.shoe=()=>scriptedShoe(['6','10','9','10','6','8','8','6','8','3','10']);
  const pages=await Promise.all(Array.from({length:4},()=>table.newPlayer()));
  const failures:string[]=[];
  for(const page of pages){
    page.on('pageerror',error=>failures.push(`page: ${error.message}`));
    page.on('console',message=>{if(message.type()==='error')failures.push(`console: ${message.text()}`);});
    page.on('requestfailed',request=>{const error=request.failure()?.errorText??'unknown';if(request.url().startsWith(table.url)&&!error.includes('ERR_ABORTED'))failures.push(`local request: ${error}`);});
  }
  const code=await table.host(pages[0]);
  for(let i=1;i<4;i++)await table.join(pages[i],code,['','Blair','Casey','Drew'][i]);
  await pages[0].getByRole('button',{name:'Party',exact:true}).click();
  await pages[0].getByRole('button',{name:'6 rounds',exact:true}).click();
  await expect(pages[0].getByRole('checkbox',{name:'Shadow Draw finale',exact:true})).toBeChecked();
  for(const page of pages)await page.getByRole('button',{name:'Ready Up',exact:true}).click();
  await pages[0].getByRole('button',{name:'Start Game',exact:true}).click();
  const ids=table.view(code).players.map(player=>player.id),matchId=table.view(code).matchId;
  const room=()=>table.server.manager.rooms.get(table.view(code).instanceId)!;
  const conserved=()=>{assertRoom(room());const r=room();expect(r.players.reduce((sum,p)=>sum+p.account.balance+Object.values(p.account.escrows).reduce((n,v)=>n+v,0),0)+(r.party?.bank.balance??0)+(r.party?.vault??0)+(r.party?.bonusReserve??0)).toBe(r.initialChips+(r.party?.bank.initial??0)+(r.party?.initialBonusReserve??0));};
  await pages[3].getByRole('button',{name:'House bid 100 chips',exact:true}).click();
  await pages[3].getByRole('button',{name:'Submit House Bid',exact:false}).click();
  for(const page of pages.slice(0,3))await page.getByRole('button',{name:'Pass Auction',exact:true}).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading',{name:'Place your bets',exact:true})).toBeVisible();
  expect(table.view(code).party).toMatchObject({houseId:ids[3],vault:100});conserved();
  for(const page of pages.slice(0,3))await page.getByRole('button',{name:'Place Bet',exact:false}).click();
  table.advance(26000);
  await pages[0].getByRole('combobox',{name:'Your bluff claim',exact:true}).selectOption('DEALER_BUST');
  await pages[0].getByRole('button',{name:'Bluff 150 chips',exact:true}).click();
  await pages[0].getByRole('button',{name:/^Call My Bluff/}).click();
  await pages[2].getByRole('button',{name:/^Accept Challenge/}).click();
  await expect.poll(()=>table.view(code).pendingClaims.length).toBe(1);
  expect(table.view(code).players.map(p=>p.committed)).toEqual([250,100,250,0]);conserved();
  await pages[0].reload();
  await expect(pages[0].locator('.bluff-event')).toContainText('Escrow locked. Outcome pending.');
  expect(table.view(code).pendingClaims[0]).not.toHaveProperty('evidence');
  expect(table.view(code).dealer[1]).toBeNull();
  table.advance(2000);
  await pages[0].getByRole('button',{name:/^Hit/}).click();
  await pages[0].getByRole('button',{name:/^Stand/}).click();
  await pages[1].getByRole('button',{name:/^Double Down/}).click();
  expect(table.view(code).players[1]).toMatchObject({doubled:true,wager:200,status:'stood'});
  await pages[2].getByRole('button',{name:'Stand',exact:true}).click();
  await pages[3].getByRole('button',{name:'Dealer Hit',exact:true}).click();
  await expect(pages[0].getByRole('heading',{name:'Round settled',exact:true})).toBeVisible();
  expect(table.view(code).players.map(p=>p.balance)).toEqual([1250,1200,950,650]);
  expect(table.view(code).party!.bank.rounds[0]).toMatchObject({net:-400,bondLoss:250,bankLoss:150});
  expect(table.view(code).claimOutcomes[0]).toMatchObject({winnerId:ids[0],evidence:{dealerBust:true,claimTrue:true}});
  expect(table.view(code).pendingClaims).toEqual([]);
  const earned=table.view(code).party!.chaos.inventories.find(inventory=>inventory.playerId===ids[2])!.cards[0];
  expect(earned.kind).toBe('DOUBLE_DOWN');conserved();

  // Two different contests share the same immutable six-round social interval.
  table.advance(4000);
  await pages[1].getByRole('button',{name:'Open Overthrow Ballot',exact:true}).click();
  for(const page of pages.slice(0,3))await page.getByRole('button',{name:'Vote Yes',exact:true}).click();
  await pages[3].getByRole('combobox',{name:'Last Stand game',exact:true}).selectOption('COIN');
  await pages[3].getByRole('button',{name:'Begin Last Stand',exact:true}).click();
  await expect(pages[0].locator('.duel-summary')).toContainText('Drew retains the House crown');
  const social=table.view(code).party!.social!,intervalId=social.id,hardDeadline=social.hardDeadline;
  table.advance(2000);
  await expect(pages[2].getByLabel('Social interval budget')).toContainText('Contest slot 2 / 2');
  expect(table.view(code).party!.social).toMatchObject({id:intervalId,hardDeadline,slot:2});
  await pages[2].getByRole('combobox',{name:'Deal partner',exact:true}).selectOption(ids[3]);
  await pages[2].getByRole('button',{name:'Deal contribution 50 chips',exact:true}).click();
  await pages[2].getByRole('button',{name:'Offer Split or Steal',exact:false}).click();
  await pages[3].getByRole('button',{name:'Accept Deal',exact:true}).click();
  await pages[2].getByRole('button',{name:'Lock Steal',exact:true}).click();
  expect(table.server.manager.snapshot(ids[3])!.party!.social!.deal!.choices).toBeUndefined();
  await pages[3].getByRole('button',{name:'Lock Steal',exact:true}).click();
  await expect(pages[0].locator('.deal-reveal')).toContainText('The full 100-chip pot enters the Vault');
  expect(table.view(code).party!.vault).toBe(200);
  expect(table.view(code).players.map(p=>p.balance)).toEqual([1250,1200,900,600]);conserved();

  table.advance(2000);
  await expect(pages[2].getByRole('heading',{name:'Place your bets',exact:true})).toBeVisible();
  expect(table.view(code).round).toBe(2);
  await pages[2].getByRole('button',{name:'Place Bet',exact:false}).click();
  await pages[2].getByLabel('Double Down Chaos card',{exact:true}).locator(':scope > summary').click();
  await pages[2].getByRole('button',{name:'Play Double Down Chaos',exact:true}).click();
  expect(table.view(code).players[2]).toMatchObject({wager:200,reserved:200});
  expect(table.view(code).party!.chaos.inventories.find(inventory=>inventory.playerId===ids[2])!.cards.some(card=>card.id===earned.id)).toBe(false);
  table.server.manager.e.shoe=()=>scriptedShoe(['A','10','K','7']);
  table.advance(21000);
  await pages[3].getByRole('button',{name:'Dealer Stand',exact:true}).click();
  await expect(pages[2].getByLabel('Round payouts')).toContainText('500 returned');
  expect(table.view(code).players.map(p=>p.balance)).toEqual([1250,1200,1200,600]);conserved();

  // Later rounds are deliberately sat out: no invented bankrolls or injected cards.
  table.server.manager.e.shoe=()=>scriptedShoe(['10','10','10','10','9','8','7','6','10']);
  const rounds=new Set<number>([1,2]);
  for(let step=0;step<40&&table.view(code).phase!=='SHADOW_DRAW';step++){
    const state=table.view(code);rounds.add(state.round);expect(state.deadline).not.toBeNull();table.advance(state.deadline!-state.serverTime);conserved();
  }
  expect([...rounds].sort()).toEqual([1,2,3,4,5,6]);
  expect(table.view(code)).toMatchObject({phase:'SHADOW_DRAW',round:6});
  expect(table.view(code).party!.shadow!.pot).toBe(200);
  await pages[0].getByRole('button',{name:'Take Shadow Draw',exact:true}).click();
  for(const page of pages.slice(1))await page.getByRole('button',{name:'Stand and Lock',exact:true}).click();
  await expect(pages[0].getByLabel('Shadow hand for Alex',{exact:true})).toContainText('Real total 29 · bust');
  for(const viewer of ids.slice(1)){const entry=table.server.manager.snapshot(viewer)!.party!.shadow!.entrants[0];expect(entry.hand).toEqual([null,null,null]);expect(entry.value).toBeNull();expect(entry).not.toHaveProperty('disqualified');}
  await pages[0].getByRole('combobox',{name:'Declared total',exact:true}).selectOption('21');
  await pages[0].getByRole('button',{name:'Declare 21',exact:true}).click();
  await expect(pages[1].getByLabel('Open Shadow claim')).toContainText('Alex declares 21');
  expect(table.server.manager.snapshot(ids[1])!.party!.shadow!.claim).not.toHaveProperty('truthful');
  table.advance(8000);
  for(const page of pages.slice(1))await page.getByRole('button',{name:'Pass Declaration',exact:true}).click();
  expect(table.view(code).party!.shadow).toMatchObject({winnerIds:[ids[0]],awards:[{playerId:ids[0],amount:200}],vaultThiefIds:[ids[0]]});conserved();
  table.advance(2000);
  await expect(pages[0].getByRole('button',{name:'Return to Lobby',exact:false})).toBeVisible();
  const final=table.view(code);
  expect(final.phase).toBe('RESULTS');expect(final.results!.winners).toEqual([ids[0]]);
  expect(final.players.map(p=>p.balance)).toEqual([1450,1200,1200,600]);
  expect(final.results!.standings.map(p=>p.id)).toEqual([ids[0],ids[1],ids[2],ids[3]]);
  expect(room().dealerNet).toBe(450);
  expect(final.party!.bank.balance).toBe(7550);
  expect(final.players.reduce((sum,p)=>sum+p.balance,0)).toBe(4450);
  expect(final.party).toMatchObject({vault:0,bonusReserve:400});
  expect(final.party!.dealHistory).toHaveLength(1);expect(final.party!.duelHistory).toHaveLength(1);
  expect(final.players.every(p=>p.committed===0&&p.reserved===0)).toBe(true);conserved();
  await pages[0].reload();await expect(pages[0].locator('.shadow-settlement')).toContainText('+200 chips');
  expect(table.view(code).players.map(p=>p.balance)).toEqual(final.players.map(p=>p.balance));
  await pages[0].getByRole('button',{name:'Return to Lobby',exact:false}).click();
  expect(table.view(code)).toMatchObject({phase:'LOBBY',roundLimit:6,finaleEnabled:true,party:null,pendingClaims:[],claimOutcomes:[]});
  expect(table.view(code).players.every(p=>p.balance===1000)).toBe(true);
  for(const page of pages)await page.getByRole('button',{name:'Ready Up',exact:true}).click();
  await pages[0].getByRole('button',{name:'Start Game',exact:true}).click();
  await expect(pages[0].getByRole('heading',{name:'Bid for the House',exact:true})).toBeVisible();
  expect(table.view(code).matchId).not.toBe(matchId);expect(table.view(code).party!.vault).toBe(0);
  expect(table.view(code).party!.chaos.inventories.every(inventory=>inventory.cards.length===0)).toBe(true);conserved();
  expect(failures).toEqual([]);
});
