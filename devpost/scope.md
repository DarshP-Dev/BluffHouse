---
doc: scope
status: approved
---

# Bluff House

A real-time multiplayer Blackjack party game where friends stake fictional chips on each other's confidence.

## The Unique Kernel

Call My Bluff turns "My next hit won't bust" into a shared table event: a friend matches the wager, everyone watches one card reveal, and the outcome awards the challenge pot. The memorable moment is calling someone's bluff and winning or losing significant virtual chips together.

## Who It's For

A small group of friends, such as the learner and three friends, looking for a short, chaotic social game together on separate browsers or devices. Their current alternative was not specified.

## The Core Loop

Create or join a private room with a code, choose guest names, and start with 1,000 chips each. After everyone is ready, the host starts a three-round match. Players wager and take turns hitting or standing against a neutral, server-controlled Blackjack dealer, with synchronized game state and chip standings. This dealer is distinct from the player-controlled House role, which is deferred to the roadmap and is not part of the MVP.

During an eligible turn, a player may propose a Call My Bluff wager. The first eligible challenger matches it; both stakes are reserved before exactly one card is drawn. If the claimant does not bust, the claimant wins; otherwise, the challenger wins. The winner receives both committed wagers, including their own stake back. For a 200-chip wager each, the pot is 400: the winner nets 200 and the loser loses 200, separate from Blackjack settlement. All other seated players watch the same event and can react; no separate spectator role is required. Blackjack continues, and players try to finish with the most chips. After three rounds, see results and return to the lobby to play again.

## Inspiration & Identity

A chaotic multiplayer party game built around Blackjack. Confidence, laughter, accusations, suspense, and shared reactions should matter as much as the cards. Prioritize a polished, responsive interface that makes turns, stakes, countdowns, reveals, and outcomes clear. No specific visual reference or aesthetic has been selected.

## Why This Matters to the Learner

Build a functional, polished multiplayer proof of concept while learning real-time networking, multiplayer architecture, and complex game-state management. Follow structured planning while preserving time for testing, deployment, a demo, and submission by the learner's stated October 26, 2026 deadline.

## What "Working" Looks Like

Four players on separate browsers or devices can join one private room, complete three Blackjack rounds, make and resolve bluff challenges, see synchronized chip balances, and reach results that correctly announce the winner. A full match ideally takes 5–10 minutes.

For every accepted Call My Bluff challenge, both matched stakes are committed before exactly one card is drawn, the challenge pot is settled exactly once, and every connected player observes the same outcome and updated balances. Repeated or simultaneous actions must not cause additional draws or settlements.

The demo's defining beat is a challenged claim: visible matched stakes, a shared card reveal, a correct payout, and reactions across the table. Results show the winner by highest final chip balance, final standings, shared first place for ties, each player's successful and failed challenge record, and the biggest bluff wager as a concrete match highlight. Players can return to the lobby and replay.

Prepare a short demo video and public GitHub repository. Deployment is the learner's intended delivery goal; the curriculum treats it as optional. The curriculum's 2–4-hour active-work target is smaller than this multiplayer scope; the calendar deadline is not a guarantee of completion.

## The POC Boundary

- Private rooms for 2–6 guests; four players are the primary end-to-end test scenario. Room codes, lobby, ready state, host start, and 1,000 starting chips.
- Three rounds of multiplayer Blackjack: wagers, hit, stand, neutral server-controlled dealer, automatic payouts, visible turns, and a live chip leaderboard. No player-controlled House role in the MVP.
- Exactly one claim type: "My next hit won't bust." At most one claim per player turn and one active challenge at a time. Only legal hits and affordable wagers qualify; the first eligible challenger matches the stake. Accepted challenges commit both stakes, force exactly one draw, and settle the pot exactly once from whether the claimant busts; normal Blackjack then continues or ends. Every connected player observes the same outcome and updated balances. Unchallenged-claim behavior remains a PRD interview decision.
- A short challenge window (approximately eight seconds, to refine in PRD), visible participants and stakes, countdown, card reveal, table-wide result, quick emoji reactions, and system event messages.
- Final results and replay as described above. Basic text chat is conditional on feasibility and must not jeopardize the working game; it is not a completion requirement.
- Fictional virtual chips only: no real-money gambling, deposits, purchases of wagerable chips, or cash redemption.
- Preserve the ability to add claim types later as a technical-planning requirement, without implementing extra claims now.

