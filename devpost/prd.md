---
doc: prd
status: approved
---

# Bluff House — Product Requirements

A multiplayer Blackjack party game for 2–6 friends using fictional chips and one shared Call My Bluff claim: "My next hit won't bust."

Source: `scope.md > The Unique Kernel`, `The Core Loop`, and `The POC Boundary`. Approved following the product interview and final consistency review. No architecture or implementation is selected.

## The Core Journey

1. Open the casino-themed main menu. Choose Host Room or Join Room; How to Play explains Blackjack and Call My Bluff.
2. Enter a guest username; joining also requires a room code. Enter the private lobby without registration.
3. See the room code, players, starting balances, host, and ready states. With 2–6 connected players and all connected participants ready, the host starts the match.
4. Everyone transitions to the same table and first betting phase, starting with 1,000 fictional chips each.
5. Each round has simultaneous betting, initial dealing, ordered player turns, dealer resolution, settlement, and a short round summary.
6. During an eligible turn, offer a matched-wager challenge. The table watches the countdown, acceptance, one card reveal, and result, and can react with emoji.
7. After three completed rounds, view the final winner or tied winners, leaderboard, bluff records, and biggest bluff wager. Return to the lobby to play again.
8. Temporary disconnects restore the same guest seat and latest state; committed wagers continue to resolve. Too few connected players triggers a bounded recovery window and a settled early finish. Too few connected players able to afford the minimum also ends the match at a settled round boundary, as detailed below.

## Screens and Layout

Source: `scope.md > The Core Loop`, `Inspiration & Identity`, and `What "Working" Looks Like`.

### Main Menu and Room Entry

- Prominent, distinctive BLUFF HOUSE logo; MVP tagline: "Trust Nobody. Call Their Bluff."
- Casino imagery or atmospheric lighting with large Host Room and Join Room buttons and a smaller How to Play option. Avoid clutter from unrelated statistics or navigation.
- Host opens a modal or screen for a guest username, then creates a private room with a short shareable code and enters its lobby.
- Join collects username and room code. Invalid, full, or already-playing rooms produce clear errors and do not admit the player.
- Usernames are 2–16 characters after trimming surrounding whitespace; allow letters, numbers, spaces, underscores, and hyphens. Reject case-insensitive duplicate names within the room with a clear validation message. Reconnection restores identity rather than creating another name entry.
- No login, registration, or functional-looking Quick Play placeholder.

### Lobby

- Room code and Copy Code at the top; visible player count, e.g. 3/6.
- Player positions show username, initials-based avatar with a distinguishing color, 1,000 starting chips, host indicator, connection status, and ready state.
- Each player controls their own Ready action. Only the current host sees Start Game.
- Leave Room returns to the main menu and immediately removes that lobby seat. If the host leaves explicitly, transfer host immediately to the longest-present connected player.
- Joins, departures, ready changes, and host changes update for everyone.
- At least two connected players and all connected participants ready are required to start. Disconnected players do not satisfy the minimum or block readiness.
- A short synchronized transition enters the first betting phase. "WELCOME TO THE TABLE" is optional decoration if simple and brief.

### Blackjack Table

- Luxurious table with visible player positions and a neutral dealer position. The dealer is not the future player-controlled House.
- Show public player hands, dealer cards with the hole card concealed as required, balances, wagers, leaderboard, round number, phase, highlighted active seat, countdowns, and clear betting/turn controls.
- Call My Bluff shows the claimant, wager, and offer countdown; accepted challenges highlight both participants and the full pot, briefly dim the rest of the table, and show the draw and outcome.
- Seated observers see the same event and can react; a separate spectator account or viewing role is not required.
- Round summaries show player outcomes, updated standings, successful challenges, and significant chip changes before the next round.

### Match Results

