import { test, expect, type TableFixture } from '../fixtures/browser.js';
import type { Page } from '@playwright/test';

async function party(table: TableFixture, instrumentSound = false) {
  const pages = await Promise.all(Array.from({ length: 4 }, () => table.newPlayer()));
  const code = await table.host(pages[0]);
  for (let i = 1; i < pages.length; i++) await table.join(pages[i], code, ['', 'Blair', 'Casey', 'Drew'][i]);
  if (instrumentSound) {
    await pages[1].context().addInitScript(() => {
      const Original = window.AudioContext;
      Object.assign(window, { requestToneStarts: 0 });
      Object.defineProperty(window, 'AudioContext', { value: class extends Original {
        createOscillator() {
          const oscillator = super.createOscillator(), start = oscillator.start.bind(oscillator);
          oscillator.start = (when?: number) => { (window as unknown as Window & { requestToneStarts: number }).requestToneStarts++; start(when); };
          return oscillator;
        }
      } });
    });
    await pages[1].reload();
    await expect(pages[1].getByRole('heading', { name: 'Your table', exact: true })).toBeVisible();
  }
  await pages[0].getByRole('button', { name: 'Party', exact: true }).click();
  await pages[0].getByRole('button', { name: '6 rounds', exact: true }).click();
  await pages[0].getByRole('checkbox', { name: 'Shadow Blackjack finale', exact: true }).click();
  for (const page of pages) {
    await page.bringToFront();
    await page.getByRole('button', { name: 'Ready Up', exact: true }).click();
  }
  await pages[0].getByRole('button', { name: 'Start Game', exact: true }).click();
  await pages[3].getByRole('button', { name: 'House bid 50 chips', exact: true }).click();
  await pages[3].getByRole('button', { name: /^Submit House Bid/ }).click();
  for (const page of pages.slice(0, 3)) await page.getByRole('button', { name: 'Pass Auction', exact: true }).click();
  table.advance(22000);
  await expect(pages[0].getByRole('heading', { name: 'Place your bets', exact: true })).toBeVisible();
  return { pages, code };
}
const target = (page: Page, kind: string, id: string) => page.locator('[data-notice-keys~="' + kind + ':' + id + '"]');
const tones = (page: Page) => page.evaluate(() => (window as unknown as Window & { requestToneStarts: number }).requestToneStarts);

