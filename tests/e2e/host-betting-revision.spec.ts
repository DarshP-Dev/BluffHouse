import type {Page} from '@playwright/test';
import {test,expect,readyAndStart,scriptedShoe,type TableFixture} from '../fixtures/browser.js';

async function configure(page:Page,values:{rounds?:number;stack?:number;betting?:number;decision?:number}){
  if(values.rounds!==undefined)await page.getByLabel('Blackjack rounds',{exact:true}).fill(String(values.rounds));
  if(values.stack!==undefined)await page.getByLabel('Starting chips',{exact:true}).fill(String(values.stack));
  if(values.betting!==undefined)await page.getByLabel('Betting timer (seconds)',{exact:true}).fill(String(values.betting));
  if(values.decision!==undefined)await page.getByLabel('Decision timer (seconds)',{exact:true}).fill(String(values.decision));
  await page.getByRole('button',{name:'Apply Room Settings',exact:true}).click();
}
async function pot(page:Page,amount:number){await expect(page.locator('#personal-pot-total')).toHaveText(`${amount.toLocaleString('en-CA')} chips`);}
async function players(table:TableFixture,names:string[]){const pages=await Promise.all(names.map(()=>table.newPlayer()));const code=await table.host(pages[0],names[0]);for(let n=1;n<pages.length;n++)await table.join(pages[n],code,names[n]);return {pages,code};}

test('a personal betting pot mixes repeated chip denominations, removes and undoes chips, and funds precise shortcuts and edits',async({table})=>{
  const {pages,code}=await players(table,['Alex','Blair']);const [host,guest]=pages;
  await configure(host,{stack:1730});await expect.poll(()=>table.view(code).startingChips).toBe(1730);await readyAndStart(pages);
  const builder=host.getByRole('form',{name:'Build your Blackjack wager',exact:true});await pot(host,100);await builder.getByRole('button',{name:'Clear Pot',exact:true}).click();await pot(host,0);
  for(const chip of [1000,500,100,50,20,10,10])await builder.getByRole('button',{name:`Bet ${chip} chips`,exact:true}).click();
  await pot(host,1690);await expect(builder.getByRole('button',{name:'Remove one 10 chip',exact:true})).toContainText('×2');
  await builder.getByRole('button',{name:'Remove one 20 chip',exact:true}).click();await pot(host,1670);await builder.getByRole('button',{name:'Undo',exact:true}).click();await pot(host,1690);
  await builder.getByRole('button',{name:'Clear Pot',exact:true}).click();await pot(host,0);await builder.getByRole('button',{name:'Undo',exact:true}).click();await pot(host,1690);
  await builder.getByRole('button',{name:'Half',exact:true}).click();await pot(host,860);await builder.getByRole('button',{name:'Quarter',exact:true}).click();await pot(host,430);
  await builder.getByRole('button',{name:'All-In',exact:true}).click();await pot(host,1730);await expect(builder.getByRole('button',{name:'Bet 10 chips',exact:true})).toBeDisabled();
  await builder.getByRole('button',{name:/^Place Bet/}).click();await expect.poll(()=>table.view(code).players[0].reserved).toBe(1730);await expect(builder.getByRole('button',{name:/^Update Bet/})).toBeVisible();
  await builder.getByRole('button',{name:'Clear Pot',exact:true}).click();await builder.getByRole('button',{name:'Bet 100 chips',exact:true}).click();await builder.getByRole('button',{name:'Bet 20 chips',exact:true}).click();await pot(host,120);
  await builder.getByRole('button',{name:/^Update Bet/}).click();await expect.poll(()=>table.view(code).players[0]).toMatchObject({balance:1730,reserved:120,available:1610,wager:120});
  await host.reload();await expect(host.getByRole('heading',{name:'Place your bets',exact:true})).toBeVisible();await pot(host,120);await host.getByRole('button',{name:'Withdraw',exact:true}).click();await pot(host,0);
  await expect.poll(()=>table.view(code).players[0]).toMatchObject({balance:1730,reserved:0,available:1730,wager:0});await expect(host.getByRole('button',{name:/^Place Bet/})).toBeDisabled();
  await expect(guest.locator('.standing-row').filter({hasText:'Alex'})).toContainText('1,730');
});

