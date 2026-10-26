# Implemented features and limits

This describes the running code. Final hands-on review and deployment are separate gates; per-slice evidence is in `devpost/checklist.md`.

| System | Available behavior | Boundary |
| --- | --- | --- |
| Classic | Private/public tables, 2–6 guests, three funded Blackjack rounds by default, with 1–20 host-selected rounds, safe-hit Call My Bluff, reactions, standings, replay | Fictional chips; Party feature switches remain off |
| Party settings | 1–20 rounds, 2–6 seats, 100–100,000 starting chips (step 10), 5–120s betting/decision timers,feature switches,kicks,readiness reset and match locks | Overthrow needs House and duels; bounties need duels |
| House | Sealed 50–900 auction; actual player dealer with server-controlled Hit/Stand, owner-private hole card, personal first-loss bond, finite Table Bank, 50% residual profits, overthrow/Last Stand | Fully collateralized wagers; Bank principal is not player wealth; host ownership stays separate |
| Duels | RPS, Coin Flip, Connect 4, Bullet Chess; funded stakes, spectators, clocks and forfeits/refunds | One room contest at a time; intervals in matches of six or more rounds may fit two sequential contests |
| Chaos | Seven earned effects, bottom-two ties, two-card inventory, funded multipliers, finite Emergency Fund, protected movement/redraw | One activation/opt-in per round; no bust undo or challenge rewrite |
| Bounties | Owned contributions, three qualifying defenses, 85% challenger award/Vault remainder, unresolved refunds | Creation needs enough remaining intervals; once per target per interval |
| Deals | Funded hidden Split/Steal choices, disclosed timeout defaults, finite cooperation bonuses | One accepted contract per pair per match |
| Vault | Private Shadow Draw, claims/calls/reveals, scores, ties and funded awards | Early/disabled/unavailable finales use the documented fallback |
| Extra Blackjack | Ordinary Double Down, exact-21 immediate claim, three delayed dealer-result claims | Party switches; shared offer allowance and funded protected obligations |
| Profiles/social | Plain-text chat, avatar initials/colors with color-matched animal mascots, retained table wins across replays,detailed match statistics,eight illustrated event-derived badges | In-memory guest lifetime; no durable accounts/inventory |
| Quick Play | Compatible public join/create, safe name collisions, existing membership restoration | Excludes private/full/active/custom tables; never moves a current member |
| Voice | Unavailable | Conditional evaluation complete; synthetic local RTP is not real-device/internet verification |

The server owns cards, randomness, funds, clocks and outcomes. Accepted obligations survive departure and settle once before results. Restarting the sole server process loses rooms and guest sessions. No database, horizontal scaling, durable recovery, cross-device guest identity, lifetime board, real-money mechanism or spectator betting is delivered.

The learner's four visual references guide the lounge, lobby, sealed-auction and table layouts. Menu feature destinations explain the actual session-based systems; they do not fabricate global rankings or accounts. The large table shows every actual seated hand before contextual actions; duels/bounties are inline. Additive 10/20/50/100/500/1000-chip trays support removal/undo/clear and exact All-In,with Half/Quarter rounded down to 10. Compact persistent chat has emotes underneath. Earned Chaos cards show custom art,brief hover/tap details and validated actions; chess clocks tick by seconds beside the two players. Desktop and phone controls display real game state,including private auction amounts only when authorized by the server projection. Artwork is bundled locally; see [artwork and prompts](ui-artwork.md).

Initial Classic gameplay on one computer was approved by the learner. Physical second-device game LAN testing remains an additional pending task. Final integrated user exploration and the learning wrap-up/app map remain unchecked. No hosting has been provisioned or verified.

The user explicitly approved the House-as-dealer and Shadow Blackjack replacement rules on October 25. R4 is now implemented: finite backing, real dealer decisions and personal profit/loss. R5 is next; the existing Shadow Draw finale remains unchanged until its replacement is independently verified. See [approved rules](../devpost/gameplay-revision-proposal.md).

See [voice feasibility](../devpost/voice-feasibility.md), [architecture](architecture.md) and [the build report](../devpost/build-report.md).
