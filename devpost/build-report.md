# Phase 5 local build report

Report date: October 25, 2026. Repository: `C:\Users\Darsh\BluffHouse`, branch `main`.

Verified Slice 17 implementation milestone: `2bcda22`.

Slices 1–15 are implemented, verified and committed. Slice 16's conditional evaluation is complete with voice unavailable; microphone/signaling/mesh support is not represented as delivered. Slice 17 implementation and mechanical verification are complete, ready for the required final user exploration. Approved planning and the Classic user checkpoint are preserved.

## Reference-screen refinement — October 25

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
