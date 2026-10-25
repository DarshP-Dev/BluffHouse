import { test, expect, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';
import { defaultSettings } from '@bluff-house/shared';

async function quick(table: TableFixture, page: Page, username: string, preset: 'CLASSIC' | 'PARTY' | 'PARTY_6' = 'CLASSIC') {
  await page.getByRole('button', { name: 'Quick Play', exact: true }).click();
  await page.getByRole('textbox', { name: 'Guest name', exact: true }).fill(username);
  await page.getByRole('combobox', { name: 'Quick Play preset', exact: true }).selectOption(preset);
  await page.getByRole('button', { name: 'Find a Table', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your table', exact: true })).toBeVisible();
  return (await page.locator('.room-code strong').textContent())!;
}

test('Quick Play matches public default lobbies, safely names collisions and excludes private, full and active tables', async ({ table }) => {
  const privatePage = await table.newPlayer();
  const privateCode = await table.host(privatePage, 'PrivateHost');
  expect(table.view(privateCode).visibility).toBe('PRIVATE');
  const pages: Page[] = [await table.newPlayer()];
  const code = await quick(table, pages[0], 'Alex');
  expect(code).not.toBe(privateCode);
  pages.push(await table.newPlayer());
  expect(await quick(table, pages[1], 'Alex')).toBe(code);
  expect(table.view(code).players.map(player => player.name)).toEqual(['Alex', 'Alex-2']);
  expect(table.view(code)).toMatchObject({ visibility: 'PUBLIC', mode: 'CLASSIC', roundLimit: 3, finaleEnabled: false, settings: defaultSettings('CLASSIC') });
  await expect(pages[0].locator('.room-label')).toContainText('PUBLIC ROOM');
  await expect(pages[0].getByRole('combobox', { name: 'Player capacity', exact: true })).toBeEnabled();
  for (let i = 2; i < 6; i++) {
    pages.push(await table.newPlayer());
    expect(await quick(table, pages[i], `Guest${i + 1}`)).toBe(code);
  }
  await expect(pages[0].locator('.lobby-seat')).toHaveCount(6);
  expect(table.view(code).players).toHaveLength(6);
  const activeHost = await table.newPlayer();
  const activeCode = await quick(table, activeHost, 'NextHost');
  expect(activeCode).not.toBe(code);
  expect(activeCode).not.toBe(privateCode);
  const activeGuest = await table.newPlayer();
  expect(await quick(table, activeGuest, 'NextGuest')).toBe(activeCode);
  for (const page of [activeHost, activeGuest]) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await activeHost.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(activeHost.getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  const newcomer = await table.newPlayer();
  const nextCode = await quick(table, newcomer, 'Newcomer');
  expect([code, privateCode, activeCode]).not.toContain(nextCode);
  expect(table.view(nextCode)).toMatchObject({ visibility: 'PUBLIC', phase: 'LOBBY', mode: 'CLASSIC' });
  const activeInstance = table.view(activeCode).instanceId;
  await activeGuest.reload();
  await expect(activeGuest.getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  expect(table.view(activeCode).instanceId).toBe(activeInstance);
  expect(table.view(activeCode).players).toHaveLength(2);
  await pages[0].setViewportSize({ width: 390, height: 844 });
  expect(await pages[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('host Party settings preserve sparse occupied seats, enforce dependencies and stay locked through real play and refresh', async ({ table }) => {
  const pages = await Promise.all(Array.from({ length: 6 }, () => table.newPlayer()));
  const code = await quick(table, pages[0], 'Alex', 'PARTY_6');
  for (let i = 1; i < pages.length; i++) expect(await quick(table, pages[i], ['', 'Blair', 'Casey', 'Drew', 'Elliot', 'Finley'][i], 'PARTY_6')).toBe(code);
  expect(table.view(code)).toMatchObject({ roundLimit: 6, finaleEnabled: true, settings: defaultSettings('PARTY'), visibility: 'PUBLIC' });
  const finley = table.view(code).players.find(player => player.name === 'Finley')!;
  expect(finley.seat).toBe(5);
  const otherPreset = await table.newPlayer();
  expect(await quick(table, otherPreset, 'OtherPreset', 'PARTY')).not.toBe(code);
  await expect(pages[5].getByRole('button', { name: 'Apply Room Settings', exact: true })).toBeDisabled();
  await expect(pages[5].getByRole('checkbox', { name: 'House auction and commissions', exact: true })).toBeDisabled();
  for (const page of pages.slice(1, 5)) {
    await page.getByRole('button', { name: 'Leave Room', exact: false }).click();
    await expect(page.getByRole('button', { name: 'Host Room', exact: true })).toBeVisible();
  }
  await pages[5].getByRole('button', { name: 'Ready Up', exact: true }).click();
  const beforeLobby = table.view(code).lobbyId;
  await pages[0].getByRole('combobox', { name: 'Player capacity', exact: true }).selectOption('2');
  await pages[0].getByRole('checkbox', { name: 'House auction and commissions', exact: true }).uncheck();
  await expect(pages[0].locator('.settings-dependency')).toContainText('House overthrow requires');
  await expect(pages[0].getByRole('checkbox', { name: 'House overthrow', exact: true })).toBeChecked();
  await expect(pages[0].getByRole('button', { name: 'Apply Room Settings', exact: true })).toBeDisabled();
  await pages[0].getByRole('checkbox', { name: 'House overthrow', exact: true }).uncheck();
  await pages[0].getByRole('checkbox', { name: 'Direct duels', exact: true }).uncheck();
  await expect(pages[0].locator('.settings-dependency')).toContainText('Bounties require direct duels');
  for (const label of ['Bounties', 'Chaos cards', 'Split or Steal deals', 'Ordinary Double Down', 'Additional bluff claims']) await pages[0].getByRole('checkbox', { name: label, exact: true }).uncheck();
  await pages[0].getByRole('combobox', { name: 'Table visibility', exact: true }).selectOption('PRIVATE');
  await pages[0].getByRole('button', { name: 'Apply Room Settings', exact: true }).click();
  await expect(pages[5].getByRole('button', { name: 'Ready Up', exact: true })).toBeVisible();
  expect(table.view(code).lobbyId).not.toBe(beforeLobby);
  expect(table.view(code).settings).toEqual({ maxPlayers: 2, house: false, duels: false, overthrow: false, chaos: false, bounties: false, deals: false, doubleDown: false, extraClaims: false });
  expect(table.view(code).players.map(player => player.seat)).toEqual([0, 5]);
  for (const page of [pages[0], pages[5]]) {
    await expect(page.locator('.lobby-seat')).toHaveCount(2);
    await expect(page.locator('.lobby-seat').filter({ hasText: 'Finley' })).toBeVisible();
    await expect(page.locator('.party-description')).toContainText('House auction and commissions are disabled');
  }
  const nextPublic = await table.newPlayer();
  expect(await quick(table, nextPublic, 'NewPublic', 'PARTY_6')).not.toBe(code);
  await pages[0].setViewportSize({ width: 390, height: 844 });
  expect(await pages[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[0].getByRole('region', { name: 'Room settings', exact: true }).screenshot({ path: 'test-results/party-settings-mobile.png' });
  for (const page of [pages[0], pages[5]]) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  for (const page of [pages[0], pages[5]]) {
    await expect(page.getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
    await expect(page.getByLabel('Locked match settings', { exact: true })).toContainText('Private table · 2 seats');
    await expect(page.getByRole('region', { name: 'Room settings', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'House auction', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Bounty board', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Chaos cards', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Split or Steal', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Place Bet', exact: false }).click();
  }
  table.advance(21000);
  await expect(pages[0].getByRole('heading', { name: 'Player turns', exact: true })).toBeVisible();
  await pages[0].getByRole('button', { name: /^Stand/ }).click();
  await pages[5].getByRole('button', { name: /^Stand/ }).click();
  table.advance(700);
  await expect(pages[0].getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  table.advance(4000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  expect(table.view(code).round).toBe(2);
  const settings = table.view(code).settings;
  await pages[5].reload();
  await expect(pages[5].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  expect(table.view(code).settings).toEqual(settings);
  expect(table.view(code).players.map(player => player.seat)).toEqual([0, 5]);
  await expect(pages[5].getByLabel('Locked match settings', { exact: true })).toContainText('Private table · 2 seats');
});
