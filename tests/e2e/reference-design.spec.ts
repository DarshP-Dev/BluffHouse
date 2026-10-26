import { test, expect, scriptedShoe } from '../fixtures/browser.js';
import type { Page, Locator } from '@playwright/test';

const desktop = { width: 1672, height: 941 };
const mobile = { width: 390, height: 844 };

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, overflowing: Array.from(document.querySelectorAll('main *')).filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })) }));
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
}

async function leftToRight(left: Locator, center: Locator, right: Locator) {
  const boxes = await Promise.all([left.boundingBox(), center.boundingBox(), right.boundingBox()]);
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 1);
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 1);
}

async function controlFits(page: Page, control: Locator) {
  await page.evaluate(() => scrollTo(0, 0));
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

async function tableFirstDecision(page: Page, control: Locator) {
  await page.evaluate(() => scrollTo(0, 0));
  await expect(control).toHaveCount(1);
  await expect(control).toBeEnabled();
  const felt = page.getByLabel('Blackjack table', { exact: true });
  const originalY = await felt.evaluate(element => element.getBoundingClientRect().top + scrollY);
  const feltBox = await felt.boundingBox();
  const controlBox = await control.boundingBox();
  expect(controlBox!.y).toBeGreaterThanOrEqual(feltBox!.y + feltBox!.height);
  const jump = page.getByRole('link', { name: 'Jump to current decision', exact: true });
  await jump.focus();
  await jump.press('Enter');
  await expect(page.locator('#current-decision')).toBeFocused();
  await expect(control).toBeInViewport({ ratio: 1 });
  expect(Math.abs(await felt.evaluate(element => element.getBoundingClientRect().top + scrollY) - originalY)).toBeLessThan(2);
}

async function captureBothSizes(page: Page, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await expect.poll(() => page.evaluate(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/reference-${name}-desktop.png`, fullPage: false });
  await page.setViewportSize(mobile);
  await page.evaluate(() => scrollTo(0, 0));
  await noHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/reference-${name}-mobile.png`, fullPage: false });
  await page.setViewportSize(desktop);
  await page.evaluate(() => scrollTo(0, 0));
}

test('reference lounge, lobby, sealed auction and live dashboard retain usable real multiplayer controls at desktop and mobile sizes', async ({ table }) => {
  test.setTimeout(90000);
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const page = pages[0];
  const errors: string[] = [];
  for (const player of pages) {
    player.on('pageerror', error => errors.push(error.message));
    player.on('console', message => { if (message.type() === 'error' && !message.location().url.includes('/socket.io/')) errors.push(`Console error: ${message.text()}`); });
    player.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    await player.emulateMedia({ reducedMotion: 'reduce' });
  }
  await page.setViewportSize(desktop);

  await expect(page.getByRole('button', { name: 'Quick Play', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Host Room', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Join Room', exact: true })).toBeEnabled();
  await leftToRight(page.locator('.lounge-sidebar'), page.locator('.lounge-hero'), page.locator('.lounge-info'));
  await captureBothSizes(page, 'lounge');
  for (const name of ['Leaderboard', 'Bounties', 'Duels', 'Chaos Cards', 'Profile']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }

  const code = await table.host(page, 'QueenAce');
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'CardShark', 'LuckyLuna', 'TiltedTom'][i]);
  await page.getByRole('button', { name: 'Party', exact: true }).click();
  for (const player of pages) await player.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your table', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeEnabled();
  await expect(page.locator('.lobby-seat:not(.empty-seat)')).toHaveCount(4);
  await expect(page.locator('.empty-seat')).toHaveCount(table.view(code).settings.maxPlayers - 4);
  await leftToRight(page.locator('.lobby-profile'), page.locator('.guest-list'), page.locator('.lobby-aside'));
  await controlFits(page, page.getByRole('button', { name: 'Start Game', exact: true }));
  await captureBothSizes(page, 'lobby');
  const chatDraft = 'Keep this draft as the table changes.';
  await page.getByRole('textbox', { name: 'Message to this room', exact: true }).fill(chatDraft);
  await page.getByRole('textbox', { name: 'Message to this room', exact: true }).evaluate(element => { element.dataset.persistentComposer = 'yes'; });

  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bid for the House', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message to this room', exact: true })).toHaveValue(chatDraft);
  await expect(page.getByRole('textbox', { name: 'Message to this room', exact: true })).toHaveAttribute('data-persistent-composer', 'yes');
  await page.getByRole('button', { name: 'House bid 150 chips', exact: true }).click();
  await page.getByRole('button', { name: /^Submit House Bid/ }).click();
  await pages[1].getByRole('button', { name: 'House bid 300 chips', exact: true }).click();
  await pages[1].getByRole('button', { name: /^Submit House Bid/ }).click();
  for (const player of pages.slice(2)) await player.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  await expect(page.locator('.auction-own')).toContainText('150 chips reserved');
  await expect(page.getByRole('region', { name: 'Room chat', exact: true })).toHaveCount(1);
  await expect(page.locator('.auction-bid').nth(1)).toContainText('Bid sealed');
  await expect(page.locator('.auction-bid').nth(1)).not.toContainText('300 chips');
  await expect(pages[1].locator('.auction-bid').first()).toContainText('Bid sealed');
  await expect(page.getByRole('button', { name: /^Update House Bid/ })).toHaveCount(1);
  await controlFits(page, page.getByRole('button', { name: /^Update House Bid/ }));
  await captureBothSizes(page, 'auction');
  table.advance(20000);
  await expect(page.getByRole('heading', { name: 'CardShark is the House.', exact: true })).toBeVisible();
  await expect(page.locator('.auction-bid').nth(1)).toContainText('300 chips');

  await page.getByRole('textbox', { name: 'Message to this room', exact: true }).focus();
  table.advance(2000);
  await expect(page.getByRole('textbox', { name: 'Message to this room', exact: true })).toHaveValue(chatDraft);
  await expect(page.getByRole('textbox', { name: 'Message to this room', exact: true })).toHaveAttribute('data-persistent-composer', 'yes');
  await expect(page.getByRole('textbox', { name: 'Message to this room', exact: true })).toBeFocused();
  table.server.manager.e.shoe=()=>scriptedShoe(['10','10','10','10','6','8','9','7','3','10','2']);
  for (const index of [0,2,3]) await pages[index].getByRole('button', { name: /^Place Bet/ }).click();
  table.advance(26000);
  await expect(page.getByRole('heading', { name: 'Player turns', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Hit/ })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Your game controls', exact: true })).toHaveCount(1);
  await expect(page.locator('.felt-table .local-seat .playing-card')).toHaveCount(2);
  await leftToRight(page.locator('.dashboard-left'), page.locator('.game-column'), page.locator('.table-rail'));
  await expect(page.getByRole('region', { name: 'Room chat', exact: true })).toHaveCount(1);
  await expect(page.locator('.felt-table .player-seat')).toHaveCount(3);
  await expect(pages[1].getByLabel('Dealer hand',{exact:true}).getByLabel('7 of spades',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Dealer hand',{exact:true}).getByLabel('Face-down card',{exact:true})).toHaveCount(1);
  await expect(page.locator('.rival-hands')).toHaveCount(0);
  await tableFirstDecision(page, page.getByRole('button', { name: /^Hit/ }));
  await tableFirstDecision(page, page.getByRole('button', { name: /^Call My Bluff/ }));
  await captureBothSizes(page, 'dashboard');

  await expect(page.getByRole('link', { name: /^View Duels/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Open bounty board/ })).toHaveCount(0);
  const inlineDuels = page.locator('.compact-duels');
  await expect(inlineDuels.getByRole('combobox', { name: 'Challenge a friend', exact: true })).toBeDisabled();
  await expect(inlineDuels.getByRole('button', { name: 'Send Duel Invite', exact: true })).toBeDisabled();
  await expect(page.locator('.compact-bounties')).toContainText('No active bounties.');
  await expect(page.locator('.compact-bounties .bounty-list')).toHaveCount(1);
  await expect(page.locator('.compact-chaos .chaos-empty')).toContainText('No cards held.');

  await page.setViewportSize(mobile);
  await page.evaluate(() => scrollTo(0, 0));
  const hit = page.getByRole('button', { name: /^Hit/ });
  await expect(hit).toHaveCount(1);
  await tableFirstDecision(page, hit);
  await hit.click();
  await expect(page.locator('.felt-table .local-seat .playing-card')).toHaveCount(3);
  expect(table.view(code).players[0].value?.total).toBe(19);
  await page.getByRole('button', { name: /^Stand/ }).click();
  await expect.poll(() => table.view(code).players[0].status).toBe('stood');
  await pages[2].setViewportSize(desktop);
  await pages[2].getByRole('button', { name: /^Call My Bluff/ }).click();
  await page.setViewportSize(desktop);
  const accept = page.getByRole('button', { name: /^Accept Challenge/ });
  await expect(accept).toBeEnabled();
  await tableFirstDecision(page, accept);
  const decisionBox = await page.locator('#current-decision').boundingBox();
  const feltBox = await page.locator('.felt-table').boundingBox();
  expect(decisionBox!.y).toBeGreaterThanOrEqual(feltBox!.y + feltBox!.height);
  await page.screenshot({ path: 'test-results/reference-challenge-desktop.png' });
  await accept.click();
  await expect.poll(() => table.view(code).phase).toBe('BLUFF_REVEAL');
  expect(errors).toEqual([]);
});
