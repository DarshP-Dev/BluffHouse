import { test, expect, finishShadowTimeouts, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';

async function sixRoundParty(table: TableFixture) {
  table.server.manager.e.randomIndex = () => 0;
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  await pages[1].getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: '6 rounds', exact: true }).click();
  await expect(pages[1].getByRole('button', { name: 'Ready Up' })).toBeVisible();
  await expect(pages[1].getByRole('button', { name: '3 rounds', exact: true })).toBeDisabled();
  expect(table.view(code).roundLimit).toBe(6);
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  return { pages, code };
}
async function fund(page: Page, targetId: string, amount: number) {
  await page.getByRole('combobox', { name: 'Bounty target', exact: true }).selectOption(targetId);
  await page.getByRole('button', { name: `Bounty contribution ${amount} chips`, exact: true }).click();
  await page.getByRole('button', { name: 'Fund Bounty', exact: false }).click();
}
async function coinAccept(page: Page, side = 'HEADS') {
  await page.getByRole('combobox', { name: 'Duel game', exact: true }).selectOption('COIN');
  await page.getByRole('combobox', { name: 'Your coin side', exact: true }).selectOption(side);
  await page.getByRole('button', { name: 'Accept Duel', exact: true }).click();
}
async function nextRegular(table: TableFixture, page: Page, code: string) {
  table.advance(2000);
  if (table.view(code).phase === 'SOCIAL') table.advance(20000);
  await expect(page.getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
}

test('six-round Party pays three bounty defenses, allows two sequential contests and refunds unresolved owned escrow', async ({ table }) => {
  const { pages, code } = await sixRoundParty(table);
  const [alex, blair, casey, drew] = table.view(code).players;
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  await fund(pages[0], blair.id, 200);
  await fund(pages[0], drew.id, 150);
  expect(table.view(code).party!.bounties.map(bounty => bounty.total)).toEqual([200, 150]);
  expect(table.view(code).players[0]).toMatchObject({ balance: 650, committed: 350 });
  await pages[0].reload();
  await expect(pages[0].getByLabel('Bounty on Blair', { exact: true })).toContainText('Your committed contributions: 200 chips');
  await expect(pages[0].getByLabel('Bounty board', { exact: true })).toContainText('5 social intervals remain');
  const interval = table.view(code).party!.social!;
  expect(interval.hardDeadline - interval.openedAt).toBe(180000);
  expect(interval.slot).toBe(1);
  await pages[0].getByRole('button', { name: "Challenge Blair's bounty", exact: true }).click();
  await expect(pages[1].getByLabel('Challenge from Alex', { exact: true })).toContainText('Bounty defense');
  await pages[1].getByRole('button', { name: 'Accept Duel', exact: true }).click();
  expect(table.view(code).party!.social!.duel).toMatchObject({ purpose: 'BOUNTY', amount: 50, status: 'playing' });
  await pages[1].reload();
  await expect(pages[1].getByRole('heading', { name: 'Duel in progress', exact: true })).toBeVisible();
  await expect(pages[1].getByLabel('Bounty on Blair', { exact: true })).toContainText('Funding is frozen');
  for (let throwNumber = 1; throwNumber <= 3; throwNumber++) {
    await expect(pages[0].getByLabel('Party duel', { exact: true })).toContainText(`Throw ${throwNumber} of 5`);
    await pages[0].getByRole('button', { name: 'Scissors', exact: true }).click();
    await pages[1].getByRole('button', { name: 'Rock', exact: true }).click();
  }
  await expect(pages[0].getByLabel('Bounty on Blair', { exact: true })).toContainText('1 / 3');
  table.advance(2000);
  await expect(pages[0].getByLabel('Social interval budget')).toContainText('Contest slot 2 / 2');
  expect(table.view(code).party!.social!.id).toBe(interval.id);
  expect(table.view(code).party!.social!.hardDeadline).toBe(interval.hardDeadline);
  await expect(pages[0].getByRole('button', { name: "Challenge Blair's bounty", exact: true })).toBeDisabled();
  await pages[2].getByRole('combobox', { name: 'Challenge a friend', exact: true }).selectOption(drew.id);
  await pages[2].getByRole('button', { name: 'Duel stake 50 chips', exact: true }).click();
  await pages[2].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  await coinAccept(pages[3]);
  expect(table.view(code).party!.duelHistory).toHaveLength(2);
  expect(table.view(code).party!.social!.slot).toBe(2);
  expect(table.view(code).party!.bounties.find(bounty => bounty.targetId === drew.id)?.streak).toBe(0);
  await nextRegular(table, pages[0], code);
  for (let defense = 2; defense <= 3; defense++) {
    table.advance(24000);
    await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
    await pages[0].getByRole('button', { name: "Challenge Blair's bounty", exact: true }).click();
    await coinAccept(pages[1]);
    await expect(pages[0].getByLabel('Bounty on Blair', { exact: true })).toContainText(`${defense} / 3`);
    await nextRegular(table, pages[0], code);
  }
  const claimed = table.view(code).party!.bounties.find(bounty => bounty.targetId === blair.id)!;
  expect(claimed).toMatchObject({ status: 'claimed', streak: 3, total: 200, winnerId: blair.id });
  expect(claimed.defendedIntervalIds).toHaveLength(3);
  expect(table.view(code).players.map(player => player.balance)).toEqual([500, 1350, 950, 1050]);
  table.advance(24000);
  await pages[0].getByRole('combobox', { name: 'Bounty target', exact: true }).selectOption(casey.id);
  await expect(pages[0].locator('.bounty-funding-reason')).toContainText('at least 3 remaining social intervals');
  await expect(pages[0].getByRole('button', { name: 'Fund Bounty', exact: false })).toBeDisabled();
  await pages[0].setViewportSize({ width: 390, height: 844 });
  expect(await pages[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[0].screenshot({ path: 'test-results/bounty-streak-mobile.png', fullPage: true });
  table.advance(20000);
  await expect.poll(() => table.view(code).round).toBe(5);
  table.advance(44000);
  await expect.poll(() => table.view(code).round).toBe(6);
  table.advance(24000);
  finishShadowTimeouts(table,code);
  await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  expect(table.view(code).players.map(player => player.balance)).toEqual([650, 1350, 950, 1050]);
  expect(table.view(code).players.every(player => player.committed === 0 && player.reserved === 0)).toBe(true);
  expect(table.view(code).party!.bounties.find(bounty => bounty.targetId === drew.id)).toMatchObject({ status: 'refunded', total: 150 });
  for (const page of pages) {
    await expect(page.getByLabel('Bounty on Blair', { exact: true })).toContainText('claimed all 200 chips');
    await expect(page.getByLabel('Bounty on Drew', { exact: true })).toContainText('returned to their original contributors');
    await expect(page.locator('.result-intro')).toContainText('6 rounds');
  }
  await pages[2].screenshot({ path: 'test-results/bounty-final-settlements.png', fullPage: true });
  await pages[0].getByRole('button', { name: 'Return to Lobby', exact: false }).click();
  await expect(pages[0].getByRole('button', { name: '6 rounds', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(table.view(code).party).toBeNull();
  expect(table.view(code).players.every(player => player.balance === 1000)).toBe(true);
  expect(errors).toEqual([]);
});

test('a funded target loss pays the exact bounty split separately from its matched duel', async ({ table }) => {
  const { pages, code } = await sixRoundParty(table);
  const target = table.view(code).players[1];
  await fund(pages[0], target.id, 150);
  const [, , casey, drew] = table.view(code).players;
  for (const contribution of [250, 250, 250, 200]) await fund(pages[1], drew.id, contribution);
  await pages[1].getByRole('combobox', { name: 'Challenge a friend', exact: true }).selectOption(casey.id);
  await pages[1].getByRole('button', { name: 'Duel stake 50 chips', exact: true }).click();
  await pages[1].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  expect(table.view(code).players[1]).toMatchObject({ balance: 50, reserved: 50, available: 0 });
  await expect(pages[0].getByRole('button', { name: "Challenge Blair's bounty", exact: true })).toBeEnabled();
  await pages[0].getByRole('button', { name: "Challenge Blair's bounty", exact: true }).click();
  await coinAccept(pages[1], 'TAILS');
  await expect(pages[0].getByLabel('Bounty on Blair', { exact: true })).toContainText('127 chips; 23 chips funded the Vault');
  expect(table.view(code).party!.vault).toBe(23);
  expect(table.view(code).party!.bounties[0]).toMatchObject({ status: 'defeated', winnerId: table.view(code).viewerId });
  expect(table.view(code).players.slice(0, 2).map(player => player.balance)).toEqual([1027, 0]);
  expect(table.view(code).players[1].reserved).toBe(0);
  expect(table.view(code).party!.social!.invites.find(invite => invite.inviterId === target.id)?.status).toBe('cancelled');
  expect(table.view(code).party!.transfers.filter(transfer => transfer.kind === 'commission')).toEqual([]);
});
