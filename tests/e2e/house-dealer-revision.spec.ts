import {test,expect,scriptedShoe,type TableFixture} from '../fixtures/browser.js';
import type {Page} from '@playwright/test';

async function houseTable(table:TableFixture,count=4,rounds=2){
  const pages=await Promise.all(Array.from({length:count},()=>table.newPlayer()));
  const code=await table.host(pages[0]);
  for(let i=1;i<count;i++)await table.join(pages[i],code,['','Blair','Casey','Drew'][i]);
  await pages[0].getByRole('button',{name:'Party',exact:true}).click();
  const finale=pages[0].getByRole('checkbox',{name:/^Shadow/});
  if(await finale.isChecked()){await finale.click();await expect(finale).not.toBeChecked();}
  await pages[0].getByLabel('Blackjack rounds',{exact:true}).fill(String(rounds));
  for(const label of ['House overthrow','Direct duels','Bounties','Chaos cards','Split or Steal deals','Additional bluff claims']){
    const input=pages[0].getByRole('checkbox',{name:label,exact:true});
    if(await input.isChecked()){await input.click();await expect(input).not.toBeChecked();}
  }
  await pages[0].getByRole('button',{name:'Apply Room Settings',exact:true}).click();
  await expect.poll(()=>table.view(code).roundLimit).toBe(rounds);
  for(const page of pages)await page.getByRole('button',{name:'Ready Up',exact:true}).click();
  await pages[0].getByRole('button',{name:'Start Game',exact:true}).click();
  return {pages,code};
}
async function buyHouse(table:TableFixture,pages:Page[],amount:number){
  await pages[0].getByRole('button',{name:`House bid ${amount} chips`,exact:true}).click();
  await pages[0].getByRole('button',{name:/^Submit House Bid/}).click();
  for(const page of pages.slice(1))await page.getByRole('button',{name:'Pass Auction',exact:true}).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading',{name:'Place your bets',exact:true})).toBeVisible();
}

test('a900 bid leaves a real dealer who covers simultaneous All-In naturals from a finite Bank and rejects later excessive exposure',async({table})=>{
  const {pages,code}=await houseTable(table);
  const failures:string[]=[];for(const page of pages)page.on('pageerror',error=>failures.push(error.message));
  await buyHouse(table,pages,900);
  let view=table.view(code);
  expect(view.players[0]).toMatchObject({balance:100,reserved:100,available:0,wager:0});
  expect(view.party!.bank).toMatchObject({initial:8000,balance:8000,bond:{ownerId:view.players[0].id,amount:100}});
  await expect(pages[0].getByRole('button',{name:/^Place Bet/})).toHaveCount(0);
  await expect(pages[0].getByRole('region',{name:'Dealer bankroll',exact:true})).toHaveCount(0);
  table.server.manager.e.shoe=()=>scriptedShoe(['A','A','A','10','K','K','K','6','5']);
  for(const page of pages.slice(1)){
    await page.getByRole('button',{name:'All-In',exact:true}).click();
    await page.getByRole('button',{name:/^Place Bet/}).click();
  }
  expect(table.view(code).party!.bank.committed).toBe(4500);
  table.advance(21000);
  await expect(pages[0].getByRole('button',{name:'Dealer Hit',exact:true})).toBeEnabled();
  expect(table.view(code).phase).toBe('DEALER_TURN');
  expect(table.view(code).players[0].hand).toEqual([]);
  expect(table.view(code).dealer.map(card=>card?.rank)).toEqual(['10','6']);
  for(const player of table.view(code).players.slice(1)){
    const snapshot=table.server.manager.snapshot(player.id)!;
    expect(snapshot.dealer[1]).toBeNull();expect(snapshot.dealerValue).toBeNull();
  }
  const dealerHand=pages[0].getByLabel('Dealer hand',{exact:true});
  await expect(dealerHand.getByLabel('6 of spades',{exact:true})).toBeVisible();
  for(const page of pages.slice(1))await expect(page.getByLabel('Dealer hand',{exact:true}).getByLabel('Face-down card',{exact:true})).toHaveCount(1);
  await pages[0].getByRole('button',{name:'Dealer Hit',exact:true}).click();
  await expect(pages[0].getByRole('heading',{name:'Round settled',exact:true})).toBeVisible();
  view=table.view(code);
  expect(view.players.map(player=>player.balance)).toEqual([0,2500,2500,2500]);
  expect(view.party!.bank).toMatchObject({balance:3600,committed:0,bond:{amount:0}});
  expect(view.party!.bank.rounds).toHaveLength(1);
  expect(view.party!.bank.rounds[0]).toMatchObject({net:-4500,bondLoss:100,bankLoss:4400,houseEarnings:0});
  expect(view.party!.vault).toBe(900);
  for(const page of pages)await expect(page.getByLabel('Dealer hand',{exact:true}).getByLabel('Face-down card',{exact:true})).toHaveCount(0);
  await pages[0].screenshot({path:'test-results/house-dealer-funded-settlement.png',fullPage:true});
  table.advance(4000);
  await expect(pages[1].getByRole('heading',{name:'Place your bets',exact:true})).toBeVisible();
  await pages[1].getByRole('button',{name:'All-In',exact:true}).click();
  await expect(pages[1].locator('#personal-pot-total')).toContainText('2,500');
  await expect(pages[1].getByRole('button',{name:/^Place Bet/})).toBeDisabled();
  expect(table.server.manager.snapshot(view.players[1].id)!.backedMaxBet).toBe(2400);
  await pages[1].getByRole('button',{name:'Half',exact:true}).click();
  await pages[1].getByRole('button',{name:/^Place Bet/}).click();
  expect(table.view(code).party!.bank.committed).toBe(1875);
  await pages[2].getByRole('button',{name:'Half',exact:true}).click();
  await expect(pages[2].getByRole('button',{name:/^Place Bet/})).toBeDisabled();
  expect(failures).toEqual([]);
});