test('compact wager columns and small deal offers keep the four-system sidebar and table in place', async ({ table }) => {
  const { pages, code } = await party(table), page = pages[0];
  await page.setViewportSize({ width: 1680, height: 1050 });
  await expect(page.getByRole('region', { name: 'Dealer bankroll', exact: true })).toHaveCount(0);
  expect(await page.locator('.gameplay-left').evaluate(element => Array.from(element.children).map(child =>
    child.classList.contains('dashboard-house') ? 'House' : child.classList.contains('compact-duels') ? 'Duels' : child.id === 'dashboard-chaos' ? 'Chaos' : child.classList.contains('compact-bounties') ? 'Bounties' : null).filter(Boolean))).toEqual(['House', 'Duels', 'Chaos', 'Bounties']);
  const builder = page.getByRole('form', { name: 'Build your Blackjack wager', exact: true });
  for (const width of [1680, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    const [chips, controls, box] = await Promise.all([builder.locator('.bet-chip-workspace').boundingBox(), builder.locator('.bet-summary').boundingBox(), builder.boundingBox()]);
    expect(controls!.x).toBeGreaterThanOrEqual(chips!.x + chips!.width);
    expect(box!.height).toBeLessThan(370);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await builder.getByRole('button', { name: 'Clear Pot', exact: true }).click();
  for (const chip of [100, 20, 20]) await builder.getByRole('button', { name: 'Bet ' + chip + ' chips', exact: true }).click();
  await expect(page.locator('#personal-pot-total')).toHaveText('140 chips');
  await builder.getByRole('button', { name: /^Place Bet/ }).click();
  expect(table.view(code).players[0].wager).toBe(140);
  await builder.getByRole('button', { name: 'Withdraw', exact: true }).click();
  table.advance(24000);
  await expect(page.getByRole('heading', { name: 'Challenge your friends', exact: true })).toBeVisible();
  const deal = page.getByRole('region', { name: 'Split or Steal', exact: true });
  await expect(deal.getByRole('combobox', { name: 'Deal partner', exact: true })).toBeEnabled();
  await expect(deal.getByRole('button', { name: /^Offer Split or Steal/ })).toBeEnabled();
  await expect(deal.locator(':scope > p')).toHaveCount(0);
  expect((await deal.boundingBox())!.height).toBeLessThan(390);
  await page.screenshot({ path: 'test-results/compact-social-mobile.png', fullPage: true });
});

test('unseen deal requests chime repeatedly, stop when actually seen, and keep mute across refresh', async ({ table }) => {
  const { pages, code } = await party(table, true), recipient = pages[1];
  table.advance(24000);
  await recipient.setViewportSize({ width: 390, height: 844 });
  await recipient.bringToFront(); await recipient.keyboard.press('Escape'); await recipient.evaluate(() => scrollTo(0, 0));
  await expect(recipient.getByRole('button', { name: 'Mute request sounds', exact: true })).toHaveAttribute('data-sound-unlocked', 'true');
  await pages[0].bringToFront();
  await pages[0].getByRole('combobox', { name: 'Deal partner', exact: true }).selectOption(table.view(code).players[1].id);
  await pages[0].getByRole('button', { name: /^Offer Split or Steal/ }).click();
  const id = table.view(code).party!.social!.dealInvites[0].id;
  const box = target(recipient, 'deal', id);
  await expect(box).toHaveAttribute('data-unseen', 'true');
  await expect(box).toHaveClass(/request-unseen/);
  await expect.poll(() => tones(recipient), { timeout: 5000 }).toBeGreaterThanOrEqual(4);
  await recipient.bringToFront(); await box.scrollIntoViewIfNeeded();
  await expect(box).toHaveAttribute('data-unseen', 'false');
  const heard = await tones(recipient);
  await recipient.waitForTimeout(3100);
  expect(await tones(recipient)).toBe(heard);
  await recipient.getByRole('button', { name: 'Mute request sounds', exact: true }).click();
  await recipient.reload();
  await expect(recipient.getByRole('button', { name: 'Unmute request sounds', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('duels, funded bounties and both House challenge stages highlight the actual recipient boxes', async ({ table }) => {
  const { pages, code } = await party(table);
  table.advance(24000);
  const ids = table.view(code).players.map(player => player.id);
  await pages[0].bringToFront();
  await pages[0].getByRole('combobox', { name: 'Challenge a friend', exact: true }).selectOption(ids[1]);
  await pages[0].getByRole('button', { name: /^Send Duel Invite/ }).click();
  const duel = table.view(code).party!.social!.invites[0];
  await expect(target(pages[1], 'duel', duel.id)).toHaveAttribute('data-unseen', 'true');
  await pages[1].bringToFront(); await pages[1].getByRole('button', { name: 'Decline Duel', exact: true }).click();
  await pages[0].bringToFront();
  await pages[0].getByRole('combobox', { name: 'Bounty target', exact: true }).selectOption(ids[1]);
  await pages[0].getByRole('button', { name: 'Fund Bounty', exact: false }).click();
  const bounty = table.view(code).party!.bounties[0];
  await expect(target(pages[1], 'bounty', bounty.id)).toHaveAttribute('data-unseen', 'true');
  await pages[1].emulateMedia({ reducedMotion: 'reduce' });
  await expect(target(pages[1], 'bounty', bounty.id)).toHaveCSS('animation-name', 'none');
  await pages[0].getByRole('button', { name: "Challenge Blair's bounty", exact: true }).click();
  const invite = table.view(code).party!.social!.invites.find(item => item.purpose === 'BOUNTY')!;
  await expect(target(pages[1], 'bounty-invite', invite.id)).toHaveAttribute('data-unseen', 'true');
  await pages[1].bringToFront(); await pages[1].getByRole('button', { name: 'Decline Duel', exact: true }).click();
  await pages[0].bringToFront(); await pages[0].getByRole('button', { name: 'Open Overthrow Ballot', exact: true }).click();
  const ballot = table.view(code).party!.social!.ballot!;
  await expect(target(pages[3], 'ballot', ballot.id)).toHaveAttribute('data-unseen', 'true');
  for (const page of pages.slice(0, 3)) { await page.bringToFront(); await page.getByRole('button', { name: 'Vote Yes', exact: true }).click(); }
  await expect(target(pages[3], 'house-choice', ballot.id)).toHaveAttribute('data-unseen', 'true');
  await pages[3].bringToFront(); await target(pages[3], 'house-choice', ballot.id).scrollIntoViewIfNeeded();
  await expect(target(pages[3], 'house-choice', ballot.id)).toHaveAttribute('data-unseen', 'false');
  await expect(pages[3].getByRole('button', { name: 'Begin Last Stand', exact: true })).toBeEnabled();
});
