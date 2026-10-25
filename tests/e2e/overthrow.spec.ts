import { test, expect, scriptedShoe, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';

async function partyWithHouse(table: TableFixture) {
  const pages = await Promise.all([table.newPlayer(), table.newPlayer(), table.newPlayer(), table.newPlayer()]);
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  await pages[0].getByRole('checkbox', { name: 'Shadow Draw finale', exact: true }).click();
  await expect(pages[0].getByRole('checkbox', { name: 'Shadow Draw finale', exact: true })).not.toBeChecked();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  await pages[0].getByRole('button', { name: 'House bid 50 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Submit House Bid', exact: false }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  await expect(pages[1].getByRole('button', { name: 'Open Overthrow Ballot' })).toHaveCount(0);
  table.advance(24000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  return { pages, code };
}

async function passBallot(pages: Page[]) {
  await expect(pages[0].getByRole('button', { name: 'Open Overthrow Ballot' })).toHaveCount(0);
  await pages[1].getByRole('button', { name: 'Open Overthrow Ballot' }).click();
  await expect(pages[1].getByLabel('House overthrow')).toContainText('0 / 3 yes votes required');
  await expect(pages[0].getByRole('button', { name: 'Vote Yes' })).toHaveCount(0);
  for (const page of pages.slice(1)) await page.getByRole('button', { name: 'Vote Yes' }).click();
  for (const page of pages) await expect(page.getByRole('heading', { name: "House's Last Stand", exact: true })).toBeVisible();
  await expect(pages[1].getByRole('button', { name: 'Begin Last Stand' })).toHaveCount(0);
}

test('a real Last Stand transfers only the House crown and next round commissions follow the new House', async ({ table }) => {
  table.server.manager.e.randomIndex = () => 0;
  const { pages, code } = await partyWithHouse(table);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  const [alex, blair] = table.view(code).players;
  await passBallot(pages);
  await pages[0].reload();
  await expect(pages[0].getByRole('button', { name: 'Begin Last Stand' })).toBeVisible();
  await pages[0].getByRole('button', { name: 'Begin Last Stand' }).click();
  for (const page of pages) {
    await expect(page.getByLabel('Party duel')).toContainText('House crown at stake');
    await expect(page.getByLabel('Party duel')).not.toContainText('0 chip pot');
  }
  expect(table.view(code).players.map(player => player.committed)).toEqual([0, 0, 0, 0]);
  for (let n = 1; n <= 3; n++) {
    await expect(pages[0].getByLabel('Party duel')).toContainText(`Throw ${n} of 5`);
    await pages[0].getByRole('button', { name: 'Scissors', exact: true }).click();
    await pages[1].getByRole('button', { name: 'Rock', exact: true }).click();
  }
  for (const page of pages) {
    await expect(page.locator('.duel-summary')).toContainText('Blair takes the House crown.');
    await expect(page.getByLabel('Party funds')).toContainText('Blair');
    await expect(page.locator('.duel-summary')).toContainText('No chips moved. The room host is unchanged.');
  }
  expect(table.view(code).party!.houseId).toBe(blair.id);
  expect(table.view(code).hostId).toBe(alex.id);
  expect(table.view(code).players.map(player => player.balance)).toEqual([950, 1000, 1000, 1000]);
  await pages[2].setViewportSize({ width: 390, height: 844 });
  expect(await pages[2].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[2].screenshot({ path: 'test-results/overthrow-crown-mobile.png', fullPage: true });
  table.server.manager.e.shoe = () => scriptedShoe(['A', '10', 'K', '7']);
  table.advance(2000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  await pages[0].getByRole('button', { name: 'Place Bet', exact: false }).click();
  table.advance(21350);
  await expect(pages[0].getByLabel('Round payouts')).toContainText('+4 bank-funded commission to Blair');
  expect(table.view(code).players.slice(0, 2).map(player => player.balance)).toEqual([1100, 1004]);
  table.advance(4000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  table.advance(20000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect(pages[0].getByLabel('House role history')).toContainText('Blair took the crown');
  expect(table.view(code).party!.overthrowHistory).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('a timed-out House choice forfeits the crown without showing fresh invitations', async ({ table }) => {
  table.server.manager.e.randomIndex = () => 0;
  const { pages, code } = await partyWithHouse(table);
  const challengerId = table.view(code).players[1].id;
  await passBallot(pages);
  table.advance(8000);
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Duel settled', exact: true })).toBeVisible();
    await expect(page.getByLabel('House overthrow')).toContainText('Blair takes the House crown.');
    await expect(page.getByRole('button', { name: 'Send Duel Invite', exact: false })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Begin Last Stand' })).toHaveCount(0);
  }
  expect(table.view(code).party!.houseId).toBe(challengerId);
  expect(table.view(code).players.map(player => player.balance)).toEqual([950, 1000, 1000, 1000]);
  table.advance(2000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
});

test('failed ballot keeps the original admission clock and each voter gets one choice', async ({ table }) => {
  const { pages, code } = await partyWithHouse(table);
  const admission = table.view(code).party!.social!.admissionDeadline;
  await pages[1].getByRole('button', { name: 'Open Overthrow Ballot' }).click();
  await pages[1].getByRole('button', { name: 'Vote No' }).click();
  await expect(pages[1].getByRole('button', { name: 'Vote Yes' })).toHaveCount(0);
  await pages[2].getByRole('button', { name: 'Vote Yes' }).click();
  table.advance(10000);
  await expect(pages[0].getByLabel('House overthrow')).toContainText('The overthrow ballot failed.');
  await expect(pages[1].getByRole('button', { name: 'Open Overthrow Ballot' })).toHaveCount(0);
  await expect(pages[1].getByRole('button', { name: 'Send Duel Invite', exact: false })).toBeVisible();
  expect(table.view(code).party!.social!.admissionDeadline).toBe(admission);
  table.advance(10000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
});
