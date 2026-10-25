import { test, expect, scriptedShoe, readyAndStart, type TableFixture } from '../fixtures/browser.js';
import type { Page, Locator } from '@playwright/test';

async function friends(table: TableFixture) {
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const errors: string[] = [];
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.location().url.includes('/socket.io/')) errors.push(`Console error: ${message.text()}`); });
    page.on('requestfailed', request => { if (!request.url().includes('/socket.io/')) errors.push(`Request failed: ${request.url()}`); });
    page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  }
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  return { pages, code, errors };
}
async function nearFold(page: Page, control: Locator) {
  await page.evaluate(() => scrollTo(0, 0));
  await expect(control).toHaveCount(1);
  await expect(control).toBeEnabled();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function post(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'Message to this room', exact: true });
  await input.fill(text);
  await input.press('Enter');
  await expect(input).toHaveValue('');
}

test('mobile Classic decisions show the real hand once beside legal controls, support keyboard jump and preserve chat focus', async ({ table }) => {
  const { pages, code, errors } = await friends(table);
  const page = pages[0];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await readyAndStart(pages);
  await nearFold(page, page.getByRole('button', { name: /^Place Bet/ }));
  await expect(page.getByRole('region', { name: 'Your game controls', exact: true })).toHaveCount(1);
  for (const guest of pages) await guest.getByRole('button', { name: /^Place Bet/ }).click();
  const draft = page.getByRole('textbox', { name: 'Message to this room', exact: true });
  await draft.fill('Keep this draft while the cards arrive');
  await draft.focus();
  table.advance(21000);
  await expect(page.getByRole('heading', { name: 'Player turns', exact: true })).toBeVisible();
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('Keep this draft while the cards arrive');
  await nearFold(page, page.getByRole('button', { name: /^Hit/ }));
  const own = page.getByLabel('Your current Blackjack hand', { exact: true });
  await expect(own.locator('.playing-card')).toHaveCount(2);
  await expect(own).toContainText('16 · hard');
  await expect(page.getByRole('button', { name: /^Hit/ })).toHaveCount(1);
  const jump = page.getByRole('link', { name: 'Jump to current decision', exact: true });
  await jump.focus();
  await jump.press('Enter');
  await expect(page.locator('#current-decision')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Hit/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(own.locator('.playing-card')).toHaveCount(3);
  expect(table.view(code).players[0].value?.total).toBe(19);
  expect(await page.getByRole('button', { name: /^Hit/ }).evaluate(element => getComputedStyle(element).transitionDuration)).toBe('1e-05s');
  await page.getByRole('button', { name: /^Call My Bluff/ }).click();
  await pages[1].setViewportSize({ width: 390, height: 844 });
  await nearFold(pages[1], pages[1].getByRole('button', { name: /^Accept Challenge/ }));
  await pages[1].screenshot({ path: 'test-results/polish-bluff-mobile.png', fullPage: false });
  await pages[1].getByRole('button', { name: /^Accept Challenge/ }).click();
  await expect.poll(() => table.view(code).phase).toBe('BLUFF_REVEAL');
  expect(errors).toEqual([]);
});

test('chat follows only near the latest message, keeps reading position and draft through errors and reconnect', async ({ table }) => {
  const { pages, code, errors } = await friends(table);
  const sender = pages[0], reader = pages[1];
  await reader.setViewportSize({ width: 390, height: 844 });
  for (let i = 0; i < 7; i++) {
    table.advance(2000);
    await post(sender, `Message ${i}: ${'A long message to give older conversation room to scroll. '.repeat(3)}`);
  }
  const log = reader.getByRole('log', { name: 'Room messages', exact: true });
  await expect(log.locator('.chat-message')).toHaveCount(7);
  await expect.poll(() => log.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4);
  await log.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  const draft = reader.getByRole('textbox', { name: 'Message to this room', exact: true });
  await draft.fill('My unsent draft');
  await draft.focus();
  const beforeScroll = await reader.evaluate(() => scrollY);
  table.advance(2000);
  await post(sender, 'A new message while you read the beginning.');
  await expect(reader.getByRole('button', { name: 'Show latest messages', exact: true })).toBeVisible();
  expect(await log.evaluate(element => element.scrollTop)).toBe(0);
  expect(await reader.evaluate(() => scrollY)).toBe(beforeScroll);
  await expect(draft).toBeFocused();
  const latest = reader.getByRole('button', { name: 'Show latest messages', exact: true });
  await latest.focus();
  await latest.press('Enter');
  await expect.poll(() => log.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4);
  await expect(latest).toHaveCount(0);
  table.advance(2000);
  await post(reader, 'First immediate message');
  await draft.fill('Keep this rejected draft');
  await draft.press('Enter');
  await expect(reader.locator('.chat-error')).toContainText('Your draft is kept');
  await expect(draft).toHaveValue('Keep this rejected draft');
  await reader.context().setOffline(true);
  const readerId = table.view(code).players[1].id;
  [...table.server.io.sockets.sockets.values()].find(socket => socket.data.guest.id === readerId)!.conn.close();
  await expect(reader.getByRole('heading', { name: 'Reconnecting to Bluff House…', exact: true })).toBeVisible();
  await expect(draft).toBeDisabled();
  await reader.context().setOffline(false);
  await expect(reader.locator('.connection-overlay')).toHaveCount(0);
  await expect(draft).toBeEnabled();
  await expect(draft).toHaveValue('Keep this rejected draft');
  expect(table.view(code).players).toHaveLength(4);
  expect(errors).toEqual([]);
});

test('mobile incoming deals and private choices lead the social table without duplicate actions', async ({ table }) => {
  const { pages, code, errors } = await friends(table);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(46000);
  await expect(pages[0].getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  await pages[0].getByRole('combobox', { name: 'Deal partner', exact: true }).selectOption(table.view(code).players[1].id);
  await pages[0].getByRole('button', { name: /^Offer Split or Steal/ }).click();
  await pages[1].setViewportSize({ width: 390, height: 844 });
  await nearFold(pages[1], pages[1].getByRole('button', { name: 'Accept Deal', exact: true }));
  await pages[1].getByRole('button', { name: 'Accept Deal', exact: true }).click();
  await nearFold(pages[1], pages[1].getByRole('button', { name: 'Lock Split', exact: true }));
  await expect(pages[1].getByRole('button', { name: 'Lock Steal', exact: true })).toHaveCount(1);
  await pages[1].screenshot({ path: 'test-results/polish-deal-mobile.png', fullPage: false });
  await pages[1].getByRole('button', { name: 'Lock Split', exact: true }).click();
  await expect(pages[1].locator('.deal-private')).toContainText('Your locked choice: split');
  await pages[1].reload();
  await expect(pages[1].locator('.deal-private')).toContainText('Your locked choice: split');
  await expect(pages[1].getByRole('button', { name: 'Lock Steal', exact: true })).toBeDisabled();
  await pages[0].getByRole('button', { name: 'Lock Split', exact: true }).click();
  expect(errors).toEqual([]);
});

test('mobile Shadow Draw shows the viewer hand and legal choice before every other hand and keeps replay reachable', async ({ table }) => {
  const { pages, code, errors } = await friends(table);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  await pages[0].getByRole('button', { name: /^Submit House Bid/ }).click();
  for (const page of pages.slice(1)) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  table.advance(44000);
  table.advance(44000);
  table.server.manager.e.shoe = () => scriptedShoe(['10', '10', '10', '10', '9', '8', '7', '6']);
  table.advance(24000);
  for (let i = 0; i < 4; i++) {
    const page = pages[i];
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('heading', { name: 'Shadow Draw', exact: true })).toBeVisible();
    await nearFold(page, page.getByRole('button', { name: 'Stand and Lock', exact: true }));
    const hand = page.getByLabel(`Shadow hand for ${['Alex', 'Blair', 'Casey', 'Drew'][i]}`, { exact: true });
    await expect(hand).toHaveCount(1);
    await expect(hand.locator('.playing-card:not(.card-hidden)')).toHaveCount(2);
    const handBox = await hand.boundingBox();
    expect(handBox!.y + handBox!.height).toBeLessThanOrEqual(844);
    if (i === 0) await page.screenshot({ path: 'test-results/polish-shadow-mobile.png', fullPage: false });
    await page.getByRole('button', { name: 'Stand and Lock', exact: true }).click();
  }
  for (const page of pages) await page.getByRole('button', { name: 'Pass Declaration', exact: true }).click();
  table.advance(2000);
  await expect(pages[0].getByRole('button', { name: /^Return to Lobby/ })).toBeVisible();
  await nearFold(pages[0], pages[0].getByRole('button', { name: /^Return to Lobby/ }));
  expect(table.view(code).phase).toBe('RESULTS');
  expect(errors).toEqual([]);
});
