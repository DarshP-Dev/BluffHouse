# Implemented features and limits

This describes the running code. Final hands-on review and deployment are separate gates; per-slice evidence is in `devpost/checklist.md`.

| System | Available behavior | Boundary |
| --- | --- | --- |
| Classic | Private/public tables, 2–6 guests, three funded Blackjack rounds by default, with 1–20 host-selected rounds, safe-hit Call My Bluff, reactions, standings, replay | Fictional chips; Party feature switches remain off |
| Party settings | 1–20 rounds, 2–6 seats, 100–100,000 starting chips (step 10), 5–120s betting/decision timers,feature switches,kicks,readiness reset and match locks | Overthrow needs House and duels; bounties need duels |
| House | Sealed50–900 auction; actual player dealer, private hole card, mandatory personal bet when affordable, standing bond, finite Bank, stake-based profit priority and50% residual share, overthrow/Last Stand | Minimum10; capped by spendable chips; below10 skips extra stake. Stake does not expand admitted payout capacity; host stays separate |
| Duels | RPS, Coin Flip, Connect 4, Bullet Chess; funded stakes, spectators, clocks and forfeits/refunds | One room contest at a time; intervals in matches of six or more rounds may fit two sequential contests |
| Chaos | Seven earned effects, bottom-two ties, two-card inventory, funded multipliers, finite Emergency Fund, protected movement/redraw | One activation/opt-in per round; no bust undo or challenge rewrite |
| Bounties | Owned contributions, three qualifying defenses, 85% challenger award/Vault remainder, unresolved refunds | Creation needs enough remaining intervals; once per target per interval |
| Deals | Funded hidden Split/Steal choices, disclosed timeout defaults, finite cooperation bonuses | One accepted contract per pair per match |
| Shadow Blackjack / Vault | Owner-private hands with first-card public, repeated Hits within one turn budget,21 claims/free eight-second calls, actual funded wagers, capped25-chip call rewards, highest effective hand and ties | Zero-chip/zero-wager entry; wrong calls/false claims lose winning eligibility; explicit no-live/all-disqualified fallback; Bank and Vault funding remain separate |
| Extra Blackjack | Ordinary Double Down, exact-21 immediate claim, three delayed dealer-result claims | Party switches; shared offer allowance and funded protected obligations |
| Profiles/social | Plain-text chat, avatar initials/colors with color-matched animal mascots, retained table wins across replays,detailed match statistics,eight illustrated event-derived badges | In-memory guest lifetime; no durable accounts/inventory |
| Quick Play | Compatible public join/create, safe name collisions, existing membership restoration | Excludes private/full/active/custom tables; never moves a current member |
| Voice | Unavailable | Conditional evaluation complete; synthetic local RTP is not real-device/internet verification |

The server owns cards, randomness, funds, clocks and outcomes. Accepted obligations survive departure and settle once before results. Restarting the sole server process loses rooms and guest sessions. No database, horizontal scaling, durable recovery, cross-device guest identity, lifetime board, real-money mechanism or spectator betting is delivered.

The learner's four visual references guide the lounge, lobby, sealed-auction and table layouts. Menu feature destinations explain the actual session-based systems; they do not fabricate global rankings or accounts. The large table shows every actual seated hand before contextual actions; duels/bounties are inline. Additive 10/20/50/100/500/1000-chip trays support removal/undo/clear and exact All-In,with Half/Quarter rounded down to 10. Compact persistent chat has emotes underneath. Earned Chaos cards show custom art,brief hover/tap details and validated actions; chess clocks tick by seconds beside the two players. Desktop and phone controls display real game state,including private auction amounts only when authorized by the server projection. Artwork is bundled locally; see [artwork and prompts](ui-artwork.md).

Initial Classic gameplay on one computer was approved by the learner. Physical second-device game LAN testing remains an additional pending task. Final integrated user exploration and the learning wrap-up/app map remain unchecked. No hosting has been provisioned or verified.

The user explicitly approved the House-as-dealer and Shadow Blackjack replacement rules on October 25. R4 supplies finite backing, real dealer decisions and personal profit/loss. R5 uses that Bank for its separate final wagers, then awards the remaining funded Vault by effective Blackjack totals. Uncalled21 stays valid even if the actual hand busted; caught liars and wrong callers lose winning Vault eligibility. Zero-chip calls are free. The one House dealer hand may bluff and compete for the Vault; a fallback automatic casino dealer cannot win it. See [approved rules](../devpost/gameplay-revision-proposal.md).

October26 feedback keeps the live rail in House/Duels/Chaos/Bounties order and moves full bankroll accounting to results. Compact two-column chip betting and small deal offers retain real controls. Unseen recipient requests shake and chime until focused visibility/interaction, expiry or settlement; mute persists and reduced motion uses a highlight. Mandatory dealer stakes are reserved automatically and committed before cards. Net loss consumes stake, bond, then Bank; net profit restores Bank shortfall, pays stake-capped priority profit to the House, then splits the residual. Returned principal is separate from earnings and personal net.

See [voice feasibility](../devpost/voice-feasibility.md), [architecture](architecture.md) and [the build report](../devpost/build-report.md).
