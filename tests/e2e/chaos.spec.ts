import { test, expect, scriptedShoe, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';

async function openCard(page: Page, name: string) {
  const card = page.getByLabel(`${name} card`, { exact: true }).first();
  if (await card.getAttribute('open') === null) await card.locator(':scope > summary').click();
  return card;
}

async function wager(page: Page, amount: number) {
  await page.getByRole('button', { name: 'Clear Pot', exact: true }).click();
  for (let remaining = amount; remaining > 0;) {
    const chip = remaining >= 100 ? 100 : 50;
    await page.getByRole('button', { name: `Bet ${chip} chips`, exact: true }).click();
    remaining -= chip;
  }
  await page.getByRole('button', { name: 'Place Bet', exact: false }).click();
}

async function party(table: TableFixture, count = 4) {
  const pages = await Promise.all(Array.from({ length: count }, () => table.newPlayer()));
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  await expect(pages[0].getByRole('heading', { name: 'Bid for the House', exact: true })).toBeVisible();
  return { pages, code };
}
async function nextRound(table: TableFixture, pages: Page[]) {
  table.advance(4000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  table.advance(20000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
}

test('earned Chaos cards fund double and triple naturals and optional Pot Twist from the finite casino Bank', async ({ table }) => {
  const { pages, code } = await party(table);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  for (const page of pages) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  let grant = 0;
  table.server.manager.e.randomIndex = () => grant++ % 4;
  table.advance(20000);
  await expect(pages[0].getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  expect(table.view(code).party!.chaos.inventories.map(inventory => inventory.cards[0].kind)).toEqual(['DOUBLE_DOWN', 'TRIPLE_DOWN', 'POT_TWIST', 'EMERGENCY_FUND']);
  await openCard(pages[0], 'Double Down Chaos');
  await expect(pages[0].getByRole('button', { name: 'Play Double Down Chaos', exact: true })).toBeDisabled();
  await expect(pages[0].getByLabel('Double Down Chaos card')).toContainText('Play this card during betting.');
  await nextRound(table, pages);
  await expect(pages[0].getByLabel('Double Down Chaos card')).toContainText('Submit a wager');
  for (const page of pages) await page.getByRole('button', { name: 'Place Bet' }).click();
  await openCard(pages[0], 'Double Down Chaos');
  await pages[0].getByRole('button', { name: 'Play Double Down Chaos', exact: true }).click();
  await openCard(pages[1], 'Triple Down Chaos');
  await pages[1].getByRole('button', { name: 'Play Triple Down Chaos', exact: true }).click();
  await openCard(pages[2], 'Pot Twist');
  await pages[2].getByRole('button', { name: 'Play Pot Twist', exact: true }).click();
  await expect(pages[0].locator('.chaos-multiplier')).toContainText('200 chips');
  await expect(pages[1].locator('.chaos-multiplier')).toContainText('300 chips');
  await expect(pages[3].getByLabel('Emergency Fund card')).toContainText('Withdraw your wager');
  await pages[1].reload();
  await expect(pages[1].locator('.chaos-multiplier')).toContainText('100 × 3');
  await expect(pages[1].locator('.chaos-allowance')).toContainText('Used this round');
  await pages[3].setViewportSize({ width: 390, height: 844 });
  expect(await pages[3].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[3].screenshot({ path: 'test-results/chaos-inventory-mobile.png', fullPage: true });
  table.server.manager.e.shoe = () => scriptedShoe(['A', 'A', 'A', 'A', '10', 'K', 'K', 'K', 'K', '7']);
  table.advance(20000);
  for (const page of pages) await expect(page.getByRole('heading', { name: 'Opt into Pot Twist', exact: true })).toBeVisible();
  await expect(pages[0].getByRole('button', { name: 'Double My Wager', exact: true })).toBeDisabled();
  await expect(pages[1].getByRole('button', { name: 'Double My Wager', exact: true })).toBeDisabled();
  await pages[2].getByRole('button', { name: 'Double My Wager', exact: true }).click();
  await pages[3].getByRole('button', { name: 'Double My Wager', exact: true }).click();
  expect(table.view(code).players.map(player => player.wager)).toEqual([200, 300, 200, 200]);
  await pages[2].reload();
  await expect(pages[2].getByLabel('Pot Twist window')).toContainText('Your wager is already doubled');
  await expect(pages[2].getByRole('button', { name: 'Double My Wager', exact: true })).toBeDisabled();
  table.advance(4999);
  await expect.poll(() => table.view(code).phase).toBe('POT_TWIST');
  await pages[2].screenshot({ path: 'test-results/chaos-pot-twist.png', fullPage: true });
  table.advance(1);
  await expect.poll(() => table.view(code).phase).toBe('DEALING');
  table.advance(1350);
  for (const page of pages) await expect(page.getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  const payouts = table.view(code).roundPayouts;
  expect(payouts.map(payout => payout.returned)).toEqual([500, 750, 500, 500]);
  expect(payouts.map(payout => payout.houseCommission)).toEqual([0, 0, 0, 0]);
  expect(table.view(code).players.map(player => player.balance)).toEqual([1300, 1450, 1300, 1300]);
  expect(table.view(code).party!.bank).toMatchObject({ initial: 8000, balance: 6650, committed: 0, bond: { ownerId: null, amount: 0 } });
  expect(table.view(code).party!.bank.rounds.at(-1)).toMatchObject({ net: -1350, bondLoss: 0, bankLoss: 1350, houseEarnings: 0 });
  await expect(pages[1].getByLabel('Round payouts')).toContainText('750 returned');
  await expect(pages[1].getByLabel('Round payouts')).not.toContainText('commission');
  expect(errors).toEqual([]);
});

test('a genuinely earned Emergency Fund spends the finite reserve once and remains spent after withdrawal', async ({ table }) => {
  const { pages, code } = await party(table, 2);
  table.server.manager.e.randomIndex = () => 3;
  table.server.manager.e.shoe = () => scriptedShoe(['10', '10', '10', '6', '7', '10']);
  for (const page of pages) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  for (const page of pages) {
    await wager(page, 250);
  }
  table.advance(26000);
  for (const page of pages) await page.getByRole('button', { name: 'Stand', exact: false }).click();
  table.advance(350);
  await expect(pages[0].getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  expect(table.view(code).players.map(player => player.balance)).toEqual([750, 750]);
  expect(table.view(code).party!.chaos.inventories.every(inventory => inventory.cards[0].kind === 'EMERGENCY_FUND')).toBe(true);
  await nextRound(table, pages);
  await openCard(pages[0], 'Emergency Fund');
  await expect(pages[0].getByLabel('Emergency Fund card')).toContainText('Funded award: 100 chips');
  await pages[0].getByRole('button', { name: 'Play Emergency Fund', exact: true }).click();
  expect(table.view(code).players[0].balance).toBe(850);
  expect(table.view(code).party!.bonusReserve).toBe(100);
  await pages[0].getByRole('button', { name: 'Place Bet' }).click();
  await pages[0].getByRole('button', { name: 'Withdraw', exact: true }).click();
  await pages[0].reload();
  await expect(pages[0].locator('.chaos-allowance')).toContainText('Used this round');
  expect(table.view(code).players[0].balance).toBe(850);
  table.advance(20000);
  await expect(pages[0].getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  await nextRound(table, pages);
  await openCard(pages[0], 'Emergency Fund');
  await expect(pages[0].getByRole('button', { name: 'Play Emergency Fund', exact: true })).toBeDisabled();
  await expect(pages[0].getByLabel('Emergency Fund card')).toContainText('once per player per match');
  const emergency = await openCard(pages[1], 'Emergency Fund');
  await emergency.getByRole('button', { name: 'Play Emergency Fund', exact: true }).click();
  expect(table.view(code).party!.bonusReserve).toBe(0);
  expect(table.view(code).players.map(player => player.balance)).toEqual([850, 850]);
  await pages[1].reload();
  await openCard(pages[1], 'Emergency Fund');
  await expect(pages[1].getByRole('button', { name: 'Play Emergency Fund', exact: true })).toBeDisabled();
  await expect(pages[1].getByLabel('Party funds').locator('span').filter({ hasText: 'Bonus reserve' }).locator('strong')).toHaveText('0');
  const emergencyTransfers = table.view(code).party!.transfers.filter(transfer => transfer.kind === 'bonus');
  expect(emergencyTransfers.map(transfer => transfer.amount)).toEqual([100, 100]);
  expect(new Set(emergencyTransfers.map(transfer => transfer.id)).size).toBe(2);
});