- Winner determined by highest final chip balance; ties share first place.
- Final chip leaderboard includes disconnected and intentionally departed match participants with their fully settled balances.
- Count accepted challenges won and lost for both participants, whether claimant or challenger. Unaccepted offers do not count as wins or losses.
- Highlight the largest accepted challenge pot; if pots tie, use the earliest accepted event. If no challenge was accepted, display "No bluff challenges this match."
- Return to the same lobby with the same room code and retained usernames/seats where appropriate. Reset starting balances to 1,000, round count, hands, wagers, challenge state, match statistics, and everyone's ready status for the fresh match. Preserve the completed results until the fresh-match reset; never mix old stakes or statistics into replay.
- The host must start the next match with at least two connected participants and all connected participants ready. No automatic replay or recreation of the room. Intentionally departed guests have no preserved seat; absent guests follow the lobby cleanup rule after the match. Only connected, ready guests enter the next match; prior disconnected participants do not carry an active hand or seat-recovery entitlement into a different match.
- Early results show "Match Ended Early," explain the reason, and use fully settled balances for standings and shared first place. Preserve bluff statistics and show the biggest challenge if any occurred. Returning to the lobby permits a fresh match with reset balances.

## Look and Feel

Source: `scope.md > Inspiration & Identity`.

The learner's subsequent detailed gameplay/usability correction supersedes earlier visual ordering and wager limits: keep the large table and every actual seated hand near the top, use compact contextual social panels, rounds/phase/urgent timer in a three-part header, concise single-line chat with emotes below, inline duels/bounties, illustrated hover/tap Chaos cards and distinct badge art. Blackjack wagers are built additively from 10/20/50/100/500/1000 chips with individual removal, undo, clear and affordable All-In/Half/Quarter shortcuts. Host-selected round count, starting stack and betting/decision timers are validated and locked at match start; lobby-only kicks and retained table wins are required. Whole-chip payouts remain authoritative, with explicit rounding. These changes are authorized; House-as-dealer funding and the Shadow Blackjack replacement are separately proposed in `gameplay-revision-proposal.md` and were explicitly approved October25. Their authoritative implementation remains separate from this verified R1–R3 recovery milestone.

October 25 final-review visual direction, explicitly requested by the learner: match the supplied Game Lounge, Lobby, House Auction Interface and Blackjack Dashboard references. Use a colorful illustrated lounge, oversized gold Bluffhouse branding with “PLAY BOLDER TOGETHER,” dark navy framed panels and glossy colored actions. The lobby separates avatar/roster/settings; the auction uses a royal purple/gold stage while preserving sealed bids; gameplay presents the table between system and standings/chat rails. These references supersede the earlier muted treatment and tagline below. Every name, balance, state and available action must remain truthful to the implemented game; illustrative reference numbers and mechanics are not feature requests.

- Premium underground casino atmosphere: black and charcoal backgrounds, deep burgundy red, metallic gold accents, subtle lighting, and a luxurious Blackjack table.
- Gold emphasizes important information and winnings; deep red emphasizes danger, losses, and bluff challenges. Keep text, game controls, and stakes clearly readable.
- Large distinctive logo, distinctive typography, polished menus, smooth button interactions, and consistent styling across menu, lobby, table, and results. No particular font or reference product has been chosen.
- Desktop is the primary visual target; mobile browsers must remain usable without overflow or inaccessible controls.
- Short, smooth dealing, chip, and challenge animations; subtle glow and atmospheric motion where feasible. Responsiveness and correct multiplayer behavior take priority over decorative effects.
- Animation must not create extra draws or payouts or give a client an extra opportunity to act. Everyone observes the same card and outcome; actions remain locked during challenge resolution. Network delays may affect animation timing, but cannot change the shared result.

## Features and Behavior

### Private Rooms and Match Start

Source: `scope.md > The Core Loop` and `The POC Boundary`.

Guest-only private rooms support 2–6 connected players, with four the primary test scenario. Start requires the current host and the agreed readiness conditions. Everyone begins a new match with 1,000 chips and enters the same first betting phase. During an active match, new room-code entrants are rejected; restoring an existing guest session is reconnection, not a new entrant.

Acceptance criteria:

- Four separate browsers/devices join the same room and see the same player list and ready states.
- Invalid, full, and in-progress rooms reject new joins with clear messages.
- A non-host cannot start the match; fewer than two connected players or an unready connected player prevents start.
- A valid start brings all connected participants into the same match and betting phase.

### Betting and Chip Availability

Source: `scope.md > The POC Boundary` and `Reliability and Delivery Risks`.