The `3-prd` interview will resolve Blackjack payout rules, betting limits, turn timeouts, disconnects, host departure, zero-chip players, and unchallenged claims. The earlier proposal that unchallenged claims expire without chip transfers remains context for that discussion, not a settled rule in this approved scope. Exact challenge timers, settlement edge cases, other Blackjack rule details, and screen interactions also belong in `3-prd`. No architecture or implementation is selected here.

## Reliability and Delivery Risks

The proof requires consistent turns, cards, round progress, and balances across clients. Simultaneous challenges, late actions, and repeated requests must not create multiple challengers, extra draws, overspending, or duplicate payouts. Committed chips cannot also fund another wager; Call My Bluff settlement and Blackjack settlement must remain distinct.

Disconnects during turns or committed challenges, host departure, and players running out of chips can stall the three-round session or leave stakes unresolved. The PRD must choose bounded behavior for these cases; detailed recovery behavior is not decided by this scope.

Real-time correctness, cross-device testing, deployment, and UI polish are the main delivery risks before October 26. The 5–10-minute match length is a target to validate, especially with six players and challenge windows. Keep text chat optional, retain emoji reactions and announcements, and defer additional game systems. Finishing by the deadline remains uncertain until technical planning and early multiplayer validation.

## Later

The full vision is preserved in `vision.md`; `roadmap.md` records all deferred systems and future claims. After the core is complete and tested, the learner's preferred expansion is hidden House auctions, with the Vault a subsequent priority. Extra features require an explicit scope decision and time for validation; finishing early does not automatically add them.

## Explicitly Cut

Cut from the initial MVP, not discarded from the vision:

- House auctions, commissions, overthrow votes, duels, bounties, and Split/Steal deals: add separate contests and chip-settlement paths beyond the core proof.
- Chaos Cards, Vault finale, and Shadow Draw: introduce interacting rule changes and hidden-information mechanics that would broaden testing substantially.
- Additional claim types: prove one complete social interaction first.
- Double down from the original vision: explicitly deferred by the learner to keep the MVP focused on hit/stand; preserved in the roadmap.
- Public matchmaking, accounts, persistent profiles, avatars, achievements, lifetime standings, voice chat, and dedicated duel/event spectator views: unnecessary for the private guest-room proof.

No full-vision feature is permanently rejected. See the roadmap for retained details.


## Phase 5 Party Expansion Approval

The learner approved the 17-slice Fast-mode build in `checklist.md`, including its corrected **Approved Party-Mode Rules**. The original Classic three-round Blackjack / Call My Bluff behavior above remains the required baseline. Deferred-from-POC language describes that Classic boundary; the approved additional Party work follows only after the verified slice-3 core and actual early learner feedback. The original vision is preserved.

Party commissions are additional fictional dealer-bank payments: floor(3% of eligible positive Blackjack profit), maximum 50 total per round, allocated in settled seat order. They never reduce advertised player payouts and must be included in net dealer funding and idempotent settlement tests. Shadow Draw uses a specific declared total 17–21: an unchallenged lie scores the declaration plus one and can win despite a real bust; challenged exact truth scores real total plus two and penalizes/reveals the incorrect challenger; a caught lie is disqualified and rewards the successful caller two points. No-claim busts are ineligible. Jackpot payouts remain funded and once-only. Six-round Party will attempt two sequential, bounded social contests after the one-contest engine is verified, with an immutable 180-second phase cap and one qualifying bounty defense per target per interval. See the checklist for complete outcome, privacy, deadline, and regression criteria.

This approval authorizes local implementation, verification, and meaningful commits in the existing repository. It does not authorize push, deployment, purchases, or history rewriting. All unimplemented slices remain unchecked.
