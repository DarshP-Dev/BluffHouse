import {test,expect} from '../fixtures/browser.js';

test('four isolated guests share a real lobby; only ready host starts',async({table})=>{
  const pages=await Promise.all([table.newPlayer(),table.newPlayer(),table.newPlayer(),table.newPlayer()]);
  const code=await table.host(pages[0]);for(let i=1;i<4;i++)await table.join(pages[i],code,['','Blair','Casey','Drew'][i]);
  for(const page of pages){await expect(page.getByText('4 / 6 connected')).toBeVisible();await expect(page.locator('.guest-info strong').filter({hasText:'Blair'})).toBeVisible();}
  await expect(pages[0].getByRole('button',{name:'Start Game'})).toBeDisabled();await expect(pages[1].getByRole('button',{name:'Start Game'})).toHaveCount(0);
  const cookies=await pages[0].context().cookies();expect(cookies.find(c=>c.name==='bh_session')?.httpOnly).toBe(true);expect(await pages[0].evaluate(()=>document.cookie)).not.toContain('bh_session');
  await pages[0].screenshot({path:'test-results/lobby.png',fullPage:true});
});
test('invalid room code produces a real error and stays at entry',async({table})=>{
  const p=await table.newPlayer();await p.getByRole('button',{name:'Join Room'}).click();await p.getByLabel('Guest name').fill('Blair');await p.getByLabel('Room code',{exact:true}).fill('ZZZZZZ');await p.getByRole('dialog').getByRole('button',{name:'Join Room'}).click();await expect(p.getByRole('alert')).toContainText('unavailable');
});
