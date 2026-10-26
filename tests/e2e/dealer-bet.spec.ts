import { test, expect, scriptedShoe, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';

async function dealerTable(table: TableFixture, finale = false) {
  const pages = await Promise.all([table.newPlayer(), table.newPlayer()]);
  const code = await table.host(pages[0]); await table.join(pages[1], code, 'Blair');
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  const toggle = pages[0].getByRole('checkbox', { name: 'Shadow Blackjack finale', exact: true });
  if ((await toggle.isChecked()) !== finale) await toggle.click();
  await pages[0].getByLabel('Blackjack rounds', { exact: true }).fill(finale ? '1' : '2');
  await pages[0].getByLabel('Betting timer (seconds)', { exact: true }).fill('5');
  for (const label of ['House overthrow', 'Direct duels', 'Bounties', 'Chaos cards', 'Split or Steal deals', 'Additional bluff claims']) {
    const box = pages[0].getByRole('checkbox', { name: label, exact: true });
    if (await box.isChecked()) { await box.click(); await expect(box).not.toBeChecked(); }
  }
  await pages[0].getByRole('button', { name: 'Apply Room Settings', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  await pages[0].getByRole('button', { name: 'House bid 50 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: /^Submit House Bid/ }).click();
  await pages[1].getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('region', { name: 'Your dealer bet', exact: true })).toBeVisible();
  return { pages, code };
}
async function stake(page: Page, chips: number[]) {
  const builder = page.getByRole('form', { name: 'Build your Blackjack wager', exact: true });
  await builder.getByRole('button', { name: 'Clear Pot', exact: true }).click();
  for (const chip of chips) await builder.getByRole('button', { name: 'Bet ' + chip + ' chips', exact: true }).click();
  await builder.getByRole('button', { name: /^(Place|Update) Bet/ }).click();
}

test('the mandatory dealer tray commits before cards, earns125 on150 profit and returns40 after a60 loss', async ({ table }) => {
  const { pages, code } = await dealerTable(table), [house, guest] = pages;
  expect(table.view(code).party!.bank.dealerBet).toMatchObject({ amount: 10, status: 'RESERVED', reserved: 10, maximum: 700 });
  await expect(house.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);
  await stake(house, [100]); await stake(guest, [100, 50]);
  table.server.manager.e.shoe = () => scriptedShoe(['10', '10', '6', '10']);
  table.advance(6000);
  expect(table.view(code).party!.bank.dealerBet).toMatchObject({ amount: 100, status: 'COMMITTED', committed: 100, reserved: 0 });
  expect(table.view(code).players[0]).toMatchObject({ committed: 100, wager: 0, hand: [] });
  await expect(guest.getByRole('region', { name: 'Dealer personal bet', exact: true })).toContainText('Committed');
  expect(table.server.manager.snapshot(table.view(code).players[1].id)!.dealer[1]).toBeNull();
  await guest.getByRole('button', { name: 'Stand', exact: true }).click();
  await house.getByRole('button', { name: 'Dealer Stand', exact: true }).click();
  expect(table.view(code).party!.bank.rounds[0]).toMatchObject({ dealerStake: 100, dealerReturned: 100, stakeLoss: 0, houseEarnings: 125, bankEarnings: 25, dealerProfit: 125 });
  expect(table.view(code).players.map(player => player.balance)).toEqual([1075, 850]);
  await expect(house.getByRole('region', { name: 'Dealer personal bet', exact: true })).toContainText('+125');
  table.advance(4000);
  await stake(house, [100]); await stake(guest, [50, 10]);
  table.server.manager.e.shoe = () => scriptedShoe(['10', '10', '10', '6']);
  table.advance(6000);
  await guest.getByRole('button', { name: 'Stand', exact: true }).click();
  await house.getByRole('button', { name: 'Dealer Stand', exact: true }).click();
  expect(table.view(code).party!.bank.rounds[1]).toMatchObject({ dealerStake: 100, dealerReturned: 40, stakeLoss: 60, dealerProfit: -60, bondLoss: 0, bankLoss: 0 });
  expect(table.view(code).players.map(player => player.balance)).toEqual([1015, 910]);
  await expect(guest.getByRole('region', { name: 'Dealer personal bet', exact: true })).toContainText('Stake returned 40');
  await expect(guest.getByRole('region', { name: 'Dealer personal bet', exact: true })).toContainText('-60');
  await house.setViewportSize({ width: 390, height: 844 });
  expect(await house.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await house.screenshot({ path: 'test-results/dealer-personal-stake-mobile.png', fullPage: true });
  table.advance(4000);
  await expect(house.getByRole('region', { name: 'Dealer match accounting', exact: true })).toBeVisible();
  const balances = table.view(code).players.map(player => player.balance);
  await house.reload(); expect(table.view(code).players.map(player => player.balance)).toEqual(balances);
  expect(table.view(code).party!.bank.rounds).toHaveLength(2);
  expect(table.view(code).players.every(player => player.reserved === 0 && player.committed === 0)).toBe(true);
});

test('Shadow commits the same dealer stake before private cards and settles a busted bluff without duplicating the dealer', async ({ table }) => {
  const { pages, code } = await dealerTable(table, true), [house, guest] = pages;
  table.advance(9000);
  await expect.poll(() => table.view(code).phase).toBe('SHADOW_BETTING');
  await stake(house, [100]); await stake(guest, [100]);
  table.server.manager.e.shoe = () => scriptedShoe(['A', '10', 'K', '6', '10']);
  table.advance(5000);
  await guest.getByRole('button', { name: 'Claim 21', exact: true }).click();
  table.advance(8000);
  await house.getByRole('button', { name: 'Draw & Claim 21', exact: true }).click();
  const shadow = table.server.manager.snapshot(table.view(code).players[1].id)!.party!.shadow!;
  expect(shadow.dealer.value).toBeNull(); expect(shadow.dealer.hand.slice(1)).toEqual([null, null]);
  expect(shadow.entrants.filter(entry => entry.role === 'HOUSE')).toHaveLength(1);
  table.advance(8000);
  expect(table.view(code).party!.bank.rounds.at(-1)).toMatchObject({ dealerStake: 100, dealerReturned: 0, stakeLoss: 100, bondLoss: 50, bankLoss: 0, dealerProfit: -100 });
  expect(table.view(code).party!.shadow!.awards.map(award => award.amount)).toEqual([25, 25]);
  expect(table.view(code).players.map(player => player.balance)).toEqual([825, 1175]);
  await expect(house.getByRole('region', { name: 'Dealer personal bet', exact: true })).toContainText('-150');
  table.advance(2000);
  expect(table.view(code).party!.bank.dealerBet.committed).toBe(0);
});
