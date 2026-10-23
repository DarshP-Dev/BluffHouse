import {test,expect,readyAndStart,scriptedShoe} from '../fixtures/browser.js';

for(const bust of [false,true])test(`four guests complete three rounds with a ${bust?'busted':'surviving'} bluff and replay`,async({table})=>{
  table.server.manager.e.shoe=()=>scriptedShoe(['10','10','10','10','10','6','7','8','9','7',bust?'10':'3']);
  const pages=await Promise.all([table.newPlayer(),table.newPlayer(),table.newPlayer(),table.newPlayer()]);
  const errors:string[]=[];for(const page of pages)page.on('pageerror',error=>errors.push(error.message));
  const code=await table.host(pages[0]);
  for(let i=1;i<4;i++)await table.join(pages[i],code,['','Blair','Casey','Drew'][i]);
  await readyAndStart(pages);
  const firstMatch=table.view(code).matchId;
  for(let round=1;round<=3;round++){
    for(const page of pages)await page.getByRole('button',{name:'Place Bet'}).click();
    await expect.poll(()=>table.view(code).players.map(p=>p.reserved)).toEqual([100,100,100,100]);
    table.advance(21000);
    if(round===1){
      await pages[0].getByRole('button',{name:/^Call My Bluff/}).click();
      for(const page of pages)await expect(page.locator('.bluff-event')).toContainText('My next hit will not bust');
      expect(table.view(code).players[0]).toMatchObject({balance:900,reserved:100,available:800,committed:100});
      await pages[1].getByRole('button',{name:'Accept Challenge',exact:false}).click();
      await expect.poll(()=>table.view(code).phase).toBe('BLUFF_REVEAL');
      const reveal=table.view(code),winner=bust?'Blair':'Alex';
      expect(reveal.players.map(p=>p.balance)).toEqual(bust?[800,1000,900,900]:[1000,800,900,900]);
      expect(reveal.players[0].hand).toHaveLength(3);expect(reveal.bluff?.pot).toBe(200);
      for(const page of pages){await expect(page.locator('.bluff-event')).toContainText(winner);await expect(page.locator('.bluff-event')).toContainText('200');}
      // Deliver an obsolete snapshot followed by an ordered event barrier. It must
      // not bring back betting controls or replace the authoritative reveal.
      for(const socket of table.server.io.sockets.sockets.values()){
        const current=table.server.manager.snapshot(socket.data.guest.id)!;
        socket.emit('room:state',{...current,revision:current.revision-1,phase:'BETTING',bluff:null});
        const event={id:'stale-snapshot-barrier',kind:'reaction',text:'Observer 👀',at:current.serverTime,revision:current.revision};
        socket.emit('room:reaction',{roomInstanceId:current.instanceId,event});
        socket.emit('room:reaction',{roomInstanceId:current.instanceId,event});
      }
      for(const page of pages){await expect(page.getByText('Observer 👀',{exact:true})).toHaveCount(1);await expect(page.locator('.bluff-event')).toContainText(winner);await expect(page.getByRole('button',{name:'Place Bet'})).toHaveCount(0);}
      await pages[0].setViewportSize({width:390,height:844});
      expect(await pages[0].evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await pages[0].screenshot({path:`test-results/bluff-${bust?'bust':'safe'}-mobile.png`,fullPage:true});
      await pages[0].setViewportSize({width:1440,height:1000});
      table.advance(2000);
    }
    for(let i=(round===1&&bust?1:0);i<4;i++){
      await expect(pages[i].getByRole('button',{name:'Stand',exact:false})).toBeEnabled();
      await pages[i].getByRole('button',{name:'Stand',exact:false}).click();
    }
    table.advance(350);
    for(const page of pages)await expect(page.getByRole('heading',{name:'Round settled'})).toBeVisible();
    const balances=table.view(code).players.map(p=>p.balance);
    expect(balances).toEqual(bust?[900-round*100,1100,1000+round*100,1000+round*100]:[1300-round*100,900,1000+round*100,1000+round*100]);
    table.advance(4000);
  }
  const final=table.view(code);expect(final.phase).toBe('RESULTS');expect(final.results?.winners).toHaveLength(2);
  for(const page of pages){await expect(page.getByRole('heading',{name:/Casey.*Drew.*share the crown/})).toBeVisible();await expect(page.locator('.biggest-bluff')).toContainText('200');}
  await pages[0].screenshot({path:`test-results/results-${bust?'bust':'safe'}.png`,fullPage:true});
  await pages[2].getByRole('button',{name:'Return to Lobby'}).click();
  for(const page of pages){await expect(page.getByRole('heading',{name:'Your table',exact:true})).toBeVisible();await expect(page.locator('.room-code strong')).toHaveText(code);}
  expect(table.view(code).players.every(p=>p.balance===1000&&!p.ready&&p.bluffWins===0&&p.bluffLosses===0)).toBe(true);
  await readyAndStart(pages);expect(table.view(code).matchId).not.toBe(firstMatch);expect(errors).toEqual([]);
});
