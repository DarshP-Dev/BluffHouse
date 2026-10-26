# Phase 5 local build report

Report updated: October26,2026. Repository: `C:\Users\Darsh\BluffHouse`, branch `main`. Earlier sections preserve the original milestone evidence; later approved R1–R5 revisions supersede their old presentation and House/Shadow mechanics.

## Approved redesign and gameplay revisions — October26

R1–R3 are saved at `4b5c307`; the independently verified House-as-dealer R4 checkpoint is `3e964f7`. R5 replaces the old point-scoring finale with actual owner-private Shadow Blackjack under the explicitly approved Section B. The House plays one dealer hand. Every entrant receives two cards; only the first is public. Repeated legal Hits share one fixed turn budget. Immediate or atomic draw-and-claim21 opens an eight-second free call window. Caught liars lose winning Vault eligibility; wrong callers reveal, lose winning eligibility and play truthfully without a fee. Correct callers receive up to25 funded Vault chips. Uncalled21 remains binding even on a real bust. Real naturals alone retain3:2; effective hand comparisons settle backed wagers, then Bank net, then remaining Vault with exact ties and approved fallbacks.

Final server regression passes **931 tests /43 files**; TypeScript and production build pass. The final complete browser run passes **58/58 in5.9 minutes**. Actual journeys prove owner-only hidden busts, free calls at zero chips, wrong-call consequences, natural payouts against an accepted busted dealer21, tied Vault awards, refresh/replay and the integrated six-round claims/duels/deals/Chaos journey. Independent server review found no blockers.

`npm run test:production:shadow` passed with the actual compiled entry, unmodified monotonic clock, secure six-deck shuffle, HTTPS cookie/origin policy over local proxy-termination simulation,900-chip auction, two50-chip wagers (ordinary plus Shadow), free correct call,25-chip reward and875-chip remaining Vault award. Observed balances1050/900, Bank4050, bonus200, zero outstanding liabilities/bond/Vault; total6200 conserved.18 commands/66 snapshots;39.78 seconds, actual replay and clean shutdown. This is local production evidence, not physical-LAN or hosting verification.

Desktop and390px Shadow screens were inspected. R4 remains recoverable; original17slices, approved plans and the separate Slice1 testing worktree remain preserved. Final learner exploration, physical second-device LAN, learning wrap-up/app map and explicit ready-to-ship confirmation remain pending. No deployment or purchase occurred.

Verified Slice 17 implementation milestone: `2bcda22`.

Slices 1–15 are implemented, verified and committed. Slice 16's conditional evaluation is complete with voice unavailable; microphone/signaling/mesh support is not represented as delivered. Slice 17 implementation and mechanical verification are complete, ready for the required final user exploration. Approved planning and the Classic user checkpoint are preserved.

## Reference-screen refinement — October 25

Verified implementation milestone: `f2a4d1e` (`feat: match Bluff House UI to the illustrated casino references`).

The learner's four supplied screenshots now guide the interactive lounge, lobby, sealed House auction and gameplay dashboard. New locally bundled artwork, a transparent golden wordmark, navy framed panels, glossy controls and animal-style color cosmetics replace the earlier muted appearance. Game rules and server projections remain unchanged. Actual rival hands remain available below the main action area; live Party decisions take priority. Sidebar navigation opens real content or explains current availability. A persistent chat portal preserves the composer/history DOM, draft, focus and reading state across layout changes.

Final refinement checks: `npm run typecheck`, production build, **852 unit/integration tests / 40 files**, and the full **47-browser-test suite (4.5 minutes)** passed. The new real four-player flow checks all four layouts at 1672×941 and 390×844, loaded artwork, no horizontal overflow, desktop action placement, mobile Hit, sealed bids then reveal, menu/feature navigation, persistent chat identity/focus/draft and a funded desktop bluff acceptance. Initial presentation regressions in auction funds, own badge visibility and rules naming were repaired; seven affected browser tests passed before the final complete clean run. Earlier sandbox loopback restrictions were resolved through authorized local test networking.

Inspected the four desktop/mobile screenshots and the live-challenge desktop capture. After a final desktop-only logo alignment adjustment, a fresh build and the reference journey passed again (**1 test**). Regenerate the captures with `npm run test:e2e -- tests/e2e/reference-design.spec.ts`; output lives under ignored `test-results/reference-*.png`. Asset paths and the final built-in image-generation prompts are in `docs/ui-artwork.md`. The actual compiled `npm start` preview is running at localhost:3000; health, HTML and all three PNG assets returned HTTP 200. The earlier real-clock production smoke was not repeated because this revision changes presentation only.

