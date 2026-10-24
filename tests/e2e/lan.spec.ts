import {test,expect,chromium} from '@playwright/test';
import {createApp} from '../../apps/server/src/app.js';

test('plain HTTP LAN-style origin can create, join, and recover authenticated rooms',async()=>{
  // A non-localhost origin reproduces browser security rules on a LAN without
  // relying on this machine's DHCP address or changing the Windows firewall.
  const url='http://bluffhouse.test:4176';
  const server=createApp({origin:url});await server.listen(4176);
  const handshakes:{origin?:string;referer?:string;site?:string;host?:string}[]=[];
  server.http.prependListener('request',req=>{if(req.url?.startsWith('/socket.io/'))handshakes.push({origin:req.headers.origin,referer:req.headers.referer,site:req.headers['sec-fetch-site'] as string|undefined,host:req.headers.host});});
  const browser=await chromium.launch({args:['--host-resolver-rules=MAP bluffhouse.test 127.0.0.1','--no-proxy-server']});
  try{
    const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
    const pages=await Promise.all(contexts.map(context=>context.newPage()));const errors:string[]=[];
    for(const page of pages){page.on('pageerror',e=>errors.push(e.message));await page.goto(url);expect(await page.evaluate(()=>isSecureContext)).toBe(false);}
    expect(await pages[0].evaluate(()=>typeof crypto.randomUUID)).toBe('undefined');
    await pages[0].getByRole('button',{name:'Host Room'}).click();await pages[0].getByLabel('Guest name').fill('LAN Host');
    await pages[0].getByRole('button',{name:'Create Room'}).click();
    try{await expect(pages[0].getByRole('heading',{name:'Your table',exact:true})).toBeVisible();}catch(error){console.error('Handshake metadata (no credentials)',handshakes);console.error('Browser errors',errors);throw error;}
    const code=(await pages[0].locator('.room-code strong').textContent())!;
    await pages[1].getByRole('button',{name:'Join Room',exact:false}).click();await pages[1].getByLabel('Guest name').fill('LAN Friend');await pages[1].getByLabel('Room code',{exact:true}).fill(code);await pages[1].getByRole('dialog').getByRole('button',{name:'Join Room'}).click();
    await expect(pages[1].getByRole('heading',{name:'Your table',exact:true})).toBeVisible();
    const room=Array.from(server.manager.rooms.values())[0],guestIds=room.players.map(p=>p.id);
    await pages[0].reload();await expect(pages[0].getByRole('heading',{name:'Your table',exact:true})).toBeVisible();
    expect(Array.from(server.manager.rooms.values())[0].players.map(p=>p.id)).toEqual(guestIds);
    for(const page of pages)await page.getByRole('button',{name:'Ready Up'}).click();await pages[0].getByRole('button',{name:'Start Game'}).click();
    for(const page of pages){await expect(page.getByRole('heading',{name:'Place your bets'})).toBeVisible();expect(await page.evaluate(()=>document.cookie)).not.toContain('bh_session');}
    const cookies=await contexts[0].cookies();expect(cookies.find(c=>c.name==='bh_session')).toMatchObject({httpOnly:true,sameSite:'Lax',secure:false});
    expect(errors).toEqual([]);
  }finally{await browser.close();await server.close();}
});