- Betting occurs simultaneously at the beginning of each round, with approximately 20 seconds to submit.
- Blackjack bets are 50–250 chips in increments of 50 and may not exceed available chips.
- Submitting a bet immediately reserves its chips and reduces the displayed available balance. Until betting closes, the player may edit or withdraw it. Editing replaces the prior reservation rather than adding another; withdrawal releases it exactly once. Validate the replacement against funds including release of the old reservation.
- At betting close, each submitted wager becomes committed exactly once and can no longer be changed or cancelled. Converting a reservation to a commitment must not charge the stake a second time. Reserved and committed chips are unavailable for any other wager.
- A player who does not submit skips the round. A player unable to afford 50 remains seated as an observer and may send emoji reactions. No chip loans, rebuys, or bankruptcy recovery are in the MVP.
- Disconnected players receive no automatic future bets. An existing submitted bet still commits at betting close if its owner disconnects or explicitly leaves; leaving is not a withdrawal. A valid withdrawal before close releases the reservation normally. An already-committed wager always settles.
- Clearly display balance, selected wager, and betting time. Balances must display 25-chip amounts created by 3:2 payouts even though wagers use 50-chip increments.

Acceptance criteria:

- Invalid amounts and unaffordable wagers cannot become accepted bets.
- No submitted bet means no Blackjack hand for that player in that round.
- Committed Blackjack stakes are unavailable for a challenge or another wager.
- Repeated edits, withdrawal, duplicate submissions, and disconnection cannot duplicate reservations, debit a stake twice, or produce an incorrect available balance.

### Blackjack Rules and Player Turns

Source: `scope.md > The Core Loop` and `The POC Boundary`.

- Use a shuffled six-deck shoe refreshed each round; draw without replacement within that round.
- Participating players receive two visible cards each. Dealer receives one visible and one hidden card. All players see each other's hands.
- Number cards use face value; J/Q/K count as 10; Aces count as 1 or 11 for the best non-busting total where possible.
- Natural Blackjack means an initial two-card Ace plus ten-value card. After the initial deal, check for dealer natural when the upcard is an Ace or ten-value card. Reveal an actual natural and settle the round before player actions; otherwise retain the hidden card until dealer play. Both naturals push; dealer natural beats every non-natural player hand; player natural beats a later dealer 21. Initial player naturals take no turn and receive their natural payout exactly once during round settlement.
- Players act in consistent seating order. Hit, Stand, and eligible Call My Bluff are the only gameplay actions. No split, double down, insurance, or surrender.
- A normal decision timer is approximately 20 seconds. A valid hit that leaves the hand playable resets it. Expiry automatically stands; bust or 21 ends the turn automatically.
- The neutral server-controlled dealer hits 16 or lower and stands on every 17, including soft 17. Its rules and card draws are not controlled by the room host.
- After player turns, reveal the dealer's hidden card and complete the dealer's play unless the round already resolved through an initial dealer Blackjack.

### Blackjack Settlement and Round Progression

Source: `scope.md > What "Working" Looks Like` and `The POC Boundary`.

- Normal wins pay 1:1 net: a 100 wager returns 200 including the original stake.
- Natural Blackjack pays 3:2 net unless the dealer also has a natural: a 100 wager returns 250 total.
- Push returns the original wager. A loss or player bust forfeits it.
- Otherwise compare non-busted player and dealer totals: higher player total wins, equal totals push, and lower player total loses. A player bust loses even if the dealer later busts; natural precedence is as defined above.
- Dealer bust pays remaining non-busted hands; natural Blackjacks retain their normal payout treatment.
- Every committed Blackjack bet settles exactly once. Challenge results do not alter that bet or cause it to settle again.
- Following settlement, show individual results, updated balances and leaderboard, and challenge/significant-change highlights. Allow a brief reaction interval, then begin the next betting phase.
- If nobody submitted a bet, deal no cards, announce "No wagers were placed," and count that empty round toward the three-round match. Proceed to the next round or final results, subject to the ending rules. Voluntary skipping is not inability to afford the minimum.
- End after the third completed round, including counted empty rounds, and show normal final results; do not start a recovery wait after the match has already completed. Earlier rounds use the early-ending rules below. Short transition durations can be specified in `4-spec` within the agreed pace.

