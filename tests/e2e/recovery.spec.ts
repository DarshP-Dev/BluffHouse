import {test,expect,readyAndStart,type TableFixture} from '../fixtures/browser.js';
import {createApp} from '../../apps/server/src/app.js';
import type {Ack,Command} from '@bluff-house/shared';

async function playing(table:TableFixture){
  const pages=await Promise.all([table.newPlayer(),table.newPlayer(),table.newPlayer(),table.newPlayer()]);
  const code=await table.host(pages[0]);for(let i=1;i<4;i++)await table.join(pages[i],code,['','Blair','Casey','Drew'][i]);
  await readyAndStart(pages);for(const page of pages)await page.getByRole('button',{name:'Place Bet'}).click();
  await expect.poll(()=>table.view(code).players.every(p=>p.reserved===100)).toBe(true);table.advance(21000);
  await expect(pages[0].getByRole('button',{name:/^Hit/})).toBeEnabled();return {pages,code};
}

test('refresh restores the existing turn and accepted reveal, then second tab takes control',async({table})=>{
  const {pages,code}=await playing(table),host=pages[0];const before=table.view(code),id=before.viewerId;
  table.advance(3000);await host.reload();await expect(host.getByRole('button',{name:/^Hit/})).toBeEnabled();
  expect(table.view(code).players[0].id).toBe(id);expect(table.view(code).players[0].hand).toEqual(before.players[0].hand);
  expect(table.view(code).deadline).toBe(before.deadline);expect(table.view(code).players[0].balance).toBe(900);
  await host.getByRole('button',{name:/^Call My Bluff/}).click();await pages[1].getByRole('button',{name:/^Accept Challenge/}).click();
  await expect.poll(()=>table.view(code).phase).toBe('BLUFF_REVEAL');const reveal=table.view(code);
  await host.reload();await expect(host.locator('.bluff-event')).toContainText('Alex takes the pot');
  expect(table.view(code).bluff).toEqual(reveal.bluff);expect(table.view(code).players.map(p=>p.balance)).toEqual([1000,800,900,900]);expect(table.view(code).players[0].hand).toHaveLength(3);
  const replacement=await host.context().newPage();await replacement.goto(table.url);
  await expect(host.getByRole('heading',{name:'Your seat moved tabs.'})).toBeVisible();await expect(replacement.locator('.bluff-event')).toContainText('Alex takes the pot');
  await host.close();expect(table.view(code).players[0].connected).toBe(true);expect(table.view(code).players).toHaveLength(4);
  table.advance(2000);await expect(replacement.getByRole('button',{name:/^Stand/})).toBeEnabled();await replacement.getByRole('button',{name:/^Stand/}).click();
  await expect(pages[1].getByRole('button',{name:/^Stand/})).toBeEnabled();
});

test('lost acknowledgement and broadcast recover by snapshot without replaying a hit',async({table})=>{
  const {pages,code}=await playing(table),id=table.view(code).viewerId;
  const serverSocket=[...table.server.io.sockets.sockets.values()].find(s=>s.data.guest.id===id)!;
  const processCommand=serverSocket.listeners('command')[0]!;serverSocket.removeAllListeners('command');
  const originalEmit=serverSocket.emit.bind(serverSocket);let drop=false,hits=0,syncs=0;
  serverSocket.emit=((event:string,...args:unknown[])=>{if(event==='room:state'&&drop)return false;return originalEmit(event,...args);}) as typeof serverSocket.emit;
  serverSocket.on('command',(command:Command,ack:(result:Ack)=>void)=>{
    if(command.type==='turn:hit'){hits++;drop=true;processCommand(command,()=>{});}
    else {if(command.type==='state:sync'){syncs++;drop=false;}processCommand(command,ack);}
  });
  await pages[0].getByRole('button',{name:/^Hit/}).click();await expect(pages[0].getByText('Confirming your action…',{exact:true})).toBeVisible();
  await expect(pages[0].getByRole('button',{name:/^Stand/})).toBeEnabled({timeout:10000});
  expect(hits).toBe(1);expect(syncs).toBe(1);expect(table.view(code).players[0].hand).toHaveLength(3);
  await expect(pages[0].getByRole('article',{name:'Alex, you, active turn'}).locator('.hand-total')).toContainText('19');
});

