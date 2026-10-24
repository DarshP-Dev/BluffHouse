import { test, expect, scriptedShoe, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';
import type { Rank, RoomView } from '@bluff-house/shared';

async function earnedHandCards(table: TableFixture, grants = [4, 5, 6, 6]) {
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  await expect(pages[0].getByRole('heading', { name: 'Bid for the House', exact: true })).toBeVisible();
  for (const page of pages) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  let next = 0;
  table.server.manager.e.randomIndex = () => grants[next++ % grants.length];
  table.advance(20000);
  await expect(pages[0].getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  expect(table.view(code).party!.chaos.inventories.map(inventory => inventory.cards[0].kind)).toEqual(grants.map(index => ['DOUBLE_DOWN', 'TRIPLE_DOWN', 'POT_TWIST', 'EMERGENCY_FUND', 'HAND_SWAP', 'TABLE_TURN', 'SECOND_CHANCE'][index]));
  table.advance(24000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  return { pages, code };
}

async function dealHands(table: TableFixture, pages: Page[], ranks: Rank[] = ['5', '6', '7', '8', '10', '5', '6', '7', '8', '7', '2', '3', '4']) {
  table.server.manager.e.shoe = () => scriptedShoe(ranks);
  for (let i = 0; i < pages.length; i++) {
    await pages[i].getByRole('button', { name: `Bet ${100 + i * 50} chips`, exact: true }).click();
    await pages[i].getByRole('button', { name: 'Place Bet', exact: false }).click();
  }
  table.advance(21000);
  for (const page of pages) await expect(page.getByRole('heading', { name: 'Change the hands', exact: true })).toBeVisible();
}
const hands = (view: RoomView) => view.players.map(player => player.hand.map(card => card.id));
async function expectPublicHands(pages: Page[], view: RoomView) {
  for (const page of pages) for (const player of view.players) {
    const seat = page.locator('.player-seat').filter({ hasText: player.name });
    for (const card of player.hand) await expect(seat.getByLabel(`${card.rank} of ${{ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[card.suit]}`)).toBeVisible();
  }
}

test('earned Hand Swap moves actual hands, preserves stakes and Second Chance replaces only a live ordinary hit', async ({ table }) => {
  const { pages, code } = await earnedHandCards(table);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  await expect(pages[0].getByLabel('Hand Swap card')).toContainText('five-second');
  await expect(pages[0].getByRole('button', { name: 'Play Hand Swap', exact: true })).toBeDisabled();
  await dealHands(table, pages);
  const before = table.view(code);
  const beforeHands = hands(before);
  const stakes = before.players.map(player => ({ balance: player.balance, wager: player.wager, committed: player.committed }));
  await pages[0].reload();
  await expect(pages[0].getByRole('heading', { name: 'Change the hands', exact: true })).toBeVisible();
  const targets = pages[0].getByLabel('Hand to swap with');
  await expect(targets.locator('option')).toHaveText(['Blair', 'Casey', 'Drew']);
  await targets.selectOption(before.players[1].id);
  await pages[0].setViewportSize({ width: 390, height: 844 });
  expect(await pages[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[0].screenshot({ path: 'test-results/chaos-hand-window-mobile.png', fullPage: true });
  await pages[0].getByRole('button', { name: 'Play Hand Swap', exact: true }).click();
  await expect.poll(() => hands(table.view(code))).toEqual([beforeHands[1], beforeHands[0], beforeHands[2], beforeHands[3]]);
  expect(table.view(code).players.map(player => ({ balance: player.balance, wager: player.wager, committed: player.committed }))).toEqual(stakes);
  await expect(pages[1].getByRole('button', { name: 'Play Table Turn', exact: true })).toBeDisabled();
  expect(table.view(code).party!.chaos.inventories[0].cards).toEqual([]);
  if (table.view(code).phase === 'HAND_CHAOS') table.advance(5000);
  await expect(pages[0].getByRole('heading', { name: 'Player turns', exact: true })).toBeVisible();
  await expectPublicHands(pages, table.view(code));
  await pages[0].getByRole('button', { name: 'Stand', exact: false }).click();
  await pages[1].getByRole('button', { name: 'Stand', exact: false }).click();
  await expect(pages[2].getByRole('button', { name: 'Play Second Chance', exact: true })).toBeDisabled();
  await pages[2].getByRole('button', { name: 'Hit', exact: false }).click();
  const hit = table.view(code).players[2].hand.at(-1)!;
  expect(hit.rank).toBe('2');
  await pages[2].reload();
  await expect(pages[2].getByRole('button', { name: 'Play Second Chance', exact: true })).toBeEnabled();
  await pages[2].getByRole('button', { name: 'Play Second Chance', exact: true }).click();
  await expect.poll(() => table.view(code).players[2].hand.at(-1)?.rank).toBe('3');
  expect(table.view(code).players[2].hand.length).toBe(3);
  expect(table.view(code).discarded).toEqual([hit]);
  expect(table.view(code).players.some(player => player.hand.some(card => card.id === hit.id))).toBe(false);
  for (const page of pages) await expect(page.getByLabel('Consumed redraw cards')).toBeVisible();
  expect(table.view(code).party!.chaos.inventories[2].cards).toEqual([]);
  await expect(pages[2].locator('.chaos-allowance')).toContainText('Round activation used');
  await expectPublicHands(pages, table.view(code));
  await pages[2].getByRole('heading', { name: 'Player turns', exact: true }).click();
  await pages[2].screenshot({ path: 'test-results/chaos-second-chance.png', fullPage: true });
  await pages[2].getByRole('button', { name: 'Stand', exact: false }).click();
  await pages[3].getByRole('button', { name: 'Stand', exact: false }).click();
  table.advance(350);
  await expect(pages[0].getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  expect(table.view(code).roundPayouts.map(payout => payout.stake)).toEqual([100, 150, 200, 250]);
  expect(table.view(code).players.map(player => player.balance)).toEqual([900, 850, 1000, 750]);
  expect(errors).toEqual([]);
});

test('earned Table Turn rotates eligible hands one seat left and protects a natural', async ({ table }) => {
  const { pages, code } = await earnedHandCards(table, [5, 4, 6, 6]);
  await dealHands(table, pages, ['5', '6', 'A', '8', '10', '5', '6', 'K', '8', '7', '2', '3']);
  const before = table.view(code), original = hands(before);
  expect(before.players[2].value?.natural).toBe(true);
  await pages[0].getByRole('button', { name: 'Play Table Turn', exact: true }).click();
  await expect.poll(() => hands(table.view(code))).toEqual([original[1], original[3], original[2], original[0]]);
  expect(table.view(code).players.map(player => player.wager)).toEqual([100, 150, 200, 250]);
  expect(table.view(code).players[2].value?.natural).toBe(true);
  expect(table.view(code).dealer).toEqual(before.dealer);
  await expect(pages[1].getByRole('button', { name: 'Play Hand Swap', exact: true })).toBeDisabled();
  if (table.view(code).phase === 'HAND_CHAOS') table.advance(5000);
  await expectPublicHands(pages, table.view(code));
  expect(await pages[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