Acceptance criteria:

- The 100-chip payout examples above match the displayed balance changes.
- Repeated actions and reconnecting do not repeat a payout or change the resolved cards.
- Every connected player sees the same round outcome, balances, and round progression.

### Call My Bluff Eligibility and Offer

Source: `scope.md > The Unique Kernel`, `The POC Boundary`, and `What "Working" Looks Like`.

- Supported claim: "My next hit won't bust."
- Only the active player with a legal hit and a hard total of 12–20 may offer. Totals of 11 or lower and soft hands are excluded because their next hit cannot bust them.
- One offer per Blackjack hand, including an expired offer; at most one event active at a time.
- Offer wager is 50–250 chips in increments of 50 and must be covered by available chips independent of the Blackjack wager.
- Immediately reserve the claimant's wager. Pause ordinary Blackjack actions and the normal turn timer. Show the whole table the claim, stake, and eight-second countdown.
- Any other connected seated player with sufficient available chips may match the wager, including players who skipped, finished, or busted their current Blackjack hands. No self-challenges.
- Accept only the first valid challenge received before the deadline. Later, invalid, duplicate, or expired attempts must not create another event or commit another stake.
- If nobody challenges, expire the offer, release the reservation, draw no card, and transfer no chips. Resume Hit/Stand with the paused time, raised to a minimum of five seconds. The hand's one offer has been used.

### Call My Bluff Reveal and Settlement

- On acceptance, close the offer and commit both matched stakes before drawing.
- Briefly announce and highlight both players and the total pot, then automatically draw exactly one card for the claimant.
- All connected players observe the same card, outcome, and updated balances. The claimant cannot substitute Stand or issue an extra draw during the event.
- Non-bust awards the pot to the claimant; bust awards it to the challenger. The winner receives both stakes, including their original stake back. With 200 each, the pot is 400, net changes are +200/-200.
- Settle the challenge exactly once, independently of the original Blackjack stake. Duplicate clicks, deadline races, and simultaneous challenges cannot produce extra draws, payouts, or negative available balances.
- Announce the winner and net chip change; allow shared emoji reactions.
- If the resulting hand remains playable, resume its turn with a fresh 20-second timer. Bust or 21 ends the turn.

Acceptance criteria:

- An expired offer returns the reserved stake without a draw and cannot be offered again that hand.
- Two simultaneous challengers produce exactly one accepted opponent, two committed stakes, one drawn card, and one payout.
- Both non-bust and bust cases award the correct pot while leaving Blackjack settlement separate.
- Every connected observer sees matching cards, outcome, and balances.

### Shared Reactions and Announcements

Source: `scope.md > Inspiration & Identity` and `The POC Boundary`.

Quick emoji reactions and visible game announcements are required. Reactions include 😂, 😱, 🔥, and 👀. Announce major events such as challenge offers/results, significant wins or losses, disconnects, and host changes. Basic text chat is conditional on feasibility; it must not delay the working game. Brief reactions must not obscure controls or flood the table; bounded placement, duration, and cooldown can be refined in `4-spec`.

### Disconnects and Reconnection

Source: `scope.md > Reliability and Delivery Risks`.