test('former host reconnects after transfer without taking host authority back',async({table})=>{
  const {pages,code}=await playing(table),id=table.view(code).viewerId;
  await pages[0].goto('about:blank');await expect.poll(()=>table.view(code).players[0].connected).toBe(false);
  table.advance(59999);expect(table.view(code).hostId).toBe(id);table.advance(1);const newHost=table.view(code).players[1].id;expect(table.view(code).hostId).toBe(newHost);
  await pages[0].goto(table.url);await expect(pages[0].getByRole('heading',{name:'Player turns',exact:true})).toBeVisible();
  expect(table.view(code).hostId).toBe(newHost);expect(table.view(code).players[0]).toMatchObject({id,connected:true,balance:900});
  const roomId=table.view(code).instanceId;
  await pages[0].getByRole('button',{name:/Leave Room/}).click();await pages[0].getByRole('button',{name:'Leave Match',exact:true}).click();
  await expect(pages[0].getByRole('button',{name:'Host Room'})).toBeVisible();expect(table.server.manager.membership.has(id)).toBe(false);
  table.advance(25000);expect(table.server.manager.rooms.get(roomId)?.players[0].departed).toBe(true);
});

test('backend restart reports lost state and waits for explicit new room entry',async({table})=>{
  const page=await table.newPlayer();await table.host(page);const oldInstance=table.server.instanceId;
  await table.server.close();const fresh=createApp({origin:table.url});await fresh.listen(4175);
  try{
    await page.reload();await expect(page.getByRole('heading',{name:'This table has closed.'})).toBeVisible();
    expect(fresh.instanceId).not.toBe(oldInstance);expect(fresh.manager.rooms.size).toBe(0);expect(fresh.manager.membership.size).toBe(0);
    await page.getByRole('button',{name:'Return to Menu'}).click();expect(fresh.manager.rooms.size).toBe(0);
    await table.host(page,'Fresh Host');expect(fresh.manager.rooms.size).toBe(1);
    expect([...fresh.manager.rooms.values()][0].players[0].account.balance).toBe(1000);
  }finally{await fresh.close();}
});

test('offline controls do not queue moves and recovery retains the original turn clock',async({table})=>{
  const {pages,code}=await playing(table),host=pages[0],before=table.view(code);
  await host.getByRole('button',{name:/^Hit/}).focus();await host.context().setOffline(true);
  const serverSocket=[...table.server.io.sockets.sockets.values()].find(s=>s.data.guest.id===before.viewerId)!;serverSocket.conn.close();
  await expect(host.getByRole('heading',{name:'Reconnecting to Bluff House…'})).toBeVisible();
  await expect(host.getByRole('button',{name:/^Hit/})).toBeDisabled();await host.keyboard.press('Enter');
  table.advance(5000);await host.context().setOffline(false);
  await expect(host.getByRole('button',{name:/^Hit/})).toBeEnabled({timeout:10000});
  expect(table.view(code).deadline).toBe(before.deadline);expect(table.view(code).players[0].hand).toEqual(before.players[0].hand);
  expect(table.view(code).players[0].balance).toBe(900);
});

test('keyboard entry and reduced-motion mobile controls remain usable',async({table})=>{
  const page=await table.newPlayer();await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});
  await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to game'})).toBeFocused();
  expect(await page.getByRole('link',{name:'Skip to game'}).evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await page.getByRole('button',{name:'Host Room'}).focus();await page.keyboard.press('Enter');await page.getByLabel('Guest name').fill('Keyboard Guest');
  await page.getByRole('button',{name:'Create Room'}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Your table',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Ready Up'}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Cancel Ready'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.getByRole('button',{name:'Cancel Ready'}).evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(.001);
});
