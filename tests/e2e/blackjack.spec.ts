import {test,expect,readyAndStart} from '../fixtures/browser.js';

test('four browsers bet, edit, withdraw and settle the same authoritative round',async({table})=>{
  const pages=await Promise.all([table.newPlayer(),table.newPlayer(),table.newPlayer(),table.newPlayer()]);
  const code=await table.host(pages[0]);for(let i=1;i<4;i++)await table.join(pages[i],code,['','Blair','Casey','Drew'][i]);await readyAndStart(pages);
  await pages[0].getByRole('button',{name:'Clear Pot',exact:true}).click();await pages[0].getByRole('button',{name:'Bet 100 chips',exact:true}).click();await pages[0].getByRole('button',{name:'Bet 50 chips',exact:true}).click();await pages[0].getByRole('button',{name:'Place Bet'}).click();await expect(pages[0].getByRole('button',{name:'Update Bet'})).toBeVisible();
  await pages[0].getByRole('button',{name:'Withdraw'}).click();await expect(pages[0].getByRole('button',{name:'Place Bet'})).toBeVisible();await pages[0].getByRole('button',{name:'Bet 100 chips',exact:true}).click();
  for(const p of pages)await p.getByRole('button',{name:'Place Bet'}).click();
  await expect.poll(()=>table.view(code).players.map(p=>p.reserved)).toEqual([100,100,100,100]);table.advance(21000);
  await expect(pages[0].getByRole('button',{name:'Hit',exact:false})).toBeEnabled();for(const p of pages)await expect(p.getByLabel('Face-down card')).toHaveCount(1);
  await pages[0].getByRole('button',{name:'Hit',exact:false}).click();await expect.poll(()=>table.view(code).players[0].hand.length).toBe(3);
  for(const p of pages){await expect(p.getByRole('button',{name:'Stand',exact:false})).toBeEnabled();await p.getByRole('button',{name:'Stand',exact:false}).click();}
  table.advance(350);await expect.poll(()=>table.view(code).phase).toBe('ROUND_RESULT');
  expect(table.view(code).players.map(p=>p.balance)).toEqual([1100,1000,1100,1100]);
  for(const p of pages){await expect(p.getByRole('heading',{name:'Round settled'})).toBeVisible();await expect(p.getByLabel('Face-down card')).toHaveCount(0);await expect(p.locator('.standing-row').filter({hasText:'Alex'})).toContainText('1,100');}
  await pages[0].screenshot({path:'test-results/table.png',fullPage:true});
  await pages[0].setViewportSize({width:390,height:844});expect(await pages[0].evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await pages[0].screenshot({path:'test-results/mobile.png',fullPage:true});
});