- For a temporary disconnect, preserve the guest's seat, username, balance, hand, and match statistics. Mark their avatar Disconnected and give others a subtle notification. Do not freeze the table. An explicit active-match departure has different recovery rights, as defined below.
- During an active match, a temporarily disconnected guest can reclaim their original seat and state using the same session until match end, provided they have not explicitly left. The 60-second grace governs host transfer and low-player recovery; it does not remove that seat or erase its balance. A reconnection after early termination is confirmed cannot restart the match.
- Reconnect using the same guest session automatically, without room-code entry, duplicate players, or new chips. Refresh follows this recovery path.
- Show "Reconnecting to Bluff House..." during recovery, then restore the correct screen and latest balance, cards, round, turn, and missed challenge outcomes. An expired/unrecoverable room shows a clear message and return-to-menu action.
- An ordinary active turn's existing timer continues during disconnection. Reconnecting before expiry restores only the remaining time; expiry automatically stands. Committed Blackjack wagers settle normally.
- If a claimant disconnects before acceptance, cancel the offer and release its reservation. The offer has still been used. Resume the paused turn timer with a minimum of five seconds, as for an unchallenged expiry; it runs while disconnected and expires to automatic Stand. This is not a fresh 20-second timer.
- Once both challenge wagers are committed, disconnection by either participant cannot cancel the challenge. Draw once, settle once, and broadcast the result. A still-playable claimant hand returns to the ordinary timer/automatic-stand behavior.
- Disconnected players cannot offer or accept new challenges and skip future betting phases. Those returning before match end can participate in the current phase if otherwise eligible.
- Keep absent players' final balances in match results. No losing wager is refunded or unfavorable hand erased by disconnecting.
- Explicitly leaving an active match ends the right to reclaim that match seat. Retain the participant's hand, balance, wagers, and statistics internally through settlement and final results; they cannot rejoin the active match as a new guest. Submitted bets commit as defined above, accepted challenges resolve, unaccepted offers cancel and release their reservation, and ordinary turn timers expire to Stand. No future bets or challenges are placed for them.
- Cross-device identity recovery, persistent accounts, and long-term match restoration are deferred.

Acceptance criteria:

- Refresh during a match restores the original guest and current state, with no balance reset or duplicate seat.
- A dropped connection during a normal turn does not extend that timer or block other players after expiry.
- Disconnecting after challenge acceptance still produces one card and one settlement, visible on return.

### Host Departure and Room Lifetime

- Lobby host disconnect: reserve their seat and announce the disconnect. Allow approximately 30 seconds to return and retain host permissions. If absent, transfer host to the longest-present connected player and announce it.
- Disconnected lobby members do not block readiness or count toward the two-player minimum. Their lobby seats expire after 60 seconds of absence; this does not apply to an ongoing match's temporarily disconnected seats. On returning from completed results to a lobby, still-absent seats use this lobby cleanup window. A seat no longer retained cannot be reclaimed by recovery; a guest may join an accepting lobby normally.
- During a match, progression does not depend on the host connection. Transfer administrative host permissions after 60 seconds of host disconnection, using the longest-present connected player rule. The lobby uses its separate 30-second host-transfer timer.
- Host permissions never control the dealer, randomness, or wager results.
- A former host returning after transfer regains their player seat but does not automatically reclaim host permissions.
- Explicit lobby departure removes the seat immediately; explicit active-match departure ends recovery rights while retaining outstanding obligations and the final result. An intentional host departure transfers administration immediately to the longest-present connected player; a temporary host disconnect uses the existing 30/60-second grace. If none are connected, assign host to the longest-present eligible player on return.
- An empty lobby may expire after approximately 10 minutes. Completed-match state may be cleaned up after approximately 15 minutes of inactivity. Normal replay transitions the room to its lobby lifecycle with the same code.
- Cleanup must never delete active game state, reserved/committed wagers, or unresolved accepted challenges before deterministic settlement or confirmed early termination followed by settlement. Even when nobody remains connected, normal timers and early-ending rules complete obligations before cleanup eligibility.

### Early Match Conclusion

Source: `scope.md > Reliability and Delivery Risks`; develops the approved goal of bounded disconnect behavior. These are exceptional finishes; the normal match remains three rounds.

**Fewer than two connected players:**

- Start a 60-second recovery countdown whenever connected-player count falls below two. Clearly announce that the match is waiting for players to reconnect.
- Cancel that countdown if at least two are connected again before it expires.
- Existing Blackjack turns, accepted challenges, and committed wagers continue under their normal timers and settlement rules. No new round begins while fewer than two are connected.
- At expiry, mark early termination as confirmed. Finish and settle the current round if active, then show final results. If already at a settled boundary, proceed to results.
- A late reconnection after confirmation does not undo termination, even if the active round has not finished settling.

**Insufficient funded participants:**

- At a settled boundary between rounds, if at least two players are connected, count those who can afford the 50-chip minimum using balances after all committed wagers settle.
- With two or more such players, the next round may proceed, subject to the other ending rules. With only one or none, end early and explain that there are insufficient eligible players to continue.
- Count affordability, not willingness to bet. Voluntarily skipping a round does not by itself trigger this condition.
- Zero-chip or below-minimum players may observe the remainder of an active round and send emoji. Do not top up, lend chips, or offer rebuys.
- When fewer than two are connected, honor the 60-second recovery window first and do not use affordability to bypass it. If two reconnect before expiry, cancel recovery and evaluate affordability at the settled boundary; otherwise confirm termination for insufficient connections. No new round begins while waiting.

