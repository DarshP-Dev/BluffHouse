import { test, expect, scriptedShoe, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';

async function fundedFinale(table: TableFixture, houseIndex = 0) {
  table.server.manager.e.randomIndex = () => 0;
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  const finale = pages[0].getByRole('checkbox', { name: 'Shadow Draw finale', exact: true });
  await expect(finale).toBeChecked();
  await pages[1].getByRole('button', { name: 'Ready Up' }).click();
  await finale.click();
  await expect(finale).not.toBeChecked();
  await expect(pages[1].getByRole('button', { name: 'Ready Up' })).toBeVisible();
  await finale.click();
  await expect(finale).toBeChecked();
  await expect(pages[1].getByRole('checkbox', { name: 'Shadow Draw finale', exact: true })).toBeDisabled();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up' }).click();
  await pages[0].getByRole('button', { name: 'Start Game' }).click();
  await pages[houseIndex].getByRole('button', { name: 'House bid 300 chips', exact: true }).click();
  await pages[houseIndex].getByRole('button', { name: 'Submit House Bid', exact: false }).click();
  for (let i = 0; i < pages.length; i++) if (i !== houseIndex) await pages[i].getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  table.advance(44000);
  await expect.poll(() => table.view(code).round).toBe(2);
  table.advance(44000);
  await expect.poll(() => table.view(code).round).toBe(3);
  table.server.manager.e.shoe = () => scriptedShoe(['10', '10', '10', '10', '9', '8', '7', '6', '10']);
  table.advance(24000);
  for (const page of pages) await expect(page.getByRole('heading', { name: 'Shadow Draw', exact: true })).toBeVisible();
  expect(table.view(code).party!.shadow!.pot).toBe(300);
  expect(table.view(code).party!.shadow!.entrantIds).toEqual(table.view(code).players.map(player => player.id));
  return { pages, code };
}
async function drawThenStand(pages: Page[]) {
  await pages[0].getByRole('button', { name: 'Take Shadow Draw', exact: true }).click();
  for (const page of pages) await expect(page.getByRole('button', { name: /^Declare / })).toHaveCount(0);
  await pages[0].reload();
  await expect(pages[0].getByLabel('Shadow hand for Alex', { exact: true })).toContainText('Real total 29 · bust');
  for (const page of pages.slice(1)) await page.getByRole('button', { name: 'Stand and Lock', exact: true }).click();
  await expect(pages[0].getByRole('heading', { name: 'Make your declaration', exact: true })).toBeVisible();
}
async function declare(page: Page, total: number) {
  await page.getByRole('combobox', { name: 'Declared total', exact: true }).selectOption(String(total));
  await page.getByRole('button', { name: `Declare ${total}`, exact: true }).click();
}

test('a private real-29 bust declares 21 unchallenged and wins the funded Vault without retroactive disqualification', async ({ table }) => {
  const { pages, code } = await fundedFinale(table);
  const ids = table.view(code).players.map(player => player.id);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  for (const viewer of ids) {
    const shadow = table.server.manager.snapshot(viewer)!.party!.shadow!;
    for (const entrant of shadow.entrants) {
      expect(entrant.hand.every(card => entrant.playerId === viewer ? !!card : card === null)).toBe(true);
      if (entrant.playerId !== viewer) {
        expect(entrant.value).toBeNull();
        for (const field of ['score', 'baseTotal', 'disqualified', 'claimBonus', 'challengePoints']) expect(entrant).not.toHaveProperty(field);
      }
    }
  }
  await drawThenStand(pages);
  for (const page of pages.slice(1)) {
    const alex = page.getByLabel('Shadow hand for Alex', { exact: true });
    await expect(alex.getByLabel('Face-down card', { exact: true })).toHaveCount(3);
    await expect(alex).not.toContainText('29');
  }
  await declare(pages[0], 21);
  for (const page of pages) await expect(page.getByLabel('Open Shadow claim')).toContainText('Alex declares 21');
  for (const viewer of ids.slice(1)) {
    const shadow = table.server.manager.snapshot(viewer)!.party!.shadow!;
    expect(shadow.entrants[0].value).toBeNull();
    expect(shadow.entrants[0].hand).toEqual([null, null, null]);
    expect(shadow.claim).toMatchObject({ declaredTotal: 21, status: 'open' });
    expect(shadow.claim).not.toHaveProperty('truthful');
  }
  await pages[2].setViewportSize({ width: 390, height: 844 });
  expect(await pages[2].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[2].getByRole('heading', { name: 'Call the claim', exact: true }).click();
  await pages[2].screenshot({ path: 'test-results/shadow-private-claim-mobile.png', fullPage: true });
  table.advance(8000);
  for (const page of pages.slice(1)) await page.getByRole('button', { name: 'Pass Declaration', exact: true }).click();
  await expect.poll(() => table.view(code).phase).toBe('SHADOW_RESULT');
  const final = table.view(code).party!.shadow!;
  expect(final.winnerIds).toEqual([ids[0]]);
  expect(final.awards).toEqual([{ playerId: ids[0], amount: 300 }]);
  expect(final.entrants[0]).toMatchObject({ value: { total: 29, bust: true }, disqualified: false, baseTotal: 21, claimBonus: 1, score: 22 });
  expect(final.claims[0].status).toBe('unchallenged');
  expect(final.vaultThiefIds).toEqual([ids[0]]);
  expect(table.view(code).party!.vault).toBe(0);
  for (const page of pages) {
    await expect(page.locator('.shadow-settlement')).toContainText('Alex wins the Vault');
    await expect(page.getByLabel('Shadow hand for Alex', { exact: true })).toContainText('Real total 29 · bust');
    await expect(page.getByLabel('Shadow hand for Alex', { exact: true })).toContainText('22 contest points');
  }
  await pages[0].getByRole('heading', { name: 'The Vault is won', exact: true }).click();
  await pages[0].screenshot({ path: 'test-results/shadow-accepted-lie-winner.png', fullPage: true });
  table.advance(2000);
  await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  expect(table.view(code).players.map(player => player.balance)).toEqual([1000, 1000, 1000, 1000]);
  expect(table.view(code).party!.transfers.filter(transfer => transfer.kind === 'shadow_award')).toHaveLength(1);
  await pages[0].reload();
  await expect(pages[0].locator('.shadow-settlement')).toContainText('+300 chips');
  expect(table.view(code).party!.transfers.filter(transfer => transfer.kind === 'shadow_award')).toHaveLength(1);
  await pages[0].getByRole('button', { name: 'Return to Lobby', exact: false }).click();
  expect(table.view(code).party).toBeNull();
  await expect(pages[0].getByRole('checkbox', { name: 'Shadow Draw finale', exact: true })).toBeChecked();
  expect(errors).toEqual([]);
});

test('the House calls a false busted claim, exact truth penalizes and reveals its caller, and voluntary reveals remain public', async ({ table }) => {
  const { pages, code } = await fundedFinale(table, 1);
  const ids = table.view(code).players.map(player => player.id);
  await drawThenStand(pages);
  await declare(pages[0], 21);
  expect(table.view(code).party!.houseId).toBe(ids[1]);
  await expect(pages[1].getByRole('button', { name: 'Call This Claim', exact: true })).toBeEnabled();
  await pages[1].getByRole('button', { name: 'Call This Claim', exact: true }).click();
  for (const page of pages) {
    await expect(page.getByLabel('Shadow claim history')).toContainText('Caught lie');
    await expect(page.getByLabel('Shadow hand for Alex', { exact: true }).getByLabel('Face-down card', { exact: true })).toHaveCount(0);
  }
  await expect(pages[0].getByRole('button', { name: 'Call This Claim', exact: true })).toHaveCount(0);
  await pages[3].getByRole('button', { name: 'Reveal My Hand and Pass Declaration', exact: true }).click();
  for (const page of pages) await expect(page.getByLabel('Shadow hand for Drew', { exact: true })).toContainText('Real total 16');
  await declare(pages[1], 18);
  await expect(pages[0].getByRole('button', { name: 'Call This Claim', exact: true })).toBeDisabled();
  await pages[2].getByRole('button', { name: 'Call This Claim', exact: true }).click();
  for (const page of pages) {
    await expect(page.getByLabel('Shadow claim history')).toContainText('Exact truth');
    await expect(page.getByLabel('Shadow hand for Casey', { exact: true })).toContainText('Real total 17');
  }
  if (table.view(code).party!.shadow!.activePlayerId === ids[2]) await pages[2].getByRole('button', { name: 'Pass Declaration', exact: true }).click();
  await expect.poll(() => table.view(code).phase).toBe('SHADOW_RESULT');
  const shadow = table.view(code).party!.shadow!;
  expect(shadow.winnerIds).toEqual([ids[1]]);
  expect(shadow.entrants[0].disqualified).toBe(true);
  expect(shadow.entrants[1]).toMatchObject({ baseTotal: 18, claimBonus: 2, challengePoints: 2, score: 22 });
  expect(shadow.entrants[2]).toMatchObject({ revealed: true, challengePoints: -2, score: 15 });
  expect(shadow.entrants[3]).toMatchObject({ revealed: true, score: 16 });
  expect(shadow.claims.map(claim => claim.status)).toEqual(['caught', 'truthful']);
  table.advance(2000);
  await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  await expect(pages[1].locator('.shadow-settlement')).toContainText('Blair wins the Vault');
  expect(table.view(code).players.map(player => player.balance)).toEqual([1000, 1000, 1000, 1000]);
});