The approved checklist records implementation evidence while leaving the agreed visual retry, final user approval, physical second-device LAN check and learning wrap-up/app map pending. No deployment or purchase occurred. Approved planning, existing commits/tests and the separate Slice 1 worktree are preserved.

## Slice 17 verification

| Command/check | Actual result |
| --- | --- |
| `npm ci` | Passed: 169 packages installed, 173 audited, zero reported vulnerabilities. Optional esbuild postinstall approval warning did not prevent the verified build. |
| `npm run typecheck` | Passed for shared/server/web/tests and smoke scripts. |
| `npm test` | **852 passed / 40 files**. |
| `npm run build` | Passed, including local font assets and compiled server/browser bundles. |
| `npm run test:e2e` | **46 passed**, one worker, 3.4 minutes. No skipped or failing browser tests. |
| `node --import tsx tests/scripts/production-smoke.ts` after build | Passed actual compiled entry, real production clocks/crypto cards, two players, three funded rounds, final balances 900/1,000, same-room replay, static/API checks and graceful shutdown in 78.32 seconds. |
| `npm start` | Actual localhost:3000 listener: health true, HTML/JS/CSS HTTP 200; stopped the owned listener with Ctrl+C and confirmed port closed. |

The complete browser suite covers four-player Classic and integrated six-round Party, all minigames, auctions/commissions, overthrows, bounties, all deal outcomes, earned Chaos, ordinary doubling, immediate/deferred claims, funded private Shadow Draw, profiles/chat/badges, Quick Play, refresh/controller recovery, results and replay. The new integrated journey verified final balances `[1371, 1200, 1200, 1050]`, dealer funding 821, reserve 400, Vault zero and exact conservation. Production integration also completes games/replay at two- and six-player boundaries with secure random shoes.

Mobile 390px screenshots were inspected for bluff acceptance, deal choices and private Shadow decisions. Current decisions lead the page with actual hand context, inactive information follows, and actions are not duplicated. Keyboard jumps act only on explicit activation, chat preserves focus/drafts/reading position, and reduced-motion/reconnect behavior remains tested. The new polish and integrated journeys collect console errors, page errors and failed local requests; their legal flows were clean. The full suite also passes the intentional failure/recovery scenarios.

No final test remains failing. Initial sandbox loopback denials were resolved by authorized networking, and the voice capture runtime limitation is recorded separately rather than represented as working microphone support. Earlier exact counts remain in `checklist.md`.

## Observed local workload

A representative run connected 12 real Socket.IO guests to two six-seat tables, completed Classic three-round and Party six-round matches and started replay. It processed 189 commands and observed 1,722 snapshots. The largest observed snapshot was 45,526 bytes; median acknowledgement was 4.74ms and p95 9.71ms, with 1.19 seconds of simulated-clock workload execution. This run included five Chaos activations and six settled Party claims. These are local observations, not internet latency, maximum payload or concurrency guarantees.

The compiled-entry smoke separately observed 18 commands, 82 snapshots and a 7,720-byte maximum snapshot. It used the unchanged monotonic clock and secure six-deck shuffle. Its HTTPS-origin/Secure-cookie policy was exercised over loopback HTTP as a reverse-proxy termination simulation, not a real hosted TLS deployment. A private process-test message invoked the actual entry's SIGTERM handler; the guest received the restart message, the child exited zero and its listener closed. This does not claim a native Windows OS signal test.

## Review and delivery boundaries

Physical second-device game LAN play/reconnect remains pending. Initial separate-profile Classic gameplay was approved. Final integrated exploration, feedback resolution, learning wrap-up and app map remain pending; tests cannot complete these human gates.

Voice's local synthetic RTP trial passed, but actual microphone permission handling, physical-device audio/intelligibility, six-person mesh and internet/NAT traversal remain unverified. See `voice-feasibility.md`.