**Early results and replay:**

- Display "Match Ended Early" and the specific reason.
- Rank all participants, including disconnected players, by fully settled final chip balances. Tied highest balances share first place.
- Preserve successful/failed bluff statistics and the biggest accepted bluff challenge if any occurred.
- Allow return to the lobby and a new match with reset balances. The normal new-match starting balance remains 1,000 each.

Acceptance criteria:

- Dropping below two connected players shows one recovery countdown and does not abandon committed bets.
- Reaching two connected before expiry cancels the countdown; reconnecting after confirmed termination cannot restart progression.
- No new round begins below two connected; early results appear only after all current-round wagers and accepted challenges settle exactly once.
- At a settled boundary with at least two connected players, two funded players remain eligible even if they previously skipped voluntarily; one or zero funded players triggers the insufficient-eligible-players result. Below two connected, the recovery window takes precedence.
- Early results retain standings and bluff records, explain the reason, and permit a fresh match rather than restoring the ended one.

## States and Boundaries

- **First use:** no account; enter a guest name to host or join.
- **Join error:** invalid, full, or already-playing room rejects new admission with an explanation.
- **Not ready:** connected players see who is holding up the match; only eligible host start can proceed.
- **Below minimum chips:** remain at the table observing and reacting; future wagers require available funds. At settled round boundaries, insufficient funded connected participants triggers the early-ending rule.
- **Offer without acceptance:** release the claim reservation, keep the same hand, resume the paused timer with at least five seconds, and do not permit another offer that hand.
- **Temporarily disconnected:** preserve same-session recovery, show status, keep gameplay bounded by timers and ordinary settlement.
- **Intentionally departed:** no active-match seat recovery; preserve obligations and final standings until settlement and results.
- **Results:** include all match participants and shared first place for tied highest balances.
- **Early results:** identify the reason, retain settled balances and statistics, and permit a fresh match; confirmed early termination is irreversible.
- **Room unavailable:** explain recovery failure and allow returning to the menu.
- **Privacy of cards:** player hands are public; the dealer's hole card remains hidden until the agreed reveal/check behavior.
- **Fictional economy:** no real money, deposits, wagerable-chip purchases, or cash redemption. Challenge pots transfer existing committed chips; dealer payouts are a separate Blackjack outcome.

## Product Decisions

- Prioritize the complete Blackjack / Call My Bluff social loop and reliable shared state over additional game systems and decorative effects.
- Use the MVP tagline "Trust Nobody. Call Their Bluff." Keep the original "Trust Nobody. Bet Everything. Become the House." as full-vision context.
- Use a neutral dealer and reserve the player-controlled House for later.
- Six-deck shoe refreshed each round; hit/stand only; dealer stands on soft 17; natural pays 3:2; betting is 50–250 by 50.
- Restrict claims to hard 12–20 so a single hit can genuinely bust.
- Permit other seated players to challenge even if they are not playing a live Blackjack hand, keeping the table socially involved.
- Unchallenged claims do not force a hit. One offer per hand prevents repeated delays.
- Accepted challenges resolve automatically and remain binding through disconnections.
- Keep same-session recovery and automatic host transfer; defer long-term and cross-device restoration.
- Keep temporarily disconnected active-match seats recoverable until the match ends unless the guest explicitly leaves. Use 30-second lobby and 60-second active-match host-transfer windows; former hosts do not reclaim permissions automatically.
- Use a cancellable 60-second recovery window below two connected players and settle active wagers before early results. Confirmed termination cannot be reversed by a late return.
- End at a settled boundary if fewer than two connected players can afford the minimum, without treating a voluntary skip as inability to pay. No loans, rebuys, or bankruptcy recovery.
- Apply low-connection recovery before affordability checks; count all-voluntary-skip rounds without dealing cards.
- Submitted bets reserve immediately, remain editable/withdrawable until close, and still commit if the player disconnects or leaves before close. Reservations and commitments never debit a stake twice.
- Intentional active-match departure forfeits seat recovery, not existing wager obligations. Empty-lobby and completed-match cleanup use approximately 10 and 15 minutes respectively and never bypass settlement.
- Replay preserves the room/group where appropriate and resets all match-specific state and readiness; the host starts only after the usual readiness conditions.
- Markdown is the planning review format.

