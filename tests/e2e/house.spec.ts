import { test, expect, scriptedShoe } from '../fixtures/browser.js';

test('four guests seal House bids, receive full Blackjack payouts and replay with a fresh Vault', async ({ table }) => {
  const pages = await Promise.all([table.newPlayer(), table.newPlayer(), table.newPlayer(), table.newPlayer()]);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  const code = await table.host(pages[0]);
  for (let i = 1; i < 4; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[1].getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  await pages[0].getByRole('checkbox', { name: 'Shadow Blackjack finale', exact: true }).click();
  await expect(pages[0].getByRole('checkbox', { name: 'Shadow Blackjack finale', exact: true })).not.toBeChecked();
  await expect(pages[1].getByRole('button', { name: 'Ready Up' })).toBeVisible();
  await expect(pages[1].getByRole('button', { name: 'Classic', exact: true })).toBeDisabled();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  for (const page of pages) await expect(page.getByRole('heading', { name: 'Bid for the House', exact: true })).toBeVisible();
  await pages[0].getByRole('button', { name: 'House bid 150 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Submit House Bid' }).click();
  await pages[0].getByRole('button', { name: 'House bid 200 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Update House Bid' }).click();
  await expect(pages[0].locator('.auction-own')).toContainText('200 chips reserved');
  await pages[0].getByRole('button', { name: 'Withdraw and Pass' }).click();
  await expect(pages[0].locator('.auction-own')).toContainText('Pass');
  await pages[0].getByRole('button', { name: 'House bid 100 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Update House Bid' }).click();
  await pages[1].getByRole('button', { name: 'House bid 300 chips', exact: true }).click();
  await pages[1].getByRole('button', { name: 'Submit House Bid' }).click();
  await pages[2].getByRole('button', { name: 'House bid 200 chips', exact: true }).click();
  await pages[2].getByRole('button', { name: 'Submit House Bid' }).click();
  await pages[3].getByRole('button', { name: 'Pass Auction' }).click();
  for (let i = 0; i < pages.length; i++) {
    const bids = pages[i].locator('.auction-bid');
    for (let j = 0; j < pages.length; j++) {
      if (j !== i) await expect(bids.nth(j)).toContainText('Bid sealed');
    }
  }
  await pages[1].reload();
  await expect(pages[1].locator('.auction-own')).toContainText('300 chips reserved');
  await pages[1].setViewportSize({ width: 390, height: 844 });
  expect(await pages[1].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[1].screenshot({ path: 'test-results/house-auction-mobile.png', fullPage: true });
  await pages[1].setViewportSize({ width: 1440, height: 1000 });
  table.advance(20000);
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Blair is the House.', exact: true })).toBeVisible();
    await expect(page.locator('.auction-bid').nth(1)).toContainText('300 chips');
    await expect(page.getByLabel('Party funds')).toContainText('300');
  }
  table.advance(2000);
  table.server.manager.e.shoe = () => scriptedShoe(['10', '10', '10', '10', '6', '8', '9', '7']);
  for (const [index, page] of pages.entries()) if (index !== 1) await page.getByRole('button', { name: 'Place Bet' }).click();
  await expect(pages[1].getByRole('button', { name: /^Place Bet/ })).toHaveCount(0);
  table.advance(26000);
  for (const [index, page] of pages.entries()) if (index !== 1) await page.getByRole('button', { name: 'Stand', exact: true }).click();
  await pages[1].getByRole('button', { name: 'Dealer Stand', exact: true }).click();
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Round settled' })).toBeVisible();
    const payout = page.getByLabel('Round payouts');
    await expect(payout).toContainText('200 returned');
    await expect(payout).not.toContainText('commission');
    await expect(page.getByLabel('Dealer round settlement')).toContainText('Personal bond lost');
  }
  expect(table.view(code).players.map(player => player.balance)).toEqual([900, 600, 1100, 1100]);
  expect(table.view(code).party!.bank).toMatchObject({ balance: 8000, committed: 0, bond: { amount: 150 } });
  expect(table.view(code).party!.bank.rounds.at(-1)).toMatchObject({ net: -100, bondLoss: 100, bankLoss: 0, houseEarnings: 0 });
  await pages[0].screenshot({ path: 'test-results/house-round-payouts.png', fullPage: true });
  table.advance(4000);
  await expect.poll(() => table.view(code).phase).toBe('SOCIAL');
  table.advance(20000);
  for (let round = 2; round <= 3; round++) {
    await expect.poll(() => table.view(code).round).toBe(round);
    table.advance(20000);
    await expect.poll(() => table.view(code).phase).toBe('ROUND_RESULT');
    table.advance(4000);
    if (round < 3) {
      await expect.poll(() => table.view(code).phase).toBe('SOCIAL');
      table.advance(20000);
    }
  }
  await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  expect(table.view(code).players.map(player => player.balance)).toEqual([975, 675, 1175, 1175]);
  expect(table.view(code).party!.bank).toMatchObject({ balance: 8000, bond: { ownerId: null, amount: 0 } });
  for (const page of pages) await expect(page.getByLabel('Final Vault distribution')).toContainText('300 chips shared');
  await pages[0].getByRole('button', { name: 'Return to Lobby' }).click();
  await expect(pages[0].getByRole('heading', { name: 'Your table', exact: true })).toBeVisible();
  expect(table.view(code).party).toBeNull();
  expect(table.view(code).roundPayouts).toEqual([]);
  expect(table.view(code).players.every(player => player.balance === 1000 && !player.ready)).toBe(true);
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  await expect(pages[0].getByRole('heading', { name: 'Bid for the House', exact: true })).toBeVisible();
  expect(table.view(code).party).toMatchObject({ houseId: null, vault: 0, bonusReserve: 400, transfers: [] });
  expect(errors).toEqual([]);
});