`render.yaml.example` prepares one process with automatic deployments disabled and a manually supplied exact HTTPS origin, following the [official Blueprint fields](https://render.com/docs/blueprint-spec). It is an example, not a provisioned or hosted-validated service. Deployment and purchases need separate authorization. The local demo remains the fallback; restarts lose rooms/sessions. Verified GitHub pushes are separately authorized normal fast-forwards using DarshP-Dev.


## October 25 redesign recovery: R1–R3

Resumed the existing uncommitted work after `7084f9e`, preserving all original 17 verified slices. The revision now implements additive 10/20/50/100/500/1000-chip pots with individual removal/undo/clear, exact affordable All-In and rounded Half/Quarter; always-first large seated table; a three-part phase header and reduced-motion urgent countdowns; larger private code/Leave; persistent single-line chat with reactions beneath it; inline duels/bounties; custom illustrated Chaos and badge atlases; conventional opponent/self chess clocks; and server-validated host rounds/stacks/timers, lobby-only kicks and once-only retained table wins.

The complete regression passed **887 tests in 41 files**, TypeScript checks and production build. The full browser suite passed **54/54 in 5.9 minutes**. A final isolated tray synchronization fix was followed by another passing TypeScript/build and **9/9 affected browser cases**. Old assertions were adapted only for intentional additive chips, collapsed-card activation and table-first access; financial outcomes, private-state checks, focus/drafts, reconnect, real gameplay and retained evidence assertions remain. Regression findings restored live claim records, redraw discards, duel statistics and role history below the felt. Mobile chat now uses its full rail width and Ready/Start sits with its roster, remaining visible at the desktop reference size. Source changes never expose production clock/shoe controls.

A separate actual compiled-entry smoke used unmodified monotonic clocks and secure six-deck randomness. Two authenticated players completed three rounds and same-room replay in 77.21 seconds; final balances were 975/975. The run observed 16 commands, 72 snapshots,maximum payload 8,026 bytes,acknowledgement median 1.55ms/p95 6.62ms,and graceful restart notification/exit 0/listener closure. These are local observations,not physical-LAN/hosted/internet guarantees.

The current House and Shadow mechanics are preserved in this recovery milestone. The learner explicitly approved the separately documented R4 finite Bank/personal-bond/dealer model and R5 free-call hidden Blackjack rules. Implement and test them as distinct subsequent milestones. Physical second-device LAN play and the final learner retry/wrap-up remain pending. No deployment or purchase occurred.

Repository-local author and committer are now **DarshP-Dev <254763357+DarshP-Dev@users.noreply.github.com>**, verified with `git var`; GitHub authentication is independently checked for the same personal account before normal pushes. Earlier school-account commits remain unchanged in history, as requested. Artwork assets and exact built-in image-generation prompts are recorded in `docs/artwork-gameplay.md`.


## October 26 R4: player House dealer and finite Bank

Implemented approved Section A as a separate milestone after the pushed R1–R3 recovery commit `4b5c307`. The House has the actual dealer hand and server-validated Hit/Stand. A finite initial Bank and named personal bond back maximum gross liabilities; losing wagers benefit the dealer, player wins cause bond-first losses, and eligible net profits split 50/50 after Bank recovery. Bond releases never credit already-owned chips twice. Crown transfers retain the same Bank, and departure/timeout automation preserves funding and stand-on-17 legality. Bank, bond, gross payouts, net losses/recovery and earnings are visible in-game and in final records. The prior 3% commission model is intentionally replaced.

TypeScript/build and **909 tests / 43 files** pass. The full 57-case browser run passed 56 cases and exposed one old text assertion for the renamed dealer takeover; all 3 overthrow cases passed after updating that assertion. All 57 browser behaviors are verified, including 3 new actual dealer cases and the integrated six-round Party journey. Separate Bank tests verify reservation races, odd payouts, all 7 Chaos effects, actual earnings/losses, zero-bond transfer, depletion, retries and conservation. A new repeated-disconnect test prevents extending an automated draw deadline.

The real compiled-entry House smoke passed in 32.72 seconds using actual clocks and secure random cards:900bid from1000,100bond, finite 4000Bank, funded50-chip wager, final balances 500/1500, Vault zero, liabilities/bond cleared, replay and clean shutdown. It observed 14 commands,50 snapshots and an 11,706-byte maximum snapshot. Local only; second physical-device LAN, hosted testing and final human review remain pending. No deployment or purchase. R5's approved hidden-card Blackjack replacement follows as a separate milestone; the old finale remains verified at this checkpoint.