## What We're Building

Private guest rooms, synchronized ready lobby and host start, three-round hit/stand Blackjack with bounded early-ending exceptions, live balances/standings, the single bounded bluff claim with exact settlement, shared reveals/reactions/announcements, same-session recovery and host transfer, final results/statistics/highlight, and replay. Primary proof: four browsers/devices complete a match and observe consistent outcomes. Support 2–6; 5–10 minutes is a target to validate, not a hard guarantee.

## Deferred From the POC

Source: `scope.md > Explicitly Cut` and `roadmap.md`.

House auctions/commissions/overthrows, duels, bounties, Split/Steal deals, Chaos Cards, Vault/Shadow Draw, extra claims, public matchmaking, accounts, custom profiles/avatars, achievements, lifetime standings, voice, and dedicated event spectator views remain deferred to protect the core. Split, double down, insurance, and surrender are excluded from MVP Blackjack. Text chat is optional. Advanced motion and cinematic transitions are conditional polish. Cross-device recovery and long-term restoration are deferred to limit recovery scope.

## Possible Later Enhancements

The original vision and future details remain in `vision.md` and `roadmap.md`. Hidden House auctions are the learner's preferred first expansion after a completed, tested core; the Vault is a subsequent priority. Future claim types should remain possible, without introducing their rules now.

## Non-Goals

Real-money gambling or redeemable chips; player control of dealer actions/randomness; an account platform; guaranteed recovery across unrelated devices or long-term outages; building the full roadmap before the core proof. Architecture and technology selection belong to `4-spec`.

## Final Consistency Review

- **Chip accounting:** editing replaces reservations; withdrawal releases them once; close converts them to committed stakes without a second charge. Separate Blackjack and challenge commitments each settle exactly once. No unavailable chips fund a second wager.
- **Blackjack:** six-deck refresh, Ace values, natural precedence, hidden-card handling, soft-17 stand, normal comparisons, 3:2 natural payouts, pushes, and bust losses have explicit rules. A natural is settled only once, including when the dealer also has one.
- **Offers:** hard 12–20 and legal hit required; one offer per hand, including cancelled/expired offers; eight seconds to challenge; first valid acceptance only. No challenger means no forced draw or transfer.
- **Challenge settlement:** two matched stakes committed before one automatic card; one award of the full pot; one won/lost record per participant; all clients observe the same outcome and balances. Disconnect or departure cannot reverse acceptance.
- **Timers:** offer pauses the decision timer and normal actions; expiry/cancellation resumes paused time with a five-second minimum; accepted resolution restarts a playable hand at 20 seconds; regular disconnection does not reset the running timer; expiry stands automatically.
- **Recovery:** temporary loss preserves the seat until match end; intentional departure forfeits recovery. Host transfer does not grant control over the dealer or restore former-host privileges. Recovery cannot restart confirmed termination.
- **Endings:** honor recovery before affordability, settle outstanding obligations before results, and include absent/departed participants in final rankings. Three completed/countable rounds end normally; early results identify their reason. Tied highest settled balances share first place.
- **Replay and cleanup:** preserve the room code and returning group, reset match state/readiness, and require a new valid host start. Ten-minute empty-lobby and fifteen-minute inactive-results cleanup never deletes unresolved active stakes.
- **Scope:** no deferred game mechanic added. Future systems remain in `roadmap.md` and `vision.md`; text chat remains conditional.

## Open Questions

No unresolved product decisions block `4-spec`. Exact responsive arrangement, fonts, brief animation/round-transition durations, and bounded emoji placement/cooldown can be specified within the approved visual direction and behavior. Technical architecture, recovery guarantees during service outages, implementation strategy, and verification details belong to `4-spec`; long-term/persistent restoration remains excluded.


## Phase 5 Party Expansion Approval

