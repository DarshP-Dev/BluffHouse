import { test, expect, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';

async function party(table: TableFixture, rounds: 3 | 6 = 6, house = false) {
  table.server.manager.e.randomIndex = () => 0;
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  if (rounds === 6) await pages[0].getByRole('button', { name: '6 rounds', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  if (house) {
    await pages[0].getByRole('button', { name: 'House bid 50 chips', exact: true }).click();
    await pages[0].getByRole('button', { name: 'Submit House Bid', exact: false }).click();
  }
  for (const page of house ? pages.slice(1) : pages) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  return { pages, code };
}
async function offer(page: Page, defenderId: string, amount: number) {
  await page.getByRole('combobox', { name: 'Deal partner', exact: true }).selectOption(defenderId);
  await page.getByRole('button', { name: `Deal contribution ${amount} chips`, exact: true }).click();
  await page.getByRole('button', { name: 'Offer Split or Steal', exact: false }).click();
}
async function accept(page: Page) {
  await expect(page.getByRole('region', { name: /^Deal offer from/ })).toContainText('Missing choices default to Steal');
  await page.getByRole('button', { name: 'Accept Deal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Split or Steal', exact: true })).toBeVisible();
}
async function lock(page: Page, choice: 'Split' | 'Steal') {
  await page.getByRole('button', { name: `Lock ${choice}`, exact: true }).click();
}
async function nextSlot(table: TableFixture, page: Page) {
  table.advance(2000);
  await expect(page.getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
}
async function nextInterval(table: TableFixture, page: Page) {
  table.advance(2000);
  await expect(page.getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect(page.getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
}

test('four guests fund all four deal outcomes, keep locks private through refresh and settle actual reserve and Vault balances', async ({ table }) => {
  const { pages, code } = await party(table);
  const ids = table.view(code).players.map(player => player.id);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  await offer(pages[0], ids[1], 100);
  await expect(pages[0].locator('.deal-outgoing')).toContainText('100 chips reserved');
  expect(table.view(code).players[0]).toMatchObject({ balance: 1000, reserved: 100, available: 900 });
  await pages[2].getByRole('combobox', { name: 'Challenge a friend', exact: true }).selectOption(ids[3]);
  await pages[2].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  await accept(pages[1]);
  expect(table.view(code).party!.social!.invites[0].status).toBe('cancelled');
  expect(table.view(code).players[2].reserved).toBe(0);
  expect(table.view(code).players.slice(0, 2).map(player => player.committed)).toEqual([100, 100]);
  await lock(pages[0], 'Split');
  for (const id of ids.slice(1)) {
    const snapshot = table.server.manager.snapshot(id)!.party!.social!.deal!;
    expect(snapshot.choices).toBeUndefined();
    expect(snapshot.ownChoice).toBeUndefined();
    expect(snapshot.lockedPlayerIds).toEqual([ids[0]]);
    expect(snapshot.returns).toEqual({});
  }
  for (const page of pages.slice(1)) {
    await expect(page.locator('.deal-private')).toHaveCount(0);
    await expect(page.getByLabel('Revealed deal choices')).toHaveCount(0);
    await expect(page.locator('.deal-locks')).toContainText('Alex: Choice locked');
  }
  await pages[0].reload();
  await expect(pages[0].locator('.deal-private')).toContainText('Your locked choice: split');
  await expect(pages[0].getByRole('button', { name: 'Lock Steal', exact: true })).toBeDisabled();
  await pages[1].setViewportSize({ width: 390, height: 844 });
  expect(await pages[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[1].getByRole('heading', { name: 'Split or Steal', exact: true }).click();
  await pages[1].screenshot({ path: 'test-results/deal-private-lock-mobile.png', fullPage: true });
  await lock(pages[1], 'Split');
  for (const page of pages) await expect(page.locator('.deal-reveal')).toContainText('Both split.');
  expect(table.view(code).players.map(player => player.balance)).toEqual([1010, 1010, 1000, 1000]);
  expect(table.view(code).party!.bonusReserve).toBe(380);
  expect(table.view(code).party!.dealHistory[0]).toMatchObject({ bonusEach: 10, returns: { [ids[0]]: 110, [ids[1]]: 110 } });
  await nextSlot(table, pages[0]);
  await pages[0].getByRole('combobox', { name: 'Deal partner', exact: true }).selectOption(ids[1]);
  await expect(pages[0].locator('.deal-offer-reason')).toContainText('already accepted a deal');
  await expect(pages[0].getByRole('button', { name: 'Offer Split or Steal', exact: false })).toBeDisabled();
  await offer(pages[2], ids[3], 150);
  await accept(pages[3]);
  await lock(pages[2], 'Steal');
  await lock(pages[3], 'Split');
  await expect(pages[0].locator('.deal-reveal')).toContainText('Casey steals the full 300-chip pot');
  expect(table.view(code).players.map(player => player.balance)).toEqual([1010, 1010, 1150, 850]);
  await nextInterval(table, pages[0]);
  await offer(pages[0], ids[2], 50);
  await accept(pages[2]);
  await lock(pages[0], 'Split');
  await lock(pages[2], 'Steal');
  await expect(pages[0].locator('.deal-reveal')).toContainText('Casey steals the full 100-chip pot');
  await nextSlot(table, pages[0]);
  await offer(pages[1], ids[3], 200);
  await accept(pages[3]);
  await lock(pages[1], 'Steal');
  await lock(pages[3], 'Steal');
  for (const page of pages) await expect(page.locator('.deal-reveal')).toContainText('Both steal. The full 400-chip pot enters the Vault');
  expect(table.view(code).players.map(player => player.balance)).toEqual([960, 810, 1200, 650]);
  expect(table.view(code).party!.vault).toBe(400);
  expect(table.view(code).party!.dealHistory).toHaveLength(4);
  await pages[2].getByRole('heading', { name: 'Deal revealed', exact: true }).click();
  await pages[2].screenshot({ path: 'test-results/deal-Vault-reveal.png', fullPage: true });
  table.advance(2000);
  for (let round = 3; round <= 6; round++) {
    await expect.poll(() => table.view(code).round).toBe(round);
    table.advance(24000);
    if (round < 6) table.advance(20000);
  }
  await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  expect(table.view(code).players.map(player => player.balance)).toEqual([1060, 910, 1300, 750]);
  expect(table.view(code).party!.bonusReserve).toBe(380);
  expect(table.view(code).players.every(player => player.reserved === 0 && player.committed === 0)).toBe(true);
  await expect(pages[0].getByLabel('Deal history and statistics')).toContainText('4 settled deals');
  await expect(pages[0].getByLabel('Deal statistics')).toContainText('+200 net chips');
  await pages[0].getByRole('button', { name: 'Return to Lobby', exact: false }).click();
  expect(table.view(code).party).toBeNull();
  expect(table.view(code).players.every(player => player.balance === 1000)).toBe(true);
  expect(errors).toEqual([]);
});

test('declined and expired offers release stakes, accepted disconnect keeps its lock and missing choices default to Steal', async ({ table }) => {
  const { pages, code } = await party(table, 3);
  const ids = table.view(code).players.map(player => player.id);
  await offer(pages[0], ids[1], 50);
  await pages[1].getByRole('button', { name: 'Decline Deal', exact: true }).click();
  expect(table.view(code).players[0].reserved).toBe(0);
  await offer(pages[0], ids[1], 100);
  table.advance(8000);
  await expect(pages[0].locator('.deal-outgoing')).toHaveCount(0);
  expect(table.view(code).players[0].reserved).toBe(0);
  await offer(pages[0], ids[1], 100);
  await accept(pages[1]);
  await lock(pages[0], 'Split');
  await pages[0].context().setOffline(true);
  table.advance(10000);
  await expect(pages[2].locator('.deal-reveal')).toContainText('Blair steals the full 200-chip pot');
  expect(table.view(code).party!.dealHistory[0]).toMatchObject({ choices: { [ids[0]]: 'SPLIT', [ids[1]]: 'STEAL' }, defaultedPlayerIds: [ids[1]] });
  await pages[0].context().setOffline(false);
  await pages[0].reload();
  await expect(pages[0].getByLabel('Revealed deal choices')).toContainText('steal (timeout default)');
  expect(table.view(code).players.slice(0, 2).map(player => player.balance)).toEqual([900, 1100]);
  await nextInterval(table, pages[0]);
  await offer(pages[2], ids[3], 150);
  await accept(pages[3]);
  table.advance(10000);
  for (const page of pages) await expect(page.locator('.deal-reveal')).toContainText('Both steal. The full 300-chip pot enters the Vault');
  expect(table.view(code).party!.dealHistory[1].defaultedPlayerIds).toEqual([ids[2], ids[3]]);
  expect(table.view(code).party!.vault).toBe(300);
  table.advance(2000);
  table.advance(24000);
  await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  expect(table.view(code).players.map(player => player.balance)).toEqual([975, 1175, 925, 925]);
  expect(table.view(code).party!.dealHistory).toHaveLength(2);
  expect(table.view(code).party!.bonusReserve).toBe(400);
});


test('a settled first-slot Last Stand releases second-slot deal and duel controls', async ({ table }) => {
  const { pages, code } = await party(table, 6, true);
  const ids = table.view(code).players.map(player => player.id);
  await pages[1].getByRole('button', { name: 'Open Overthrow Ballot', exact: true }).click();
  for (const page of pages.slice(1)) await page.getByRole('button', { name: 'Vote Yes', exact: true }).click();
  await expect(pages[0].getByRole('heading', { name: "House's Last Stand", exact: true })).toBeVisible();
  await pages[0].getByRole('combobox', { name: 'Last Stand game', exact: true }).selectOption('COIN');
  await pages[0].getByRole('button', { name: 'Begin Last Stand', exact: true }).click();
  await expect(pages[0].locator('.duel-summary')).toContainText('Alex retains the House crown');
  table.advance(2000);
  await expect(pages[1].getByLabel('Social interval budget')).toContainText('Contest slot 2 / 2');
  expect(table.view(code).party!.social!.ballot?.status).toBe('settled');
  await expect(pages[1].getByRole('button', { name: 'Send Duel Invite', exact: false })).toBeEnabled();
  await offer(pages[1], ids[2], 50);
  await accept(pages[2]);
  expect(table.view(code).party!.social!.duel).toBeNull();
  expect(table.view(code).party!.social!.deal).toMatchObject({ status: 'choosing', slot: 2 });
  await lock(pages[1], 'Split');
  await lock(pages[2], 'Split');
  await expect(pages[1].locator('.deal-reveal')).toContainText('Both split');
  expect(table.view(code).party!.dealHistory).toHaveLength(1);
  expect(table.view(code).party!.houseId).toBe(ids[0]);
  expect(table.view(code).players.map(player => player.balance)).toEqual([950, 1010, 1010, 1000]);
});
