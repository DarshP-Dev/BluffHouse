import { test, expect, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';

async function party(table: TableFixture, count = 4, sixRounds = false) {
  const pages = await Promise.all(Array.from({ length: count }, () => table.newPlayer()));
  for (const page of pages) await page.setViewportSize({ width: 1680, height: 1050 });
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  if (sixRounds) await pages[0].getByRole('button', { name: '6 rounds', exact: true }).click();
  const finale = pages[0].getByRole('checkbox', { name: 'Shadow Draw finale', exact: true });
  if (await finale.isChecked()) {
    await finale.click();
    await expect(finale).not.toBeChecked();
  }
  return { pages, code };
}

async function start(table: TableFixture, pages: Page[]) {
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(pages[0].locator('.auction-page')).toBeVisible();
  await expect(pages[0].getByLabel('Blackjack table', { exact: true })).toHaveCount(0);
  for (const page of pages.slice(1)) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(15000);
  // The fixture clock is manual; a real submission broadcasts its updated server time.
  await pages[0].getByRole('button', { name: 'Pass Auction', exact: true }).click();
  const auctionTimer = pages[0].getByLabel(/^House auction closes: [0-5] seconds$/);
  await expect(auctionTimer).toHaveClass(/countdown-urgent/);
  expect(Number.parseFloat(await auctionTimer.locator('strong').evaluate(element => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(24);
  table.advance(7000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
}

async function tableY(page: Page) {
  return page.getByLabel('Blackjack table', { exact: true }).evaluate(element => element.getBoundingClientRect().top + window.scrollY);
}

test('all hands stay on the large table while inline social controls, deals and duels open below it', async ({ table }) => {
  test.setTimeout(65000);
  const { pages, code } = await party(table, 4, true);
  const page = pages[0];
  const errors: string[] = [];
  for (const guest of pages) guest.on('pageerror', error => errors.push(error.message));
  await start(table, pages);

  const title = page.locator('.gameplay-titlebar');
  const [round, phase, clock, bar] = await Promise.all([
    title.locator('.gameplay-round').boundingBox(), title.locator('.gameplay-phase').boundingBox(),
    title.locator('.main-phase-timer').boundingBox(), title.boundingBox(),
  ]);
  expect(round!.x).toBeLessThan(phase!.x);
  expect(clock!.x).toBeGreaterThan(phase!.x + phase!.width);
  expect(Math.abs(phase!.x + phase!.width / 2 - (bar!.x + bar!.width / 2))).toBeLessThan(35);
  const feltBox = await page.getByLabel('Blackjack table', { exact: true }).boundingBox();
  expect(feltBox!.width).toBeGreaterThan(650);
  expect(feltBox!.height).toBeGreaterThan(440);

  const chat = page.getByRole('region', { name: 'Room chat', exact: true });
  const compose = chat.getByRole('textbox', { name: 'Message to this room', exact: true });
  await expect(compose).toHaveJSProperty('tagName', 'INPUT');
  await expect(chat.locator(':scope > p')).toHaveCount(0);
  await compose.fill('All hands are on the table.');
  await compose.press('Enter');
  await expect(chat.getByRole('log')).toContainText('All hands are on the table.');
  const reactions = page.getByRole('region', { name: 'Table reactions', exact: true });
  const [chatBox, reactionsBox] = await Promise.all([chat.boundingBox(), reactions.boundingBox()]);
  expect(reactionsBox!.y).toBeGreaterThanOrEqual(chatBox!.y + chatBox!.height);
  expect(reactionsBox!.y - chatBox!.y - chatBox!.height).toBeLessThan(35);
  await reactions.getByRole('button', { name: 'React 😂', exact: true }).click();
  await expect(pages[1].locator('.reaction-stream')).toContainText('Alex');

  for (const guest of pages) await guest.getByRole('button', { name: /^Place Bet/ }).click();
  table.advance(26000);
  await expect(page.getByRole('heading', { name: 'Player turns', exact: true })).toBeVisible();
  const hands = table.view(code).players;
  const felt = page.getByLabel('Blackjack table', { exact: true });
  await expect(felt.locator('.player-seat')).toHaveCount(hands.length);
  for (const player of hands) {
    const seat = felt.getByRole('article', { name: new RegExp(`^${player.name}(,|$)`) });
    await expect(seat.locator('.playing-card')).toHaveCount(player.hand.length);
    for (const card of player.hand) await expect(seat.getByLabel(`${card.rank} of ${{ S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[card.suit]}`, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.rival-hands')).toHaveCount(0);
  await expect(page.locator('.gameplay-page > .table-details, .gameplay-page > .locked-settings, .gameplay-page > .party-bank')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/gameplay-all-hands-desktop.png', fullPage: true });
  for (let i = 0; table.view(code).phase === 'PLAYER_TURN' && i < hands.length; i++) {
    const active = table.view(code).activePlayerId;
    const index = hands.findIndex(player => player.id === active);
    await pages[index].getByRole('button', { name: /^Stand/ }).click();
  }
  table.advance(1000);
  await expect(page.getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  table.advance(4000);
  await expect(page.getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  const initialY = await tableY(page);
  await expect(page.getByRole('button', { name: 'View Duels', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open bounty board', exact: false })).toHaveCount(0);
  await expect(page.locator('.compact-duels').getByLabel('Challenge a friend')).toBeEnabled();
  await page.getByRole('combobox', { name: 'Bounty target', exact: true }).selectOption(hands[2].id);
  await page.getByRole('button', { name: /^Fund Bounty/ }).click();
  await expect(page.locator('.compact-bounties .bounty-card')).toContainText('Casey');

  await page.getByRole('combobox', { name: 'Deal partner', exact: true }).selectOption(hands[1].id);
  await page.getByRole('button', { name: /^Offer Split or Steal/ }).click();
  await expect(pages[1].getByRole('button', { name: 'Accept Deal', exact: true })).toBeEnabled();
  expect(Math.abs(await tableY(page) - initialY)).toBeLessThan(2);
  const defenderY = await tableY(pages[1]);
  await pages[1].getByRole('button', { name: 'Accept Deal', exact: true }).click();
  await expect(pages[1].getByRole('button', { name: 'Lock Split', exact: true })).toBeEnabled();
  expect(Math.abs(await tableY(pages[1]) - defenderY)).toBeLessThan(2);
  await pages[0].getByRole('button', { name: 'Lock Split', exact: true }).click();
  await pages[1].getByRole('button', { name: 'Lock Split', exact: true }).click();
  table.advance(2000);
  await expect(page.getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  await pages[2].getByLabel('Challenge a friend').selectOption(hands[3].id);
  await pages[2].getByRole('button', { name: /^Send Duel Invite/ }).click();
  await pages[3].getByLabel('Duel game').selectOption('CONNECT4');
  await pages[3].getByRole('button', { name: 'Accept Duel', exact: true }).click();
  await expect(page.getByLabel('Connect 4 board')).toBeVisible();
  expect(Math.abs(await tableY(page) - initialY)).toBeLessThan(2);
  const duelBox = await page.getByLabel('Connect 4 board').boundingBox();
  const tableBox = await felt.boundingBox();
  expect(duelBox!.y).toBeGreaterThan(tableBox!.y + tableBox!.height);
  expect(errors).toEqual([]);
});

test('earned Chaos uses illustrated closed cards, brief hover help and funded play; urgent timers respect reduced motion', async ({ table }) => {
  const { pages, code } = await party(table, 2);
  const page = pages[0];
  await page.locator('.lobby-achievements > summary').click();
  await page.getByText('Explore all eight badges', { exact: true }).click();
  await expect(page.locator('.badge-collection .badge-art')).toHaveCount(8);
  await expect(page.locator('.badge-collection .badge-art').first()).toHaveCSS('background-image', /badges-atlas\.png/);
  const dimensions = await page.evaluate(async () => Promise.all(['/art/chaos-atlas.png', '/art/badges-atlas.png'].map(src => new Promise<number>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image.naturalWidth); image.onerror = () => reject(new Error(`Artwork failed: ${src}`)); image.src = src;
  }))));
  expect(dimensions.every(width => width >= 512)).toBe(true);
  await start(table, pages);
  table.server.manager.e.randomIndex = () => 0;
  table.advance(15000);
  // Broadcast the manual clock jump without leaving a wager in the skipped round.
  await page.getByRole('button', { name: /^Place Bet/ }).click();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  const timer = page.locator('.main-phase-timer .countdown');
  await expect(timer).toHaveClass(/countdown-urgent/);
  await expect(timer).toHaveAttribute('data-seconds', /[0-5]/);
  expect(Number.parseFloat(await timer.locator('strong').evaluate(element => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(24);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(timer).toHaveCSS('animation-name', 'none');
  table.advance(5000);
  await expect(page.getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  table.advance(24000);
  await expect(page.getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  expect(table.view(code).party!.chaos.inventories[0].cards[0].kind).toBe('DOUBLE_DOWN');
  const card = page.getByLabel('Double Down Chaos card', { exact: true });
  await expect(card).not.toHaveAttribute('open');
  await expect(card.locator('.chaos-card-detail')).not.toBeVisible();
  await expect(card.locator('.chaos-art')).toHaveCSS('background-image', /chaos-atlas\.png/);
  await card.locator('summary').hover();
  await expect(card.locator('.chaos-hover-description')).toBeVisible();
  expect((await card.locator('.chaos-hover-description').innerText()).length).toBeLessThan(180);
  await card.locator('summary').click();
  await expect(card.locator('.chaos-card-detail')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Play Double Down Chaos', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Place Bet/ }).click();
  const before = table.view(code).players[0].wager;
  await card.getByRole('button', { name: 'Play Double Down Chaos', exact: true }).click();
  expect(table.view(code).players[0].wager).toBe(before * 2);
  await expect(page.locator('#personal-pot-total')).toContainText(String(before * 2));
  await expect(page.locator('.chaos-multiplier')).toContainText(`${before * 2} chips`);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/gameplay-chaos-compact-mobile.png', fullPage: true });
});
