import { test, expect, scriptedShoe } from '../fixtures/browser.js';

test('four guests fund hidden RPS throws, reconnect, settle once and return for Coin Flip', async ({ table }) => {
  const pages = await Promise.all([table.newPlayer(), table.newPlayer(), table.newPlayer(), table.newPlayer()]);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
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
  for (const page of pages) await expect(page.getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  const [alexId, blairId] = table.view(code).players.map(player => player.id);
  await pages[0].getByLabel('Challenge a friend').selectOption(blairId);
  await pages[0].getByRole('button', { name: 'Duel stake 150 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  await expect(pages[0].locator('.duel-outgoing')).toContainText('150 chips reserved');
  await pages[1].getByRole('button', { name: 'Accept Duel', exact: true }).click();
  for (const page of pages) await expect(page.getByRole('heading', { name: 'Duel in progress', exact: true })).toBeVisible();
  expect(table.view(code).players.slice(0, 2).map(player => player.committed)).toEqual([150, 150]);
  await pages[0].getByRole('button', { name: 'Rock', exact: true }).click();
  await expect(pages[0].locator('.duel-private')).toContainText('Your locked choice: rock');
  for (const page of pages.slice(1)) {
    await expect(page.locator('.duel-locks')).toContainText('Alex: Choice locked');
    await expect(page.locator('.duel-private')).toHaveCount(0);
    await expect(page.getByLabel('Revealed throws')).toHaveCount(0);
  }
  const social = table.view(code).party!.social!;
  for (const player of table.view(code).players.slice(1)) {
    const rivalView = table.server.manager.snapshot(player.id)!;
    expect(rivalView.party!.social!.duel!.ownChoice).toBeUndefined();
    expect(rivalView.party!.social!.duel!.throws).toEqual([]);
  }
  expect(social.duel!.lockedPlayerIds).toContain(alexId);
  await pages[0].reload();
  await expect(pages[0].locator('.duel-private')).toContainText('Your locked choice: rock');
  await expect(pages[0].getByRole('button', { name: 'Paper', exact: true })).toBeDisabled();
  expect(table.view(code).deadline).toBe(table.view(code).party!.social!.duel!.deadline);
  const displayedSeconds = async (selector: string) => Number((await pages[0].locator(selector).getAttribute('aria-label'))!.match(/(\d+) seconds/)![1]);
  const topSeconds = await displayedSeconds('.table-titlebar .countdown');
  const throwSeconds = await displayedSeconds('.duel-heading .countdown');
  expect(topSeconds).toBe(throwSeconds);
  expect(throwSeconds).toBeLessThanOrEqual(8);
  expect(await displayedSeconds('.duel-total-clock .countdown')).toBeLessThanOrEqual(60);
  await pages[2].setViewportSize({ width: 390, height: 844 });
  expect(await pages[2].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[2].screenshot({ path: 'test-results/duel-spectator-mobile.png', fullPage: true });
  await pages[1].getByRole('button', { name: 'Scissors', exact: true }).click();
  for (let throwNumber = 2; throwNumber <= 3; throwNumber++) {
    await expect(pages[0].getByLabel('Party duel')).toContainText(`Throw ${throwNumber} of 5`);
    await pages[0].getByRole('button', { name: 'Rock', exact: true }).click();
    await pages[1].getByRole('button', { name: 'Scissors', exact: true }).click();
  }
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Duel settled', exact: true })).toBeVisible();
    await expect(page.locator('.duel-summary')).toContainText('Alex wins the duel.');
    await expect(page.locator('.duel-summary')).toContainText('300 chips paid to Alex; 150 chips net profit.');
    await expect(page.getByLabel('Revealed throws')).toContainText('Throw 3');
    await expect(page.getByLabel('Duel statistics')).toContainText('1 / 0 / 0');
  }
  expect(table.view(code).players.map(player => player.balance)).toEqual([1150, 850, 1000, 1000]);
  expect(table.view(code).players.every(player => player.committed === 0 && player.reserved === 0)).toBe(true);
  await pages[0].screenshot({ path: 'test-results/duel-rps-settlement.png', fullPage: true });
  table.advance(2000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  expect(table.view(code).round).toBe(2);
  table.advance(24000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  table.server.manager.e.randomIndex = () => 0;
  await pages[0].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  await pages[1].getByLabel('Duel game').selectOption('COIN');
  await pages[1].getByLabel('Your coin side').selectOption('HEADS');
  await pages[1].getByRole('button', { name: 'Accept Duel', exact: true }).click();
  for (const page of pages) {
    await expect(page.locator('.coin-reveal')).toContainText('Blair called heads. The server flipped heads.');
    await expect(page.locator('.duel-summary')).toContainText('Blair wins the duel.');
  }
  expect(table.view(code).players.map(player => player.balance)).toEqual([1050, 950, 1000, 1000]);
  expect(table.view(code).party!.duelHistory).toHaveLength(2);
  table.advance(2000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  expect(table.view(code).party!.duelHistory).toHaveLength(2);
  expect(table.view(code).players.reduce((sum, player) => sum + player.balance, 0)).toBe(4000);
  await expect(pages[0].getByLabel('Duel statistics')).toBeVisible();
  expect(errors).toEqual([]);
});

test('declined and expired invitations refund, and accepting releases the defender outgoing reservation', async ({ table }) => {
  table.server.manager.e.shoe = () => scriptedShoe(['10', '10', '6', '7']);
  table.server.manager.e.randomIndex = () => 0;
  const pages = await Promise.all([table.newPlayer(), table.newPlayer(), table.newPlayer(), table.newPlayer()]);
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  await pages[0].getByRole('button', { name: 'House bid 300 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Submit House Bid', exact: false }).click();
  table.advance(22000);
  await pages[0].getByRole('button', { name: 'Clear Pot', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Bet 100 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Bet 100 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Bet 50 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Place Bet', exact: false }).click();
  table.advance(21000);
  await pages[0].getByRole('button', { name: 'Stand', exact: false }).click();
  table.advance(4350);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  expect(table.view(code).players[0].balance).toBe(450);
  const [alex, , casey, drew] = table.view(code).players;
  await pages[0].getByLabel('Challenge a friend').selectOption(drew.id);
  await pages[0].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  await pages[3].getByRole('button', { name: 'Decline Duel', exact: true }).click();
  await expect(pages[0].getByRole('button', { name: 'Send Duel Invite', exact: false })).toBeEnabled();
  expect(table.view(code).players[0].reserved).toBe(0);
  await pages[0].getByLabel('Challenge a friend').selectOption(casey.id);
  await pages[0].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  table.advance(8000);
  await expect(pages[0].getByRole('button', { name: 'Send Duel Invite', exact: false })).toBeEnabled();
  expect(table.view(code).players[0].reserved).toBe(0);
  await pages[1].getByLabel('Challenge a friend').selectOption(alex.id);
  await pages[1].getByRole('button', { name: 'Duel stake 250 chips', exact: true }).click();
  await pages[1].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  await pages[0].getByRole('button', { name: 'Duel stake 250 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  await expect(pages[0].locator('.duel-outgoing')).toContainText('250 chips reserved');
  expect(table.view(code).players[0].available).toBe(200);
  await expect(pages[0].getByRole('button', { name: 'Accept Duel', exact: true })).toBeEnabled();
  await pages[0].getByLabel('Duel game').selectOption('COIN');
  await pages[0].getByRole('button', { name: 'Accept Duel', exact: true }).click();
  await expect(pages[0].locator('.duel-summary')).toContainText('Alex wins the duel.');
  expect(table.view(code).players[0].balance).toBe(700);
  expect(table.view(code).players.every(player => player.reserved === 0 && player.committed === 0)).toBe(true);
  expect(table.view(code).party!.social!.invites.filter(invite => invite.status === 'accepted')).toHaveLength(1);
  expect(table.view(code).party!.social!.invites.some(invite => invite.inviterId === alex.id && invite.status === 'cancelled')).toBe(true);
  table.advance(2000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
});
