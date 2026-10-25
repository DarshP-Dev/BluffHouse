# Implemented features and limits

This describes the running code. Final hands-on review and deployment are separate gates; per-slice evidence is in `devpost/checklist.md`.

| System | Available behavior | Boundary |
| --- | --- | --- |
| Classic | Private/public tables, 2–6 guests, three funded Blackjack rounds, safe-hit Call My Bluff, reactions, standings, replay | Fixed rules; fictional chips only |
| Party settings | Three/six rounds, 2–6 seats, released-system switches, readiness reset, immutable match configuration | Overthrow needs House and duels; bounties need duels |
| House | Sealed auction, random highest-bid ties, separate bank commissions, overthrow/Last Stand | Dealer and host retain separate authority |
| Duels | RPS, Coin Flip, Connect 4, Bullet Chess; funded stakes, spectators, clocks and forfeits/refunds | One room contest at a time; six-round intervals may fit two sequential contests |
| Chaos | Seven earned effects, bottom-two ties, two-card inventory, funded multipliers, finite Emergency Fund, protected movement/redraw | One activation/opt-in per round; no bust undo or challenge rewrite |
| Bounties | Owned contributions, three qualifying defenses, 85% challenger award/Vault remainder, unresolved refunds | Creation needs enough remaining intervals; once per target per interval |
| Deals | Funded hidden Split/Steal choices, disclosed timeout defaults, finite cooperation bonuses | One accepted contract per pair per match |
| Vault | Private Shadow Draw, claims/calls/reveals, scores, ties and funded awards | Early/disabled/unavailable finales use the documented fallback |
| Extra Blackjack | Ordinary Double Down, exact-21 immediate claim, three delayed dealer-result claims | Party switches; shared offer allowance and funded protected obligations |
| Profiles/social | Plain-text chat, avatar initials/colors, detailed match statistics, eight event-derived badges | In-memory guest lifetime; no durable accounts/inventory |
| Quick Play | Compatible public join/create, safe name collisions, existing membership restoration | Excludes private/full/active/custom tables; never moves a current member |
| Voice | Unavailable | Conditional evaluation complete; synthetic local RTP is not real-device/internet verification |

The server owns cards, randomness, funds, clocks and outcomes. Accepted obligations survive departure and settle once before results. Restarting the sole server process loses rooms and guest sessions. No database, horizontal scaling, durable recovery, cross-device guest identity, lifetime board, real-money mechanism or spectator betting is delivered.

Initial Classic gameplay on one computer was approved by the learner. Physical second-device game LAN testing remains an additional pending task. Final integrated user exploration and the learning wrap-up/app map remain unchecked. No hosting has been provisioned or verified.

See [voice feasibility](../devpost/voice-feasibility.md), [architecture](architecture.md) and [the build report](../devpost/build-report.md).