The learner approved the 17-slice Fast-mode build in `checklist.md`, including its corrected **Approved Party-Mode Rules**. The original Classic three-round Blackjack / Call My Bluff behavior above remains the required baseline. Deferred-from-POC language describes that Classic boundary; the approved additional Party work follows only after the verified slice-3 core and actual early learner feedback. The original vision is preserved.

Party commissions are additional fictional dealer-bank payments: floor(3% of eligible positive Blackjack profit), maximum 50 total per round, allocated in settled seat order. They never reduce advertised player payouts and must be included in net dealer funding and idempotent settlement tests. Shadow Draw uses a specific declared total 17–21: an unchallenged lie scores the declaration plus one and can win despite a real bust; challenged exact truth scores real total plus two and penalizes/reveals the incorrect challenger; a caught lie is disqualified and rewards the successful caller two points. No-claim busts are ineligible. Jackpot payouts remain funded and once-only. Six-round Party will attempt two sequential, bounded social contests after the one-contest engine is verified, with an immutable 180-second phase cap and one qualifying bounty defense per target per interval. See the checklist for complete outcome, privacy, deadline, and regression criteria.

This approval authorizes local implementation, verification, and meaningful commits in the existing repository. It does not authorize push, deployment, purchases, or history rewriting. All unimplemented slices remain unchecked.


## October 26 approved House dealer revision (R4)

The approved Section A in `gameplay-revision-proposal.md` supersedes passive House commissions. The House is the actual player dealer with server-validated Hit/Stand, owner-private hole cards, a capped personal bond and finite Bank backing. The winning50–900 auction payment still funds the Vault. Every accepted wager/double/Chaos increase has gross maximum-profit collateral; losses consume the bond first, and net profit restores Bank shortfall before a50/50 residual split. No negative debt, automatic capital refill, duplicate bettor House hand or passive3% commission remains. Host/crown authority, social escrows, all 7 Chaos effects and Classic rules remain distinct. Shadow's point-scoring predecessor remains until the separate approved R5 implementation passes verification.

## October 26 approved Shadow Blackjack revision (R5)

Approved Section B replaces the preceding point-scoring finale with a final Blackjack round. Each entrant sees their own hand; opponents see its first card only until a legitimate reveal. Within one configured turn budget, Hit while legal, Claim21 immediately, Draw & Claim21 atomically, or declare the true total and stand. Every claim opens a free eight-second first-valid-caller window, including for zero-chip and All-In entrants. Caught liars lose their funded wager and winning Vault eligibility; a caught dealer is an effective bust. A correct caller receives up to25 chips from the remaining Vault. Wrong callers reveal, lose winning Vault eligibility and play truthfully thereafter without a fee. Uncalled21 is binding even when actually busted. True initial naturals alone retain3:2. Settle backed Blackjack wagers and House Bank net before awarding the remaining Vault to highest eligible effective live totals; ties use equal shares and original-seat remainders. The House plays one dealer hand and may win the Vault; the automatic casino fallback cannot. Zero-wager/empty-Vault play is supported. Approved no-live/all-disqualified and pre/post-deal termination fallbacks preserve all funded obligations. No arbitrary contest points remain.

## October 26 hands-on revisions (R7–R8)

Keep live controls compact: House, Duels, Chaos Cards and Bounties in order; full Bank accounting belongs in results. Chip composition and editing sit left of totals/shortcuts/submission. Deal offers need only partner, contribution and offer action. Incoming requests shake and chime until seen, with mute, expiry handling and reduced-motion support.

The learner explicitly approved a mandatory personal House bet against the other players' aggregate Blackjack result, including Shadow. Reserve10 automatically when spendable funds permit; allow edits up to exact spendable chips excluding bond/other commitments. Below10, skip the extra stake without debt or crown loss. Commit before cards. Net losses consume this stake before bond and Bank; return unlost principal. Profit restores Bank shortfall first, then pays the House up to its stake and half any residual; odd chips stay in Bank. Show stake, returned principal and personal net including any bond loss. This deliberate revision supplements the same one player-controlled dealer hand and preserves fully funded payouts and private-card boundaries. Section C of `gameplay-revision-proposal.md` is the approved accounting contract.
