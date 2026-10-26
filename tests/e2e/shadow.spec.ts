import { test, expect, scriptedShoe, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';

async function fundedFinale(table: TableFixture, zeroChipCaller = false) {
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  const finale = pages[0].getByRole('checkbox', { name: 'Shadow Blackjack finale', exact: true });
  await expect(finale).toBeChecked();
  await pages[1].getByRole('button', { name: 'Ready Up' }).click();
  await finale.click(); await expect(finale).not.toBeChecked();
  await expect(pages[1].getByRole('button', { name: 'Ready Up' })).toBeVisible();
  await finale.click(); await expect(finale).toBeChecked();
  await expect(pages[1].getByRole('checkbox', { name: 'Shadow Blackjack finale', exact: true })).toBeDisabled();
  await pages[0].getByLabel('Blackjack rounds', { exact: true }).fill('1');
  await pages[0].getByLabel('Betting timer (seconds)', { exact: true }).fill('5');
  await pages[0].getByLabel('Decision timer (seconds)', { exact: true }).fill('10');
  for (const label of ['House overthrow', 'Direct duels', 'Bounties', 'Chaos cards', 'Split or Steal deals', 'Additional bluff claims']) {
    const input = pages[0].getByRole('checkbox', { name: label, exact: true });
    if (await input.isChecked()) { await input.click(); await expect(input).not.toBeChecked(); }
  }
  await pages[0].getByRole('button', { name: 'Apply Room Settings', exact: true }).click();
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  await pages[3].getByRole('button', { name: 'House bid 300 chips', exact: true }).click();
  await pages[3].getByRole('button', { name: /^Submit House Bid/ }).click();
  for (const page of pages.slice(0, 3)) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  if (zeroChipCaller) {
    table.server.manager.e.shoe = () => scriptedShoe(['10', '10', '6', '7']);
    await pages[1].getByRole('button', { name: 'All-In', exact: true }).click();
    await pages[1].getByRole('button', { name: /^Place Bet/ }).click();
    table.advance(6000);
    await pages[1].getByRole('button', { name: 'Stand', exact: true }).click();
    await pages[3].getByRole('button', { name: 'Dealer Stand', exact: true }).click();
    expect(table.view(code).players[1].balance).toBe(0);
    table.advance(4000);
  } else table.advance(9000);
  await expect.poll(() => table.view(code).phase).toBe('SHADOW_BETTING');
  return { pages, code };
}
async function trueStand(page: Page) { await page.getByRole('button', { name: 'Declare True Total', exact: true }).click(); }

test('an owner-private busted bluff survives an uncalled21 and receives funded Blackjack and Vault awards once', async ({ table }) => {
  const { pages, code } = await fundedFinale(table);
  const errors: string[] = [];
  for (const page of pages) page.on('pageerror', error => errors.push(error.message));
  const ids = table.view(code).players.map(player => player.id);
  table.server.manager.e.shoe = () => scriptedShoe(['10', '10', '10', '10', '9', '8', '7', '6', '10']);
  await pages[0].getByRole('button', { name: /^Place Bet/ }).click();
  table.advance(5000);
  await expect(pages[0].getByRole('heading', { name: 'Shadow Blackjack', exact: true })).toBeVisible();
  expect(table.view(code).party!.shadow!.pot).toBe(300);
  for (const viewer of ids) {
    const view = table.server.manager.snapshot(viewer)!;
    for (const entrant of view.party!.shadow!.entrants) {
      expect(entrant.hand[0]).not.toBeNull();
      if (entrant.playerId !== viewer) {
        expect(entrant.hand.slice(1).every(card => card === null)).toBe(true);
        expect(entrant.value).toBeNull(); expect(entrant.acceptedBluff).toBeNull();
      }
    }
    expect(view.players.every(player => player.hand.length === 0 && player.value === null)).toBe(true);
    expect(view.dealer).toEqual([]);
  }
  await pages[0].getByRole('button', { name: 'Draw & Claim 21', exact: true }).click();
  await expect(pages[0].getByLabel('Shadow hand for Alex', { exact: true })).toContainText('29');
  const deadline = table.view(code).deadline;
  await pages[0].reload(); expect(table.view(code).deadline).toBe(deadline);
  for (const page of pages.slice(1)) {
    const alex = page.getByLabel('Shadow hand for Alex', { exact: true });
    await expect(alex.getByLabel('Face-down card', { exact: true })).toHaveCount(2);
    await expect(alex).not.toContainText('29');
  }
  for (const viewer of ids.slice(1)) {
    const view = table.server.manager.snapshot(viewer)!;
    expect(view.party!.shadow!.entrants[0].value).toBeNull();
    expect(view.party!.shadow!.entrants[0].hand.slice(1)).toEqual([null, null]);
    expect(view.party!.shadow!.claim).toMatchObject({ declaredTotal: 21, status: 'open' });
    expect(view.party!.shadow!.claim).not.toHaveProperty('truthful');
    expect(view.events.filter(event => event.kind === 'shadow').every(event => !event.text.includes('29'))).toBe(true);
  }
  await pages[2].setViewportSize({ width: 390, height: 844 });
  await pages[2].emulateMedia({ reducedMotion: 'reduce' });
  expect(await pages[2].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[2].screenshot({ path: 'test-results/shadow-private-claim-mobile.png', fullPage: true });
  table.advance(8000);
  for (const page of pages.slice(1)) await trueStand(page);
  await expect.poll(() => table.view(code).phase).toBe('SHADOW_RESULT');
  const final = table.view(code).party!.shadow!;
  expect(final.winnerIds).toEqual([ids[0]]);
  expect(final.awards).toEqual([{ playerId: ids[0], amount: 300 }]);
  expect(final.entrants[0]).toMatchObject({ value: { total: 29, bust: true }, effectiveTotal: 21, acceptedBluff: true, disqualifiedReason: null });
  expect(final.claims[0].status).toBe('unchallenged'); expect(final.vaultThiefIds).toEqual([ids[0]]);
  expect(table.view(code).roundPayouts[0]).toMatchObject({ stake: 100, returned: 200, profit: 100 });
  expect(table.view(code).players.map(player => player.balance)).toEqual([1400, 1000, 1000, 600]);
  expect(table.view(code).party!.bank.rounds.at(-1)).toMatchObject({ net: -100, bondLoss: 100, bankLoss: 0 });
  await pages[0].screenshot({ path: 'test-results/shadow-accepted-bust-settlement.png', fullPage: true });
  table.advance(2000); await expect.poll(() => table.view(code).phase).toBe('RESULTS');
  await pages[0].reload();
  expect(table.view(code).players.map(player => player.balance)).toEqual([1400, 1000, 1000, 600]);
  expect(table.view(code).party!.transfers.filter(transfer => transfer.kind === 'shadow_award')).toHaveLength(1);
  await pages[0].getByRole('button', { name: /^Return to Lobby/ }).click();
  expect(table.view(code).party).toBeNull();
  await expect(pages[0].getByRole('checkbox', { name: 'Shadow Blackjack finale', exact: true })).toBeChecked();
  expect(errors).toEqual([]);
});

test('a zero-chip player freely catches a lie; a wrong House caller loses Vault eligibility without a fee', async ({ table }) => {
  const { pages, code } = await fundedFinale(table, true);
  const ids = table.view(code).players.map(player => player.id);
  table.server.manager.e.shoe = () => scriptedShoe(['10', '10', 'A', '10', '9', '8', 'K', '6', '10']);
  table.advance(5000);
  await pages[0].getByRole('button', { name: 'Draw & Claim 21', exact: true }).click();
  expect(table.view(code).players[1].balance).toBe(0);
  await expect(pages[1].getByRole('button', { name: 'Call Bluff', exact: true })).toBeEnabled();
  await pages[1].getByRole('button', { name: 'Call Bluff', exact: true }).click();
  expect(table.view(code).players[1].balance).toBe(25);
  expect(table.view(code).party!.shadow!.entrants[0].disqualifiedReason).toBe('CAUGHT_LIE');
  expect(table.view(code).party!.vault).toBe(275);
  for (const page of pages) await expect(page.getByLabel('Shadow hand for Alex', { exact: true })).toContainText('29');
  await trueStand(pages[1]);
  await pages[2].getByRole('button', { name: 'Claim 21', exact: true }).click();
  const houseBalance = table.view(code).players[3].balance;
  await pages[3].getByRole('button', { name: 'Call Bluff', exact: true }).click();
  expect(table.view(code).party!.shadow!.entrants[3]).toMatchObject({ disqualifiedReason: 'WRONG_CALL', forcedTruth: true, revealed: true });
  expect(table.view(code).players[3].balance).toBe(houseBalance);
  await expect(pages[3].getByRole('button', { name: 'Claim 21', exact: true })).toBeDisabled();
  await trueStand(pages[3]);
  expect(table.view(code).party!.shadow!.winnerIds).toEqual([ids[2]]);
  expect(table.view(code).party!.shadow!.awards).toEqual([{ playerId: ids[2], amount: 275 }]);
  expect(table.view(code).party!.shadow!.claims.map(claim => claim.status)).toEqual(['caught', 'truthful']);
  table.advance(2000);
  expect(table.view(code).players.map(player => player.balance)).toEqual([1000, 25, 1275, 1200]);
  expect(table.view(code).party!.transfers.filter(transfer => transfer.kind === 'shadow_call_reward')).toHaveLength(1);
  await pages[1].reload(); expect(table.view(code).players[1].balance).toBe(25);
});

test('the House controls one private dealer hand and a successful busted dealer21 ties the Vault while genuine naturals retain3:2', async ({ table }) => {
  const { pages, code } = await fundedFinale(table);
  const ids = table.view(code).players.map(player => player.id);
  table.server.manager.e.shoe = () => scriptedShoe(['A', '10', '10', '10', 'K', 'Q', 'J', '6', '10']);
  for (const page of pages.slice(0, 3)) await page.getByRole('button', { name: /^Place Bet/ }).click();
  table.advance(5000);
  await pages[0].getByRole('button', { name: 'Claim 21', exact: true }).click();
  table.advance(8000);
  await trueStand(pages[1]); await trueStand(pages[2]);
  await pages[3].getByRole('button', { name: 'Draw & Claim 21', exact: true }).click();
  await expect(pages[3].getByLabel('Shadow hand for Drew', { exact: true })).toContainText('26');
  for (const viewer of ids.slice(0, 3)) {
    const view = table.server.manager.snapshot(viewer)!;
    expect(view.party!.shadow!.dealer.ownerId).toBe(ids[3]);
    expect(view.party!.shadow!.dealer.hand.slice(1)).toEqual([null, null]);
    expect(view.party!.shadow!.dealer.value).toBeNull();
    expect(view.party!.shadow!.entrants.filter(entry => entry.role === 'HOUSE')).toHaveLength(1);
  }
  table.advance(8000);
  const view = table.view(code);
  expect(view.phase).toBe('SHADOW_RESULT');
  expect(view.party!.shadow!.winnerIds).toEqual([ids[0], ids[3]]);
  expect(view.party!.shadow!.awards).toEqual([{ playerId: ids[0], amount: 150 }, { playerId: ids[3], amount: 150 }]);
  expect(view.roundPayouts.map(payout => payout.profit)).toEqual([150, -100, -100]);
  expect(view.party!.bank.rounds.at(-1)).toMatchObject({ net: 50, houseEarnings: 25, bankEarnings: 25 });
  expect(view.players.map(player => player.balance)).toEqual([1300, 900, 900, 875]);
  expect(view.party!.bank.balance).toBe(8025);
  await pages[3].setViewportSize({ width: 1680, height: 1050 });
  await pages[3].getByRole('region', { name: 'Shadow Blackjack table', exact: true }).screenshot({ path: 'test-results/shadow-house-dealer-tied-vault.png' });
});
