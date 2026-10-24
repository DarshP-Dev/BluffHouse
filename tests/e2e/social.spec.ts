import { test, expect, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';
import type { Ack, Command } from '@bluff-house/shared';

async function friends(table: TableFixture) {
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  return { pages, code };
}
async function post(page: Page, message: string) {
  await page.getByRole('textbox', { name: 'Message to this room', exact: true }).fill(message);
  await page.getByRole('textbox', { name: 'Message to this room', exact: true }).press('Enter');
}

test('room chat renders plain text privately and a pending chat acknowledgement leaves the live Hit usable', async ({ table }) => {
  const { pages, code } = await friends(table);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  await pages[0].getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('textbox', { name: 'Avatar initials', exact: true }).fill('dp');
  await pages[0].getByRole('button', { name: 'Avatar color Ruby', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Save Avatar', exact: true }).click();
  await expect(pages[0].getByRole('button', { name: 'Cancel Ready', exact: true })).toBeVisible();
  for (const page of pages) {
    await expect(page.locator('.lobby-seat').filter({ hasText: 'Alex' }).locator('.avatar')).toHaveText('DP');
    await expect(page.locator('.lobby-seat').filter({ hasText: 'Alex' }).locator('.avatar')).toHaveAttribute('data-profile-color', 'RUBY');
  }
  const unsafeLookingText = '<img src=x onerror="window.chatInjected=1">';
  await post(pages[0], unsafeLookingText);
  for (const page of pages) {
    await expect(page.getByRole('log', { name: 'Room messages', exact: true })).toContainText(unsafeLookingText);
    await expect(page.locator('.chat-message strong')).toHaveText('Alex');
    await expect(page.locator('.chat-message time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).chatInjected)).toBeUndefined();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  }
  const otherRoom = await table.newPlayer();
  await table.host(otherRoom, 'Eve');
  await expect(otherRoom.getByRole('log', { name: 'Room messages', exact: true })).not.toContainText(unsafeLookingText);
  await post(otherRoom, 'Only Eve can see this room.');
  await expect(pages[0].getByRole('log', { name: 'Room messages', exact: true })).not.toContainText('Only Eve');
  await pages[0].reload();
  await expect(pages[0].getByRole('textbox', { name: 'Avatar initials', exact: true })).toHaveValue('DP');
  await expect(pages[0].getByRole('log', { name: 'Room messages', exact: true })).toContainText(unsafeLookingText);
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Place Bet', exact: false }).click();
  table.advance(21000);
  await expect(pages[0].getByRole('button', { name: /^Hit/ })).toBeEnabled();
  const decision = table.view(code).decisionId, deadline = table.view(code).deadline;
  const serverSocket = [...table.server.io.sockets.sockets.values()].find(socket => socket.data.guest.id === table.view(code).viewerId)!;
  const processCommand = serverSocket.listeners('command')[0]!;
  serverSocket.removeAllListeners('command');
  let holdChat = true, releaseChat: (() => void) | undefined;
  serverSocket.on('command', (command: Command, ack: (result: Ack) => void) => {
    if (command.type === 'chat:send' && holdChat) processCommand(command, (result: Ack) => { releaseChat = () => ack(result); });
    else processCommand(command, ack);
  });
  await post(pages[0], 'I can still play while this sends.');
  await expect(pages[1].getByRole('log', { name: 'Room messages', exact: true })).toContainText('I can still play while this sends.');
  expect(table.view(code).decisionId).toBe(decision);
  expect(table.view(code).deadline).toBe(deadline);
  await expect(pages[0].getByRole('button', { name: 'Sending…', exact: true })).toBeDisabled();
  await expect(pages[0].getByRole('button', { name: /^Hit/ })).toBeEnabled();
  await pages[0].getByRole('button', { name: /^Hit/ }).click();
  await expect.poll(() => table.view(code).players[0].hand.length).toBe(3);
  expect(table.view(code).players[0].value?.total).toBe(19);
  await expect.poll(() => !!releaseChat).toBe(true);
  holdChat = false; releaseChat!();
  await expect(pages[0].getByRole('textbox', { name: 'Message to this room', exact: true })).toHaveValue('');
  await post(pages[0], 'Too fast, keep my draft.');
  await expect(pages[0].locator('.chat-error')).toContainText('Wait one second');
  await expect(pages[0].getByRole('textbox', { name: 'Message to this room', exact: true })).toHaveValue('Too fast, keep my draft.');
  await expect(pages[0].getByRole('button', { name: /^Stand/ })).toBeEnabled();
  table.advance(1000);
  await pages[0].getByRole('button', { name: 'Send Message', exact: true }).click();
  await expect(pages[0].getByRole('log', { name: 'Room messages', exact: true })).toContainText('Too fast, keep my draft.');
  await pages[0].setViewportSize({ width: 390, height: 844 });
  expect(await pages[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[0].getByRole('heading', { name: 'Talk around the table.', exact: true }).click();
  await pages[0].screenshot({ path: 'test-results/room-chat-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('actual lone stealing and a funded 400-chip duel earn evidenced session badges that survive replay while match statistics reset', async ({ table }) => {
  const { pages, code } = await friends(table);
  table.server.manager.e.randomIndex = () => 0;
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  await pages[0].getByRole('checkbox', { name: 'Shadow Draw finale', exact: true }).click();
  await expect(pages[0].getByRole('checkbox', { name: 'Shadow Draw finale', exact: true })).not.toBeChecked();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  table.advance(24000);
  const ids = table.view(code).players.map(player => player.id);
  await pages[0].getByRole('combobox', { name: 'Deal partner', exact: true }).selectOption(ids[1]);
  await pages[0].getByRole('button', { name: 'Deal contribution 250 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Offer Split or Steal', exact: false }).click();
  await pages[1].getByRole('button', { name: 'Accept Deal', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Lock Steal', exact: true }).click();
  await pages[1].getByRole('button', { name: 'Lock Split', exact: true }).click();
  await expect.poll(() => table.view(code).players[0].profile.badges.map(badge => badge.id)).toContain('BETRAYER');
  expect(table.view(code).players[0].profile.badges.map(badge => badge.id)).not.toContain('HIGH_ROLLER');
  for (const page of pages) await expect(page.getByLabel('Earned badge: Betrayer', { exact: true })).toBeVisible();
  table.advance(2000);
  table.advance(24000);
  await pages[0].getByRole('combobox', { name: 'Challenge a friend', exact: true }).selectOption(ids[2]);
  await pages[0].getByRole('button', { name: 'Duel stake 200 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Send Duel Invite', exact: false }).click();
  await pages[2].getByRole('combobox', { name: 'Duel game', exact: true }).selectOption('COIN');
  await pages[2].getByRole('combobox', { name: 'Your coin side', exact: true }).selectOption('TAILS');
  await pages[2].getByRole('button', { name: 'Accept Duel', exact: true }).click();
  await expect.poll(() => table.view(code).players[0].profile.badges.map(badge => badge.id)).toContain('HIGH_ROLLER');
  expect(table.view(code).players[0].profile.badges.filter(badge => badge.id === 'HIGH_ROLLER')).toHaveLength(1);
  await post(pages[0], 'That 400-chip pot was real.');
  table.advance(2000);
  table.advance(24000);
  await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  expect(table.view(code).players.map(player => player.balance)).toEqual([1450, 750, 800, 1000]);
  expect(table.view(code).matchStats.find(stats => stats.playerId === ids[0])).toMatchObject({ dealsPlayed: 1, loneSteals: 1, dealNet: 250, duelWins: 1, duelNet: 200 });
  const alexBadges = pages[0].getByLabel('Alex session badges', { exact: true });
  await alexBadges.getByText('Betrayer', { exact: true }).click();
  await expect(alexBadges).toContainText('Recorded evidence:');
  await expect(alexBadges).toContainText('sole Steal choice');
  await alexBadges.getByText('High Roller', { exact: true }).click();
  await expect(alexBadges).toContainText('Won a funded 400-chip duel pot');
  await expect(pages[0].getByLabel('Current match statistics', { exact: true })).toContainText('1 / 0 / 1');
  await expect(pages[0].getByLabel('Session achievements', { exact: true })).toContainText('24 hours of inactivity or a server restart');
  await pages[0].getByRole('heading', { name: 'Earned at this table.', exact: true }).click();
  await pages[0].screenshot({ path: 'test-results/session-badge-evidence.png', fullPage: true });
  await pages[0].getByRole('button', { name: 'Return to Lobby', exact: false }).click();
  await expect(pages[0].getByRole('heading', { name: 'Your table', exact: true })).toBeVisible();
  expect(table.view(code).matchStats).toEqual([]);
  expect(table.view(code).players[0].profile.badges.map(badge => badge.id)).toEqual(expect.arrayContaining(['BETRAYER', 'HIGH_ROLLER']));
  expect(table.view(code).players[0].profile.progress.acceptedBluffWins).toBe(0);
  await expect(pages[0].getByRole('log', { name: 'Room messages', exact: true })).toContainText('That 400-chip pot was real.');
  await pages[0].reload();
  await expect(pages[0].getByLabel('Alex session badges', { exact: true })).toContainText('Betrayer');
  await expect(pages[0].getByLabel('Alex session badges', { exact: true })).toContainText('High Roller');
});