test('host numeric controls reset readiness, survive refresh and replay, and drive real server deadlines',async({table})=>{
  const {pages,code}=await players(table,['Alex','Blair']);const [host,guest]=pages;
  await expect(guest.getByLabel('Blackjack rounds',{exact:true})).toBeDisabled();await expect(guest.getByRole('button',{name:'Apply Room Settings',exact:true})).toBeDisabled();
  for(const page of pages)await page.getByRole('button',{name:'Ready Up',exact:true}).click();const oldLobby=table.view(code).lobbyId;
  await configure(host,{rounds:2,stack:1730,betting:5,decision:7});await expect.poll(()=>table.view(code)).toMatchObject({roundLimit:2,startingChips:1730,bettingSeconds:5,turnSeconds:7});expect(table.view(code).lobbyId).not.toBe(oldLobby);
  for(const page of pages)await expect(page.getByRole('button',{name:'Ready Up',exact:true})).toBeVisible();expect(table.view(code).players.every(player=>!player.ready&&player.balance===1730)).toBe(true);
  await guest.reload();await expect(guest.getByRole('heading',{name:'Your table',exact:true})).toBeVisible();await expect(guest.getByLabel('Blackjack rounds',{exact:true})).toHaveValue('2');await expect(guest.getByLabel('Starting chips',{exact:true})).toHaveValue('1730');await expect(guest.getByLabel('Betting timer (seconds)',{exact:true})).toHaveValue('5');await expect(guest.getByLabel('Decision timer (seconds)',{exact:true})).toHaveValue('7');
  await readyAndStart(pages);expect(table.view(code).deadline!-table.view(code).serverTime).toBe(5000);for(const page of pages)await page.getByRole('button',{name:/^Place Bet/}).click();
  await expect.poll(()=>table.view(code).players.map(player=>player.reserved)).toEqual([100,100]);table.advance(6000);await expect(host.getByRole('button',{name:/^Stand/})).toBeEnabled();expect(table.view(code).deadline!-table.view(code).serverTime).toBe(7000);
  table.advance(6999);expect(table.view(code).activePlayerId).toBe(table.view(code).players[0].id);table.advance(1);await expect(guest.getByRole('button',{name:/^Stand/})).toBeEnabled();await guest.getByRole('button',{name:/^Stand/}).click();table.advance(700);await expect.poll(()=>table.view(code).phase).toBe('ROUND_RESULT');table.advance(4000);await expect(host.getByRole('heading',{name:'Place your bets',exact:true})).toBeVisible();expect(table.view(code).round).toBe(2);
  table.advance(9000);await expect(host.getByRole('button',{name:'Return to Lobby',exact:false})).toBeVisible();await host.getByRole('button',{name:'Return to Lobby',exact:false}).click();
  await expect(host.getByRole('heading',{name:'Your table',exact:true})).toBeVisible();await expect(host.getByLabel('Starting chips',{exact:true})).toHaveValue('1730');expect(table.view(code)).toMatchObject({roundLimit:2,startingChips:1730,bettingSeconds:5,turnSeconds:7});expect(table.view(code).players.every(player=>player.balance===1730)).toBe(true);
});

test('a host can remove a lobby guest, everyone readies again, and the removed guest sees the reason and can rejoin',async({table})=>{
  const {pages,code}=await players(table,['Alex','Blair','Casey']);const [host,guest,other]=pages;
  await expect(guest.getByRole('button',{name:'Kick Alex',exact:true})).toHaveCount(0);for(const page of pages)await page.getByRole('button',{name:'Ready Up',exact:true}).click();await expect(host.getByRole('button',{name:'Start Game',exact:true})).toBeEnabled();
  await host.getByRole('button',{name:'Kick Blair',exact:true}).click();await expect(guest.getByRole('button',{name:'Join Room',exact:true})).toBeVisible();await expect(guest.getByRole('alert')).toContainText('The host removed you from the lobby.');
  await expect(host.locator('.guest-info strong').filter({hasText:'Blair'})).toHaveCount(0);await expect(host.getByRole('button',{name:'Start Game',exact:true})).toBeDisabled();for(const page of [host,other])await expect(page.getByRole('button',{name:'Ready Up',exact:true})).toBeVisible();expect(table.view(code).players.map(player=>player.name)).toEqual(['Alex','Casey']);
  await table.join(guest,code,'Blair Again');await expect(host.locator('.guest-info strong').filter({hasText:'Blair Again'})).toBeVisible();expect(table.view(code).players).toHaveLength(3);
});

test('real two-round match winners retain table wins through refresh and a second same-room match',async({table})=>{
  table.server.manager.e.shoe=()=>scriptedShoe(['10','10','10','10','10','6','7','8']);const {pages,code}=await players(table,['Alex','Blair','Casey']);const [host]=pages;
  await configure(host,{rounds:2,betting:5,decision:5});await expect.poll(()=>table.view(code).roundLimit).toBe(2);
  for(let match=1;match<=2;match++){
    await readyAndStart(pages);
    for(let round=1;round<=2;round++){
      for(const page of pages)await page.getByRole('button',{name:/^Place Bet/}).click();await expect.poll(()=>table.view(code).players.map(player=>player.reserved)).toEqual([100,100,100]);table.advance(6000);
      for(const page of pages){await expect(page.getByRole('button',{name:/^Stand/})).toBeEnabled();await page.getByRole('button',{name:/^Stand/}).click();}
      table.advance(350);await expect.poll(()=>table.view(code).phase).toBe('ROUND_RESULT');table.advance(4000);
      if(round===1)await expect(host.getByRole('heading',{name:'Place your bets',exact:true})).toBeVisible();
    }
    await expect(host.getByRole('heading',{name:/Alex.*takes the crown/})).toBeVisible();expect(table.view(code).players.map(player=>player.lobbyWins)).toEqual([match,0,0]);await host.getByRole('button',{name:'Return to Lobby',exact:false}).click();
    for(const page of pages)await expect(page.getByRole('heading',{name:'Your table',exact:true})).toBeVisible();await expect(host.getByLabel('Alex table wins',{exact:true})).toHaveText(`${match} ${match===1?'win':'wins'}`);await host.reload();await expect(host.getByLabel('Alex table wins',{exact:true})).toHaveText(`${match} ${match===1?'win':'wins'}`);expect(table.view(code).players.every(player=>player.balance===1000&&!player.ready)).toBe(true);
  }
});
