import { test, expect } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';
import type { TableFixture } from '../fixtures/browser.js';

async function startParty(table: TableFixture) {
  const pages = await Promise.all([table.newPlayer(), table.newPlayer(), table.newPlayer(), table.newPlayer()]);
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  await expect(pages[0].getByRole('heading', { name: 'Bid for the House', exact: true })).toBeVisible();
  for (const page of pages) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  table.server.manager.e.randomIndex = () => 0;
  return { pages, code };
}
async function invite(pages: Page[], defenderId: string, game: 'CONNECT4' | 'CHESS') {
  await pages[0].getByLabel('Challenge a friend').selectOption(defenderId);
  await pages[0].getByRole('button', { name: 'Duel stake 100 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  await pages[1].getByLabel('Duel game').selectOption(game);
  await pages[1].getByRole('button', { name: 'Accept Duel', exact: true }).click();
  for (const page of pages) await expect(page.getByRole('heading', { name: 'Duel in progress', exact: true })).toBeVisible();
}
async function move(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: new RegExp(`^${from}:`) }).click();
  await page.getByRole('button', { name: new RegExp(`^${to}:`) }).click();
}

test('four guests see identical Connect 4 and chess boards, reconnect, and settle funded wins', async ({ table }) => {
  test.setTimeout(65000);
  const { pages, code } = await startParty(table);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  const [alex, blair] = table.view(code).players;
  await invite(pages, blair.id, 'CONNECT4');
  await expect(pages[0].getByLabel('Connect 4 board')).toBeVisible();
  await expect(pages[0].getByRole('button', { name: 'Drop in column 1', exact: true })).toBeEnabled();
  await expect(pages[1].getByRole('button', { name: 'Drop in column 1', exact: true })).toBeDisabled();
  await expect(pages[2].getByRole('button', { name: 'Drop in column 1', exact: true })).toBeDisabled();
  for (const [index, column] of [0, 1, 0].entries()) await pages[index % 2].getByRole('button', { name: `Drop in column ${column + 1}`, exact: true }).click();
  const before = table.view(code).party!.social!.duel!;
  expect(before.connect4!.cells[5][0]).toBe(alex.id);
  expect(before.connect4!.cells[4][0]).toBe(alex.id);
  const deadline = before.deadline;
  await pages[1].reload();
  await expect(pages[1].getByRole('button', { name: 'Drop in column 2', exact: true })).toBeEnabled();
  expect(table.view(code).party!.social!.duel!.deadline).toBe(deadline);
  for (const page of pages) {
    await expect(page.getByLabel('Connect 4 board').getByRole('gridcell')).toHaveCount(42);
    await expect(page.getByRole('gridcell', { name: 'Row 5, column 1: Alex', exact: true })).toBeVisible();
    await expect(page.locator('.duel-heading .countdown')).toHaveAttribute('aria-label', /Move closes: [0-8] seconds/);
    await expect(page.locator('.duel-total-clock .countdown')).toHaveAttribute('aria-label', /Duel hard limit:/);
  }
  await pages[2].setViewportSize({ width: 390, height: 844 });
  expect(await pages[2].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[2].screenshot({ path: 'test-results/connect4-spectator-mobile.png', fullPage: true });
  for (const [index, column] of [1, 0, 1, 0].entries()) await pages[(index + 1) % 2].getByRole('button', { name: `Drop in column ${column + 1}`, exact: true }).click();
  for (const page of pages) {
    await expect(page.locator('.duel-summary')).toContainText('Alex wins the duel.');
    await expect(page.getByRole('gridcell', { name: 'Row 3, column 1: Alex', exact: true })).toBeVisible();
  }
  expect(table.view(code).players.map(player => player.balance)).toEqual([1100, 900, 1000, 1000]);
  expect(table.view(code).players.every(player => player.committed === 0 && player.reserved === 0)).toBe(true);
  table.advance(2000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  await invite(pages, blair.id, 'CHESS');
  expect(table.view(code).party!.social!.duel!.chess!.whiteId).toBe(alex.id);
  for (const page of pages) await expect(page.getByLabel('Chess board').getByRole('gridcell')).toHaveCount(64);
  await expect(pages[2].getByRole('button', { name: 'e2: white pawn', exact: true })).toBeDisabled();
  await pages[0].getByRole('button', { name: 'f2: white pawn', exact: true }).click();
  await expect(pages[0].getByRole('button', { name: 'f5: empty', exact: true })).toBeDisabled();
  await pages[0].getByRole('button', { name: 'f3: empty', exact: true }).click();
  const fen = table.view(code).party!.social!.duel!.chess!.fen;
  const blackClock = table.view(code).party!.social!.duel!.chess!.clockStartedAt;
  await pages[1].reload();
  await expect(pages[1].getByRole('button', { name: 'e7: black pawn', exact: true })).toBeEnabled();
  expect(table.view(code).party!.social!.duel!.chess!.fen).toBe(fen);
  expect(table.view(code).party!.social!.duel!.chess!.clockStartedAt).toBe(blackClock);
  for (const player of table.view(code).players) expect(table.server.manager.snapshot(player.id)!.party!.social!.duel!.chess!.fen).toBe(fen);
  await move(pages[1], 'e7', 'e5');
  await move(pages[0], 'g2', 'g4');
  await pages[1].getByRole('button', { name: 'd8: black queen', exact: true }).focus();
  await pages[1].keyboard.press('Enter');
  await pages[1].getByRole('button', { name: 'h4: empty', exact: true }).focus();
  await pages[1].keyboard.press('Enter');
  for (const page of pages) {
    await expect(page.locator('.duel-summary')).toContainText('Blair wins the duel.');
    await expect(page.getByRole('button', { name: 'h4: black queen', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Chess clocks')).toBeVisible();
  }
  expect(await pages[2].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[2].screenshot({ path: 'test-results/chess-spectator-mobile.png', fullPage: true });
  await pages[0].screenshot({ path: 'test-results/chess-checkmate-desktop.png', fullPage: true });
  expect(table.view(code).players.map(player => player.balance)).toEqual([1000, 1000, 1000, 1000]);
  expect(table.view(code).players.every(player => player.committed === 0 && player.reserved === 0)).toBe(true);
  expect(table.view(code).party!.duelHistory).toHaveLength(2);
  table.advance(2000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  expect(table.view(code).players.reduce((sum, player) => sum + player.balance, 0)).toBe(4000);
  expect(errors).toEqual([]);
});

test('Connect 4 missed move and chess flag keep running across reconnect and pay once', async ({ table }) => {
  const { pages, code } = await startParty(table);
  const [, blair] = table.view(code).players;
  await invite(pages, blair.id, 'CONNECT4');
  table.advance(8000);
  for (const page of pages) await expect(page.locator('.duel-summary')).toContainText('Blair wins the duel.');
  expect(table.view(code).players.map(player => player.balance)).toEqual([900, 1100, 1000, 1000]);
  table.advance(2000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  await invite(pages, blair.id, 'CHESS');
  table.advance(15000);
  await pages[0].reload();
  await expect(pages[0].getByLabel('Chess clocks')).toBeVisible();
  await expect(pages[0].getByLabel(/Alex chess clock: 1[45] seconds/)).toBeVisible();
  table.advance(15000);
  for (const page of pages) await expect(page.locator('.duel-summary')).toContainText('Blair wins the duel.');
  expect(table.view(code).players.map(player => player.balance)).toEqual([800, 1200, 1000, 1000]);
  expect(table.view(code).players.every(player => player.committed === 0 && player.reserved === 0)).toBe(true);
});
