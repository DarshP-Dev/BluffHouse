import {test as base,expect,type Page,type BrowserContext} from '@playwright/test';
import {createApp} from '../../apps/server/src/app.js';
import {makeShoe} from '../../apps/server/src/game/cards.js';
import type {Rank,RoomView} from '@bluff-house/shared';

export function scriptedShoe(ranks:Rank[]){const deck=makeShoe(()=>0);const first=ranks.map(rank=>{const i=deck.findIndex(c=>c.rank===rank);if(i<0)throw new Error('Fixture exhausted');return deck.splice(i,1)[0];});return first.concat(deck);}
export interface TableFixture {
  server:ReturnType<typeof createApp>;url:string;advance:(ms:number)=>void;
  newPlayer:()=>Promise<Page>;host:(page:Page,name?:string)=>Promise<string>;join:(page:Page,code:string,name:string)=>Promise<void>;
  view:(code:string)=>RoomView;contexts:BrowserContext[];
}
export const test=base.extend<{table:TableFixture}>({table:async({browser},use)=>{
  let now=Date.now();const url='http://localhost:4175';
  const server=createApp({origin:url,now:()=>now,shoe:()=>scriptedShoe(['10','10','10','10','10','6','7','8','9','7','3','10','2','4']),tickMs:100000});
  await server.listen(4175);const contexts:BrowserContext[]=[];
  const fixture:TableFixture={server,url,contexts,advance(ms){now+=ms;server.manager.reconcile();},async newPlayer(){const context=await browser.newContext();contexts.push(context);const page=await context.newPage();await page.goto(url);return page;},
    async host(page,name='Alex'){await page.getByRole('button',{name:'Host Room'}).click();await page.getByLabel('Guest name').fill(name);await page.getByRole('button',{name:'Create Room'}).click();await expect(page.getByRole('heading',{name:'Your table',exact:true})).toBeVisible();return (await page.locator('.room-code strong').textContent())!;},
    async join(page,code,name){await page.getByRole('button',{name:'Join Room',exact:false}).click();await page.getByLabel('Guest name').fill(name);await page.getByLabel('Room code',{exact:true}).fill(code);await page.getByRole('dialog').getByRole('button',{name:'Join Room'}).click();await expect(page.getByRole('heading',{name:'Your table',exact:true})).toBeVisible();},
    view(code){const id=server.manager.codes.get(code)!;const room=server.manager.rooms.get(id)!;return server.manager.snapshot(room.players[0].id)!;}
  };
  try{await use(fixture);}finally{for(const context of contexts)await context.close();await server.close();}
}});
export {expect};
/** Unrelated contest tests let the real finale's truthful timeout policy drain. */
export function finishShadowTimeouts(table:TableFixture,code:string){
  for(let step=0;step<24&&table.view(code).phase.startsWith('SHADOW_');step++){
    const view=table.view(code);if(view.deadline===null)throw new Error('Shadow has no authoritative deadline');
    table.advance(view.deadline-view.serverTime);
  }
}
export async function readyAndStart(pages:Page[]){for(const p of pages)await p.getByRole('button',{name:'Ready Up'}).click();await expect(pages[0].getByRole('button',{name:'Start Game'})).toBeEnabled();await pages[0].getByRole('button',{name:'Start Game'}).click();for(const p of pages)await expect(p.getByRole('heading',{name:'Place your bets'})).toBeVisible();}
