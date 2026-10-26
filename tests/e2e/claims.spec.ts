import { test, expect, scriptedShoe, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';
import type { ClaimType, Rank } from '@bluff-house/shared';

async function startParty(table: TableFixture, ranks: Rank[]) {
  table.server.manager.e.shoe = () => scriptedShoe(ranks);
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const code = await table.host(pages[0]);
  for (let i = 1; i < 4; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  await expect(pages[0].getByRole('checkbox', { name: 'Shadow Draw finale', exact: false })).toBeChecked();
  // Keep the added Blackjack rules; disable unrelated systems through the real host controls.
  for (const label of ['House auction and player dealer', 'House overthrow', 'Direct duels', 'Bounties', 'Chaos cards', 'Split or Steal deals']) await pages[0].getByRole('checkbox', { name: label, exact: true }).uncheck();
  await pages[0].getByRole('button', { name: 'Apply Room Settings', exact: true }).click();
  await expect.poll(() => table.view(code).settings.house).toBe(false);
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Place Bet', exact: false }).click();
  }
  table.advance(21000);
  await expect(pages[0].getByRole('heading', { name: 'Player turns', exact: true })).toBeVisible();
  return { pages, code };
}

async function offer(page: Page, claimType: ClaimType) {
  await page.getByRole('combobox', { name: 'Your bluff claim', exact: true }).selectOption(claimType);
  await page.getByRole('button', { name: /^Call My Bluff/ }).click();
  await expect(page.getByRole('region', { name: 'Bluff challenge', exact: true })).toBeVisible();
}

test('funded ordinary Double Down stands after one card and exact-21 claims reveal true and non-bust false outcomes', async ({ table }) => {
  const { pages, code } = await startParty(table, ['6', '6', '7', '7', '10', '6', '7', '7', '8', '6', '9', '8', '6', '5']);
  await pages[0].setViewportSize({ width: 390, height: 844 });
  expect(await pages[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[0].getByRole('region', { name: 'Your game controls', exact: true }).screenshot({ path: 'test-results/claims-controls-mobile.png' });
  await pages[0].getByRole('button', { name: /^Double Down/ }).click();
  await expect.poll(() => table.view(code).players[0].doubled).toBe(true);
  expect(table.view(code).players[0]).toMatchObject({ wager: 200, committed: 200, balance: 800, status: 'stood', value: { total: 21, natural: false } });
  expect(table.view(code).players[0].hand).toHaveLength(3);
  await expect(pages[0].locator('.player-seat').first()).toContainText('Doubled · standing');
  await expect(pages[0].getByRole('button', { name: /^Call My Bluff/ })).toHaveCount(0);
  for (const [index, truth, total] of [[1, true, 21], [2, false, 20]] as const) {
    await offer(pages[index], 'NEXT_HIT_EXACT_21');
    await expect(pages[3].locator('.bluff-event')).toContainText('exactly 21');
    await pages[3].getByRole('button', { name: /^Accept Challenge/ }).click();
    await expect.poll(() => table.view(code).bluff?.settlement).toBe('settled');
    expect(table.view(code).bluff?.evidence).toMatchObject({ playerTotal: total, playerBust: false, claimTrue: truth });
    expect(table.view(code).bluff?.winnerId).toBe(table.view(code).players[truth ? index : 3].id);
    for (const page of pages) await expect(page.locator('.bluff-event')).toContainText(truth ? 'reached exactly 21.' : 'did not reach exactly 21 (20).');
    expect(table.view(code).bluff?.evidence).not.toHaveProperty('dealerTotal');
    table.advance(2000);
    if (!truth) {
      await expect(pages[index].getByRole('button', { name: /^Double Down/ })).toBeDisabled();
      await expect(pages[index].locator('.double-controls')).toContainText('before hitting');
      await pages[index].getByRole('button', { name: /^Stand/ }).click();
    }
  }
  await pages[3].getByRole('button', { name: /^Stand/ }).click();
  table.advance(700);
  await expect(pages[0].getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  expect(table.view(code).claimOutcomes).toHaveLength(2);
  expect(table.view(code).roundPayouts.find(payout => payout.playerId === table.view(code).players[0].id)).toMatchObject({ returned: 200, profit: 0 });
  await expect(pages[0].getByRole('region', { name: 'Claim ledger', exact: true })).toContainText('Claim false');
});

for (const dealerBust of [true, false]) test(`multiple deferred claims survive refresh, hide dealer evidence and settle ${dealerBust ? 'wins including an own bust' : 'pushes as false'} exactly once`, async ({ table }) => {
  const ranks: Rank[] = dealerBust
    ? ['10', '10', '10', '10', '10', '6', '7', '8', '9', '6', '3', '10', '10']
    : ['10', '10', '10', '10', '10', '10', '7', '8', '9', '10', '3'];
  const { pages, code } = await startParty(table, ranks);
  const initialMatch = table.view(code).matchId;
  const types: ClaimType[] = ['BEAT_DEALER', 'THREE_CARD_WIN', 'DEALER_BUST'];
  for (let i = 0; i < types.length; i++) {
    const before = table.view(code);
    const hands = before.players.map(player => player.hand);
    const oldDecision = table.server.manager.snapshot(before.players[i].id)!.decisionId;
    await offer(pages[i], types[i]);
    await expect(pages[3].locator('.bluff-event')).toContainText('No card is drawn on acceptance');
    await pages[3].getByRole('button', { name: /^Accept Challenge/ }).click();
    await expect.poll(() => table.view(code).pendingClaims.length).toBe(i + 1);
    const pending = table.view(code);
    expect(pending.players.map(player => player.hand)).toEqual(hands);
    expect(pending.claimOutcomes).toHaveLength(0);
    expect(pending.players[3].committed).toBe(100 + (i + 1) * 100);
    expect(pending.players[i].committed).toBe(200);
    expect(pending.dealer).toHaveLength(2);
    expect(pending.dealer[1]).toBeNull();
    expect(pending.dealerValue).toBeNull();
    for (const claim of pending.pendingClaims) {
      expect(claim).toMatchObject({ settlement: 'pending', timing: 'ROUND_RESULT', pot: 200 });
      for (const field of ['card', 'winnerId', 'evidence', 'proof', 'lockedHands']) expect(claim).not.toHaveProperty(field);
    }
    for (const page of pages) {
      await expect(page.locator('.bluff-event')).toContainText('Escrow locked. Outcome pending.');
      await expect(page.locator('.bluff-event')).not.toContainText('chips paid');
      await expect(page.getByRole('region', { name: 'Claim ledger', exact: true }).locator('.pending-claims .claim-record')).toHaveCount(i + 1);
    }
    if (i === 1) {
      await pages[1].reload();
      await expect(pages[1].locator('.bluff-event')).toContainText('Escrow locked. Outcome pending.');
      expect(table.view(code).players.map(player => player.hand)).toEqual(hands);
    }
    table.advance(2000);
    await expect(pages[i].getByRole('button', { name: /^Stand/ })).toBeEnabled();
    expect(table.server.manager.snapshot(before.players[i].id)!.decisionId).not.toBe(oldDecision);
    await expect(pages[i].getByRole('button', { name: /^Double Down/ })).toBeDisabled();
    if (i === 1 || i === 2 && dealerBust) {
      await pages[i].getByRole('button', { name: /^Hit/ }).click();
      if (i === 1) await pages[i].getByRole('button', { name: /^Stand/ }).click();
    } else await pages[i].getByRole('button', { name: /^Stand/ }).click();
  }
  await pages[0].setViewportSize({ width: 390, height: 844 });
  expect(await pages[0].evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pages[0].getByRole('region', { name: 'Claim ledger', exact: true }).screenshot({ path: `test-results/claims-${dealerBust ? 'bust' : 'push'}-pending-mobile.png` });
  await pages[3].getByRole('button', { name: /^Stand/ }).click();
  table.advance(700);
  await expect(pages[0].getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
  const settled = table.view(code);
  expect(settled.pendingClaims).toHaveLength(0);
  expect(settled.claimOutcomes).toHaveLength(3);
  expect(new Set(settled.claimOutcomes.map(claim => claim.id)).size).toBe(3);
  for (let i = 0; i < 3; i++) {
    const claim = settled.claimOutcomes[i];
    expect(claim).toMatchObject({ claimType: types[i], settlement: 'settled', pot: 200, winnerId: settled.players[dealerBust ? i : 3].id });
    expect(claim.evidence).toMatchObject({ claimTrue: dealerBust, dealerBust, dealerTotal: dealerBust ? 26 : 20 });
  }
  expect(settled.claimOutcomes[1].evidence).toMatchObject({ playerCardCount: 3, playerTotal: 20, playerOutcome: dealerBust ? 'win' : 'push' });
  if (dealerBust) expect(settled.claimOutcomes[2].evidence).toMatchObject({ playerBust: true, playerOutcome: 'loss', claimTrue: true });
  else expect(settled.claimOutcomes[0].evidence).toMatchObject({ playerOutcome: 'push', claimTrue: false });
  expect(settled.players.every(player => player.committed === 0 && player.reserved === 0)).toBe(true);
  const balances = settled.players.map(player => player.balance);
  expect(balances).toEqual(dealerBust ? [1200, 1200, 1000, 800] : [900, 900, 800, 1200]);
  for (let i = 0; i < 4; i++) expect(settled.matchStats.find(stats => stats.playerId === settled.players[i].id)).toMatchObject({ bluffWins: dealerBust ? i < 3 ? 1 : 0 : i === 3 ? 3 : 0, bluffLosses: dealerBust ? i === 3 ? 3 : 0 : i < 3 ? 1 : 0, bluffNet: dealerBust ? i < 3 ? 100 : -300 : i < 3 ? -100 : 300 });
  await pages[0].reload();
  await expect(pages[0].getByRole('region', { name: 'Claim ledger', exact: true }).locator('.settled-claim')).toHaveCount(3);
  expect(table.view(code).players.map(player => player.balance)).toEqual(balances);
  await pages[0].getByRole('region', { name: 'Claim ledger', exact: true }).screenshot({ path: `test-results/claims-${dealerBust ? 'bust' : 'push'}-settled-mobile.png` });
  table.advance(4000);
  for (let round = 2; round <= 3; round++) {
    await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
    table.advance(21000);
    await expect(pages[0].getByRole('heading', { name: 'Round settled', exact: true })).toBeVisible();
    table.advance(4000);
  }
  await expect(pages[0].getByRole('button', { name: 'Return to Lobby', exact: false })).toBeVisible();
  expect(table.view(code).players.map(player => player.balance)).toEqual(balances);
  expect(table.view(code).claimOutcomes).toHaveLength(3);
  await expect(pages[0].getByRole('region', { name: 'Claim ledger', exact: true }).locator('.settled-claim')).toHaveCount(3);
  await pages[0].getByRole('button', { name: 'Return to Lobby', exact: false }).click();
  await expect(pages[0].getByRole('heading', { name: 'Your table', exact: true })).toBeVisible();
  expect(table.view(code)).toMatchObject({ pendingClaims: [], claimOutcomes: [], matchStats: [] });
  for (const page of pages) await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  expect(table.view(code).matchId).not.toBe(initialMatch);
});
