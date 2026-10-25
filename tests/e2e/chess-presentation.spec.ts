import { test, expect } from '../fixtures/browser.js';

test('chess puts each opponent above the board and keeps second-based clocks across reconnect', async ({ table }) => {
  const pages = await Promise.all([table.newPlayer(), table.newPlayer(), table.newPlayer()]);
  const code = await table.host(pages[0]);
  await table.join(pages[1], code, 'Blair');
  await table.join(pages[2], code, 'Casey');
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(24000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  table.server.manager.e.randomIndex = () => 0;
  const [alex, blair] = table.view(code).players;
  await pages[0].getByLabel('Challenge a friend').selectOption(blair.id);
  await pages[0].getByRole('button', { name: 'Duel stake 100 chips', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Send Duel Invite' }).click();
  await pages[1].getByLabel('Duel game').selectOption('CHESS');
  await pages[1].getByRole('button', { name: 'Accept Duel', exact: true }).click();

  await expect(pages[0].locator('.chess-player-opponent')).toContainText('Blair');
  await expect(pages[0].locator('.chess-player-self')).toContainText('Alex (you)');
  await expect(pages[1].locator('.chess-player-opponent')).toContainText('Alex');
  await expect(pages[1].locator('.chess-player-self')).toContainText('Blair (you)');
  await expect(pages[0].getByLabel('Chess board').getByRole('button').first()).toHaveAttribute('aria-label', 'a8: black rook');
  await expect(pages[1].getByLabel('Chess board').getByRole('button').first()).toHaveAttribute('aria-label', 'h1: white rook');
  await expect(pages[2].getByLabel('Chess board').getByRole('button').first()).toHaveAttribute('aria-label', 'a8: black rook');
  await expect(pages[2].getByRole('button', { name: 'e2: white pawn', exact: true })).toBeDisabled();
  await expect(pages[0].getByText('Chess draws and time rules', { exact: true })).toHaveCount(0);

  const whiteClock = pages[0].locator('.chess-player-self .chess-player-clock');
  await expect(whiteClock).toHaveText(/◷ 0:30/);
  // The display updates between server broadcasts, without tenths of a second.
  await expect(whiteClock).toHaveText(/◷ 0:29/, { timeout: 2500 });
  await expect(pages[0].locator('.chess-player-opponent .chess-player-clock')).toHaveText(/◷ 0:30/);
  table.advance(10000);
  const originalStart = table.view(code).party!.social!.duel!.chess!.clockStartedAt;
  await pages[0].reload();
  await expect(pages[0].getByLabel(/Alex chess clock: (19|20) seconds/)).toBeVisible();
  expect(table.view(code).party!.social!.duel!.chess!.clockStartedAt).toBe(originalStart);

  const bars = pages[0].locator('.chess-player-bar');
  const board = pages[0].getByLabel('Chess board');
  const [top, middle, bottom] = await Promise.all([bars.first().boundingBox(), board.boundingBox(), bars.last().boundingBox()]);
  expect(top!.y + top!.height).toBeLessThanOrEqual(middle!.y);
  expect(bottom!.y).toBeGreaterThanOrEqual(middle!.y + middle!.height);
  expect(table.view(code).party!.social!.duel!.chess!.turnId).toBe(alex.id);
});