test('the player dealer may stand to earn losing wagers and may legally hit a high hand at personal risk',async({table})=>{
  const {pages,code}=await houseTable(table,2,2);
  await buyHouse(table,pages,50);
  table.server.manager.e.shoe=()=>scriptedShoe(['10','10','6','10','6']);
  await pages[1].getByRole('button',{name:/^Place Bet/}).click();
  table.advance(21000);
  await pages[1].getByRole('button',{name:/^Stand/}).click();
  await expect(pages[0].getByRole('button',{name:'Dealer Stand',exact:true})).toBeEnabled();
  await pages[0].getByRole('button',{name:'Dealer Stand',exact:true}).click();
  expect(table.view(code).players.map(player=>player.balance)).toEqual([1000,900]);
  expect(table.view(code).party!.bank).toMatchObject({balance:4050,bond:{amount:250}});
  expect(table.view(code).party!.bank.rounds[0]).toMatchObject({net:100,houseEarnings:50,bankEarnings:50});
  table.advance(4000);
  table.server.manager.e.shoe=()=>scriptedShoe(['10','10','6','10','6']);
  await pages[1].getByRole('button',{name:/^Place Bet/}).click();
  table.advance(21000);
  await pages[1].getByRole('button',{name:/^Stand/}).click();
  await pages[0].getByRole('button',{name:'Dealer Hit',exact:true}).click();
  await expect(pages[0].getByRole('heading',{name:'Round settled',exact:true})).toBeVisible();
  expect(table.view(code).dealerValue).toMatchObject({total:26,bust:true});
  expect(table.view(code).players.map(player=>player.balance)).toEqual([900,1000]);
  expect(table.view(code).party!.bank).toMatchObject({balance:4050,bond:{amount:150}});
  expect(table.view(code).party!.bank.rounds[1]).toMatchObject({net:-100,bondLoss:100,bankLoss:0});
  table.advance(4000);
  await expect(pages[0].getByRole('button',{name:/^Return to Lobby/})).toBeVisible();
  await expect(pages[0].getByRole('region',{name:'Dealer bankroll',exact:true})).toBeVisible();
  expect(table.view(code).players.every(player=>player.reserved===0&&player.committed===0)).toBe(true);
  await pages[0].getByRole('button',{name:/^Return to Lobby/}).click();
  expect(table.view(code).party).toBeNull();
});

test('dealer disconnect automates legal17 policy and reconnect cannot duplicate a funded payout',async({table})=>{
  const {pages,code}=await houseTable(table,2,2);
  await buyHouse(table,pages,100);
  table.server.manager.e.shoe=()=>scriptedShoe(['10','10','6','6','6']);
  await pages[1].getByRole('button',{name:/^Place Bet/}).click();
  table.advance(21000);
  await pages[1].getByRole('button',{name:/^Stand/}).click();
  await expect(pages[0].getByRole('button',{name:'Dealer Hit',exact:true})).toBeEnabled();
  const houseId=table.view(code).players[0].id;
  await pages[0].context().setOffline(true);
  [...table.server.io.sockets.sockets.values()].find(socket=>socket.data.guest.id===houseId)!.conn.close();
  await expect(pages[0].getByRole('heading',{name:'Reconnecting to Bluff House…',exact:true})).toBeVisible();
  for(let step=0;step<8&&table.view(code).party!.bank.rounds.length===0;step++){
    const state=table.view(code);expect(state.deadline).not.toBeNull();
    table.advance(state.deadline!-state.serverTime);
  }
  await expect(pages[1].getByRole('heading',{name:'Round settled',exact:true})).toBeVisible();
  const settled=table.view(code);
  expect(settled.dealerValue).toMatchObject({bust:true,total:22});
  expect(settled.party!.bank.rounds).toHaveLength(1);
  await pages[0].context().setOffline(false);
  await expect(pages[0].locator('.connection-overlay')).toHaveCount(0);
  await expect(pages[0].getByRole('heading',{name:'Round settled',exact:true})).toBeVisible();
  expect(table.view(code).players.map(player=>player.balance)).toEqual(settled.players.map(player=>player.balance));
  expect(table.view(code).party!.bank.rounds).toEqual(settled.party!.bank.rounds);
});
