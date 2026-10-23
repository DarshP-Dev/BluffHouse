---
doc: spec
status: approved
---

# Bluff House — Technical Spec

Approved technical blueprint from `4-spec`. The learner approved the architecture, technical decisions, and implementation priorities. Implementation begins only after they separately invoke `5-build` and review the implementation approach; this approval does not start code generation, package installation, deployment, or hosting charges.

## How This Works, In Plain Language

The browser shows the table and sends requests such as Hit, Stand, or Accept Challenge. One running Node.js server owns the real game: seats, cards, chip balances, timers, and results. Browsers cannot choose card draws or award chips.

The server handles each room's commands in sequence. Requests have identifiers, and settlement records prevent an accepted action from drawing or paying twice. Connected players receive the resulting shared state. Reconnecting must restore the existing player and latest game state, rather than create another player or replay old clicks blindly.

All game data lives in that server process's memory for this MVP. Refreshing a browser or losing a network connection does not erase it. Stopping, crashing, restarting, or redeploying the backend can erase active rooms and matches. In that case the app shows "This match is no longer available" and a return-to-menu action. It must not silently replace a participant or invent a fresh balance inside an existing match.

## The Core Journey Through the System

Implements `prd.md > The Core Journey`.

1. React displays the menu and guest room-entry forms.
2. The server validates creation/join requests and owns lobby membership, readiness, and host permissions. A server-issued HttpOnly session cookie identifies the guest independently of their current socket; the newest authenticated connection is the only controller.
3. Host Start becomes a room command. The server validates host and readiness, creates match state, and starts round-one betting.
4. Bet submission, edit, withdrawal, Hit, Stand, and bluff actions are validated against the server's current phase, actor, funds, and deadline.
5. A challenge acceptance commits matched wagers, draws exactly once, and settles exactly once. Clients show the server-selected card and result; animation is presentation rather than authority.
6. Dealer actions, Blackjack settlement, round boundaries, early endings, final statistics, and replay are controlled by server state transitions.
7. Temporary reconnection authenticates the existing guest and restores current state while this process is running. Intentional departure retains settlement obligations but forfeits active-seat recovery, as specified by the PRD.

## Stack

Accepted by the learner:

| Piece | Choice and rationale | Documentation |
|---|---|---|
| Browser UI | React and TypeScript: familiar tools with typed presentation and commands | [React](https://react.dev/learn), [TypeScript](https://www.typescriptlang.org/docs/) |
| Browser build | Vite: development tooling and a production frontend bundle | [Vite](https://vite.dev/guide/) |
| Styling | Tailwind CSS: carry the approved casino visual direction into responsive UI | [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite) |
| Authoritative runtime | Node.js with TypeScript, one running backend process | [Node.js](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs) |
| Real-time transport | Socket.IO: browser/server command and state communication | [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/) |
| Storage | Server memory only: avoids a database and distributed coordination for the proof | No storage service |

Derived baseline for draft review: Node 24 LTS (24.22.1 or a later compatible patched 24.x), React 19.x, TypeScript 6.x, Vite 8.x, Tailwind 4.x with its Vite plugin, Socket.IO server/client on the same 4.x release, Express 5.x for small HTTP routes/static serving, Vitest 5.x, and Playwright 1.x with its matching Chromium binary. Use npm workspaces and a committed lockfile; no additional monorepo framework, frontend state library, or animation framework is needed.

Vitest covers rules and server integration; Playwright covers real browser/socket journeys. These follow the learner's proposed tools and requested automated scenarios. The test plan below is the concrete recommendation for review.

Documentation checked during planning: [Node 24.22.1 LTS](https://nodejs.org/en/blog/release/v24.22.1), [React versions](https://react.dev/versions), [TypeScript 6](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html), [Vite 8](https://vite.dev/blog/announcing-vite8), [Vitest prerequisites](https://vitest.dev/guide/), [Playwright](https://playwright.dev/docs/intro), [Express static serving](https://expressjs.com/en/starter/static-files.html). Vite documents Node 20.19+/22.12+ requirements; Vitest documents Node 22.12+ and Vite 6.4+. The selected Node 24/Vite 8 baseline meets those published floors. Exact patch/plugin compatibility and browser installation are still an early-build verification, not a claim that dependencies have been installed or tested.

## Where It Runs and How Someone Tries It

One authoritative backend process serves Express HTTP routes, Socket.IO, and built frontend assets on one port and origin. Render is the selected deployment platform: Free for initial hosted testing after local verification, with an optional paid upgrade of the same service for the final submission. The learner explicitly accepts Free-tier idle sleeping and resulting memory loss during initial testing; this supersedes the earlier preference for non-sleeping compute throughout development. No serverless execution, worker cluster, multiple replicas, PostgreSQL, or Redis in the MVP.

### Planned Local Commands

These are script contracts for `5-build` to implement, not currently runnable application scripts:

1. Install Node 24 LTS and npm. From `C:\Users\Darsh\BluffHouse`, run `npm ci` once the build has created the package files/lockfile. First-time dependency creation in `5-build` uses npm install and then validates clean npm ci reproducibility.
2. Run `npm run dev`. This starts the TypeScript backend on `127.0.0.1:3000` and Vite on `http://localhost:5173`. Vite proxies `/api` and `/socket.io` (including upgrades) to the backend, keeping browser-facing cookie/origin behavior consistent. Do not mix localhost and 127.0.0.1 browser URLs in one guest session.
3. Run `npm run typecheck`, `npm test` (Vitest run, no watch), and `npm run test:e2e`. The root typecheck/test scripts ensure shared exports are built; test:e2e ensures a production frontend build exists before its fixture starts. One-time `npx playwright install chromium` installs the matching test browser. Linux CI may use `--with-deps` with its normal environment permissions.
4. Run `npm run build` then `npm start` for the production-like local demo. Build shared contracts, backend, and browser assets in dependency order; start only the compiled Node entry point. Open `http://localhost:3000`.
5. For four players, use four separate browser profiles/devices or the four isolated Playwright contexts. Same-profile tabs intentionally share one player.

The exact scripts must work on the learner's Windows/PowerShell system and the Linux host; use portable Node helpers rather than POSIX-only environment assignments. Vite's preview/development server is not the production host. No game state is persisted to source files.

The development helper supplies `PUBLIC_ORIGIN=http://localhost:5173` to its backend child and enables the socket-upgrade proxy; compiled local demo defaults use `http://localhost:3000`. Environment overrides must be explicit so an origin mismatch does not silently disable cookie or handshake checks.

### Selected Render Deployment and Cost Gate

Use one Render Web Service hosting both the built React application and authoritative Node.js/Socket.IO server from the same origin. Start on Free after the application works locally. Render Free can spin down after 15 minutes without incoming traffic; a cold start can take about a minute. Restart, redeploy, or idle spin-down destroys in-memory matches. Both compute plans use the same app/listener/cookie/socket architecture; no database or service split is required to change plans.

Before the learner's October 26, 2026 submission deadline, evaluate the deployed app's cold-start experience, availability, stable four-player play, reconnect behavior, and performance. If Free's limitations materially harm the final demo/judging experience, upgrade the same service to paid `0.5c-512mb` (legacy name Starter), listed at approximately US$7/month during this research, plus applicable usage/taxes. The learner accepts that cost if needed but does not want hosting purchased before necessary. This is a selected deployment strategy, not a current instruction to provision a service or incur charges.

Paid compute removes Free's idle-sleep behavior, but deployments/platform maintenance can still replace an instance and lose memory. Do not claim restart persistence or continuous availability on either plan. Schedule plan changes between matches because a change may restart the process; rerun deployed smoke/recovery checks afterward.

- Build: `npm ci --include=dev` then `npm run build`, expressed as the provider's build command. Start: `npm start`. Bind the Node HTTP listener to `0.0.0.0` and the assigned `PORT` (Render default 10000); attach Socket.IO to that same listener.
- Set one instance and no autoscaling. Disable automatic deploy-on-push during demos/playtests, or schedule deploys between sessions. Zero-downtime rolling deployments do not preserve in-memory matches, so do not promise state migration. A server instance identifier separates old recoveries/commands from newly created state after restart.
- Use provider-managed HTTPS and same-origin `wss`/Socket.IO. Configure `PUBLIC_ORIGIN` to the exact deployed HTTPS origin. Do not add a separate frontend host, wildcard credentialed CORS, database, or public test API.
- Configure a small `/api/health` endpoint and normal Socket.IO heartbeat. Verify host routing, cookies, four-player sockets, reconnects, and the accepted restart-loss screen before recording.
- During Free testing, show a neutral connecting/waking state until the server responds, then recover the existing guest only if its state still exists. If a wake has started a fresh process, show "This match is no longer available" and the menu action. Do not silently initialize a new guest or rely on synthetic keepalive traffic to avoid the selected Free-tier limitation.
- Graceful shutdown stops admission and tells clients the server is restarting where possible; it never promises durable settlement through a forced process exit. Normal room cleanup must settle obligations, but the learner has explicitly accepted process-loss limitations. A process-local drain cannot guarantee preservation through a crash or provider shutdown deadline.

Provider docs: [WebSockets and instance replacement](https://render.com/docs/websocket), [compute plan names](https://render.com/docs/compute-plans), [pricing](https://render.com/pricing), [free-service sleeping](https://render.com/docs/free). No host account, service, billing plan, or deployment has been created. Evaluate observed stability and the need for a paid upgrade during shipping; do not silently provision paid compute from this specification.

### Demo and Submission

Local recording remains a working fallback. Show create/join/readiness, four real players, at least one accepted bluff with matched stakes and shared outcome, three rounds, final results, and replay. Record a short version of the defining moment rather than requiring the viewer to watch a whole 5–10-minute match. The curriculum requires both a short demo video and public GitHub repository; deployment is optional in the curriculum and does not replace either. The learner has chosen a hosted trial/final URL; `6-ship` verifies its access, Free-tier waking behavior and final compute-plan decision alongside the local run/recording instructions.

## Look and Feel

Implements `prd.md > Look and Feel` and `scope.md > Inspiration & Identity`.

Use React/Tailwind theme tokens for charcoal/black surfaces, burgundy danger/challenge accents, and muted metallic gold emphasis/winnings. Derived starting colors: background #0B0B0D, surface #19191E, burgundy #781C32, gold #D7B56D, text #F4EFE5; verify text contrast before final styling. Use a locally bundled, licensed display serif for the title and a readable sans-serif for controls (system fallbacks; no font CDN dependency). Carry forward "Trust Nobody. Call Their Bluff."

Desktop: dealer and round/phase at the top, six stable seat positions around the table, local actions anchored near the bottom, standings/event rail beside the table. Mobile: compact dealer/table, readable seat cards in a wrapping arrangement, bottom action area, and expandable standings; no mandatory landscape orientation or horizontal page overflow. Keep labels/symbols alongside color and visible focus states. Respect reduced motion; gameplay never waits on an individual browser's animation event.

Derived presentation timing for review: approximately 600 ms for the entry transition, 1 second for dealing presentation, 2 seconds for a bluff reveal, 350 ms between dealer draw displays, and 4 seconds for round results. The server owns phase durations; CSS motion stays within them and reduced-motion users see the same state with less movement. Emoji originate at the sending seat, fade after about 2 seconds, and are limited to one per player per second; announcements remain readable and do not cover Hit/Stand. These are proportional implementation defaults within the approved visual direction, not new game mechanics.

## Components

### Browser Presentation

Implements `prd.md > Screens and Layout`, `Look and Feel`, and `Shared Reactions and Announcements`.

Menu, room-entry forms, lobby, table, challenge presentation, results, and reconnect overlay. Renders server state and requests permitted actions. Never computes authoritative payouts or advances the shoe locally.

### Guest Session and Connection Boundary

Implements `prd.md > Disconnects and Reconnection` and `Private Rooms and Match Start`.

Accepted design:

- Issue a cryptographically secure random guest credential from the server, using Node's cryptographic randomness. Derive a stable internal player identifier independently of Socket.IO's socket ID. The credential maps in memory to guest identity, room membership, and seat/recovery rights.
- Store the credential only in an HttpOnly session cookie, not localStorage, frontend application state, URLs, room snapshots, or logs. Derive ordinary cookie settings as `Path=/`, no Domain attribute, `SameSite=Lax`, and `Secure` for production HTTPS. Do not set persistent-cookie lifetime attributes. Local HTTP development omits Secure; production cannot silently downgrade it. Cookie parsing and secret redaction apply to request/error logging too.
- The same browser profile's tabs share one guest. No registration, OAuth, passwords, permanent accounts, database, or cross-device recovery.
- Authenticate the cookie during connection establishment, then restore the latest authorized room snapshot. A lost/expired credential or missing room produces an explicit recovery error and menu action, never an automatic substitute player. A new guest/room is created only through the explicit entry flow.
- Every successful authenticated connection replaces that guest's prior controlling connection. Track a server-side monotonically increasing connection generation and current socket reference. Verify both on every incoming command; disabled frontend buttons alone are insufficient.
- Revoke the old controller before enabling the new one. Send the old connection `session:replaced` with the message "Session opened elsewhere," stop its gameplay emissions and automatic reconnect, and close it. Old queued commands are rejected even if they arrive later.
- An old socket's delayed disconnect callback must match the current socket AND connection generation before changing connectivity, starting grace timers, cancelling offers, or migrating host. A replaced socket cannot affect the replacement's presence.
- Replacement itself does not mark a player disconnected or cancel a live offer. A genuinely observed connection loss still follows the PRD's cancellation, timer, and recovery rules.
- On refresh/reconnect, discard speculative browser game state in favor of the latest server snapshot, including balances/reservations, cards, round/phase, deadlines, host, challenges, statistics, and missed challenge outcomes. Never recover by replaying a sequence of unverified old browser clicks.

Documentation: [Socket.IO socket identity](https://socket.io/docs/v4/client-socket-instance/), [Node crypto](https://nodejs.org/api/crypto.html), [Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

### Sequential Room Command Processor

Implements `prd.md > Call My Bluff Eligibility and Offer`, `Call My Bluff Reveal and Settlement`, and `Betting and Chip Availability`.

Accepted design: one ordered command stream per room, unique request identifiers, authoritative validation, atomic candidate-state commits, and recorded settlements. Socket.IO delivery alone is not the exact-once safeguard.

#### Accepted Command and Deadline Model

- Bind every mutating request to its authenticated player and current controlling connection; never trust a supplied actor identity. Include a unique `requestId` and appropriate room, match, round, decision, or offer identifiers. Lobby actions use lobby context instead of a fabricated match identifier.
- Deduplicate by authenticated player, match/lobby scope, and request identifier, retaining the validated request fingerprint and acknowledgement for the room's lifetime. A matching retry returns its original outcome without another mutation; reusing an identifier with a changed payload is rejected. Retain settlement records too, including across replay until room disposal. Closed scopes and consumed decisions remain invalid. Do not introduce a time-based eviction that makes an old request executable again; enforce admission/rate/memory caps rather than silently discarding replay protection.
- Request IDs alone do not stop rapid duplicate clicks carrying different IDs. Each normal action references a server-generated decision identifier. Hit, Stand, or starting an offer consumes that decision; only the next authoritative state supplies a new valid decision. Each challenge acceptance targets its specific open offer. An unrelated emoji must not invalidate the player's turn action.
- Fully validate against the current authoritative state before consuming any offer/decision. Build the resulting game state on a private candidate copy, including reservations, draws, balances, settlement markers and statistics; assert its invariants, then replace the room's game-state root once and increment revision once. Keep sockets, native timer handles, and request caches outside this copy. No await, network I/O, or externally visible partial mutation occurs inside this transition. Failure discards the candidate; a failed acceptance leaves a still-valid offer available. An actually expired offer still expires through its independent due transition.
- Network broadcasts/logs follow commit. A future durable store needs a transactional commit at this boundary; replacing a Map alone would not provide crash-safe settlement. No database transaction framework or distributed lock is introduced now.
- A challenge acceptance consumes the open offer, commits both stakes, draws one card, and records the pot award/statistics as one authoritative transition. The dramatic announcement and reveal are a timed presentation of that recorded outcome, not a second draw or settlement operation. Clients remain action-locked through its server-controlled reveal phase; disconnect cannot undo the recorded event.
- The server's injected clock governs acceptance, not browser timestamps or countdown pixels. A valid acceptance must reach the application's handler before the eight-second deadline; at or after the deadline it is expired. Process due phase deadlines before a newly arriving action, even if a timer callback ran late. Timer callbacks carry phase/decision generation and become no-ops after an intervening transition.
- Pause and resume turn time using explicit stored remaining duration; use the PRD's five-second minimum after offer expiry/cancellation and fresh 20 seconds after a resolved playable challenged hit. Browsers receive server time/deadline information only to render countdowns; they cannot advance or extend phases.
- Give authoritative room state a monotonically increasing revision, preserved across replay within that room. Tag every state-changing snapshot/event with room instance and revision. Advance once per committed room transition, including presence/host changes; rejected commands and matching retries do not increment it. Ephemeral reactions carry the current revision/event ID and do not overwrite state. Send a fresh redacted snapshot on every authenticated reconnect; older revisions cannot overwrite newer state. Keep room/match/lobby identifiers scoped so a prior match's commands cannot affect the next match.
- Gameplay sends are disabled while disconnected. Do not rely on Socket.IO's default offline event buffering; an acknowledgement timeout means the result is unknown until reconciled, not that the command failed or should be retried with a new ID. Any allowed retry uses the same identity/context/request ID and still passes current-connection authorization.

Documentation: [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/), [offline buffering](https://socket.io/docs/v4/client-offline-behavior/).

### Blackjack Engine

Implements `prd.md > Blackjack Rules and Player Turns` and `Blackjack Settlement and Round Progression`.

Own server-side shoe/card evaluation, legal actions, seating order, natural/dealer rules, and settlement decisions. Keep rules independent of transport and storage so later persistence can be added without rewriting card logic. No future House, duel, Chaos, or Vault engine is introduced.

Represent each of the 312 cards with a unique per-shoe card ID. Refresh/shuffle six decks for each round using Fisher–Yates with server `crypto.randomInt`; consume cards without replacement using a cursor. Tests inject known shoes/randomness through constructors, never production client commands. Evaluate total plus `soft`, `bust`, and initial-two-card `natural`; hard 12–20 and `offerUsed=false` determine claim eligibility with funds/phase checks.

Dealer natural check precedes all player decisions; natural pushes versus natural, otherwise beats non-natural hands. Player naturals take no turn and settle once at the agreed round boundary. Dealer hits through 16, stands on soft/hard 17, and cannot override player bust losses. Implement skipped/empty rounds without drawing cards. Public projections hide the dealer hole card/derived total until reveal and never transmit shoe order, RNG state, or private credentials.

### Chip Accounting

Implements `prd.md > Betting and Chip Availability`, `Call My Bluff Reveal and Settlement`, and `Final Consistency Review`.

Use integer fictional chips, not floating point or cents. Approved wagers are multiples of 50, so multiplying by 3/2 yields exact integer natural profits (50 → 75); balances may end in 25. Validate safe integer amounts everywhere.

Derived accounting representation:

- `balance` is the player's uncommitted stack, including temporarily reserved chips. `reserved` is a sum of active wager reservations still inside that stack. `available = balance - reserved`. The UI displays available, reserved, and committed stakes distinctly; reservations are not winnings/losses.
- Reserve: create/replace the reservation without debiting balance. Editing validates against availability plus release of the previous reservation; withdrawal releases it once.
- Commit: debit balance by the reserved amount once, remove that reservation, and put the same amount into a committed Blackjack wager or challenge escrow. The available amount does not suffer a second reduction from carrying both reservation and commitment.
- Blackjack settlement consumes its escrow once: loss credits zero; push credits the stake; normal win credits twice the stake; natural credits 5/2 times the stake. Mark that wager's settlement ID, update the dealer's net transfer record, and never pay it through the challenge ledger.
- Accepted challenge: convert the claimant's reservation and an atomically validated/reserved matching challenger stake into escrow; draw and credit the whole pot to its winner inside that same candidate transition. The short-lived escrow ends in a settlement record; the later reveal phase does not pay again. Record the displayed net +wager/-wager, one win/loss for each participant, and pot size for highlights.
- Scope settlement IDs to match/round/player/wager or match/offer. Repeated settlement application is a no-op for money and statistics. Rejected acceptance leaves both accounts and the offer unchanged, unless a separate genuine deadline transition has expired it.

Invariants after every committed transition: balances, availability, reservation sums, and live escrow are nonnegative safe integers; reservation sums never exceed balances; a wager has only one accounting status; one accepted offer has one drawn-card record and one settlement; each accepted event contributes one win and one loss. Across a match, sum of player balances plus live committed escrow equals initial player chips plus cumulative net dealer transfers. Reservations are already included in balances and must not be added again. Challenge transfers conserve this sum; only permitted Blackjack outcomes change it. No player-controlled House, commission, Vault, or purchased chips exist.

### Room and Match Lifecycle

Implements `prd.md > Host Departure and Room Lifetime`, `Early Match Conclusion`, and `Match Results`.

Server-owned phases and deadlines implement the PRD's pauses, resumed timers, automatic Stand, 30/60-second host transfer, low-player recovery before affordability checks, settled early results, replay reset, and protected cleanup. In-process host migration changes administrative permission; it does not move the running backend or dealer.

#### Game Phases and Deadlines

| Phase | Authoritative progression and permitted actions |
|---|---|
| `LOBBY` | Create/join, own Ready, Leave; valid current host starts 2–6 connected ready guests |
| `BETTING` | 20-second deadline; submit/edit/withdraw reserved bets; deadline commits submissions, including absent/departed submitters |
| `DEALING` | Deal once from server shoe; no gameplay actions; initial dealer natural resolves before player decisions |
| `PLAYER_TURN` | One active player/decision; Hit/Stand/eligible offer; 20-second clock, valid playable hit resets; expiry stands, 21/bust finishes |
| `BLUFF_OFFER` | Eight-second deadline, one used offer for this hand, claimant reservation, paused normal timer; eligible opponent accepts first; expiry/cancel releases without a draw |
| `BLUFF_REVEAL` | Card/result/money already recorded atomically; reject hand-changing actions, retain reactions; server advances after the reveal deadline |
| `DEALER_TURN` | Server reveals hole card and follows dealer rules, stepping through short displays; never accepts client-supplied draws |
| `ROUND_RESULT` | Exactly-once Blackjack settlement and summary; three counted rounds lead to normal results; otherwise apply safe-boundary checks |
| `WAITING_FOR_PLAYERS` | At a settled boundary below two connected, wait only for the remaining recovery window; start no new round |
| `RESULTS` | Settled normal/early results, no gameplay; return to same lobby and perform the agreed fresh-match reset before next host start |

Low-connection recovery is an independent server deadline while an active round continues, not a replacement that freezes its current phase. At expiry latch `terminationConfirmed=true`; finish that round's obligations, then show early results. Reconnection cancels the recovery clock only before confirmation. At a settled boundary: already-confirmed termination produces early results, including when the current round is round three; otherwise a completed third round produces normal results without starting a new recovery wait; otherwise below two connected waits; otherwise check that two can afford 50; otherwise start the next round after its summary. Never confuse voluntary skipped bets with unaffordable balances.

Offer expiry/cancellation restores the paused turn duration with at least five seconds and issues a fresh decision ID, retaining `offerUsed=true`. Accepted playable hit resumes at 20 seconds after the reveal phase; 21/bust proceeds to the next player. Native timer handles stay outside game state; logical deadlines use an injected monotonic clock, with wall-clock equivalents sent for browser countdown display. Late callbacks check phase/decision/offer generation before doing anything; entering any command handler reconciles due deadlines first. Exact-deadline acceptance is expired.

Temporary presence loss starts normal PRD handling once the server detects disconnection. Same-session connection replacement bypasses that presence loss; genuine disconnection does not pause a normal turn. Lobby host transfer is 30 seconds, active-match host transfer 60, absent lobby seat cleanup 60, low-player recovery 60; old timers are generation-checked after reconnect/phase change. Intentional host departure transfers immediately; intentional active-match departure revokes seat recovery while retaining submitted/committed obligations and final statistics.

Replay increments match/lobby scope identifiers but not resets of the room revision. Reset balances to 1,000 and all hands, current wagers/challenges/statistics/round count/readiness for new gameplay, retain old request/settlement records separately until room disposal, and preserve room code/current eligible members. Ten-minute empty-lobby and fifteen-minute inactive-results cleanup cannot dispose a room with active obligations. Host changes never reset the match.

### In-Memory State Boundary

Implements `prd.md > Disconnects and Reconnection` with the accepted backend-restart limitation.

Rooms, guest mappings, current match state, request outcomes, and settlement history live in server memory. Organize access outside the Blackjack rule functions so a later durable store has a clear integration boundary. Do not build a database adapter, repository framework, or restart recovery now. Never run separate independent replicas against this memory-only state.

### HTTP and Socket Transport

Implements `prd.md > Main Menu and Room Entry`, `Private Rooms and Match Start`, and `Disconnects and Reconnection`.

Use Express on Node's HTTP server and attach Socket.IO to it. Express serves the built Vite directory after API routing; frontend navigation is driven by session/room phase rather than creating additional product screens. Cookie parsing/serialization uses a maintained HTTP cookie utility, not a custom credential grammar. Only public shared contracts are bundled into the browser; server/domain files are never frontend imports.

| HTTP route | Request and response contract |
|---|---|
| `GET /api/health` | `{ok:true,serverInstanceId}` without session data or secrets |
| `GET /api/session` | No mutation/automatic guest creation. No cookie returns `{authenticated:false}`; known cookie returns `{authenticated:true,playerId,roomId?,recoverable}`; unknown/stale credentials or membership returns a typed recovery error. Match-lost recovery shows the approved error/menu action. Use `Cache-Control: no-store`. |
| `POST /api/guest` | Explicit Host/Join entry flow initializes or reuses the guest session; sets the HttpOnly cookie and returns only `{ready:true,serverInstanceId}`. It never assigns a balance or creates a room by itself. Unknown old state cannot trigger this silently during recovery; user must return to the menu and explicitly start an entry action. If already in an active recoverable room, return its recoverable status rather than duplicate membership. |
| Static GETs | Built assets and index; API errors and absent assets must not masquerade as successful HTML responses. No credentials in asset URLs. |

Socket establishment authenticates the cookie and validates origin before claiming the controlling connection. Session readiness is the only prerequisite for explicit room:create/join. Room membership is still validated independently; possession of a room code is not permission to control another guest.

### Shared Contracts and Public Projection

Implements `prd.md > States and Boundaries`, `The Core Journey`, and the exact-once requirements.

Shared TypeScript contracts include action names, envelope/acknowledgement types, public snapshot types, amount/name validation, and public rule constants. Validate raw inbound payloads at runtime; TypeScript annotations alone do not validate hostile or malformed JSON. Keep only public types here, not the shoe, private session store, or server rule executor.

Public snapshots explicitly select fields; do not spread internal room objects. Include room instance/code, revision, viewer's public player ID/control state, member/host/ready/connection state, match/round/phase, public hands, masked/revealed dealer cards, balances/reservations/committed stakes, permitted decisions, deadlines/server time, challenge public state, announcements and missed challenge outcomes, statistics, settled results, and early-ending reason. Never transmit guest credentials, cookie hashes, socket internals, unseen dealer values, or remaining shoe/card order. Reveal-phase public results are already authoritative even while an animation temporarily covers the card.

## Data Model

Accepted ownership: server memory owns rooms, stable guest/session mappings, seats and connection status, host, match/round identifiers, phase, cards/shoe, timers/deadlines, reservations/commitments, balances, challenge state, settlement records, and statistics/results. Browser state is a presentation snapshot plus pending UI actions. The credential lives in the browser's HttpOnly session cookie; it is not readable by application JavaScript. Keep internal session/connection metadata separate from redacted public game state.

### Authoritative Records

| Record | Essential fields and lifetime |
|---|---|
| Process | New random `serverInstanceId` at every boot; session/room registries and runtime socket/timer maps; lost on restart |
| Guest session | Hash of a 32-byte random credential → internal player ID, membership/recovery status, latest connection generation/socket reference; token never returned in JSON/logs; cleaned when no recoverable membership remains and session expires |
| Room state | Random room instance ID, unique short room code, monotonic revision, lobby generation, host player ID, ordered seats/join sequence, phase, current/last results, empty/results inactivity deadlines |
| Player | Stable ID/name/initials/color/seat, connection/departure/ready flags, uncommitted balance and reservations, statistics. Active departed players remain as settlement/result records rather than joinable seats. |
| Match | Unique match ID, participants at start, counted round 1–3, lifecycle/early-ending flags, largest accepted challenge and history. New match IDs never reuse old action scope. |
| Round | Unique round ID, shuffled shoe/cursor, player hands and wagers, dealer hand, active seat, current decision ID, deadlines/paused duration; disposed from active gameplay on replay but settlements retained in history |
| Blackjack wager | Unique wager ID, owner/round, amount, reserved/committed/settled/withdrawn status and settled return; exactly one live amount location |
| Bluff offer/outcome | Unique offer ID, claimant, amount, deadline, paused time, challenger if accepted, open/accepted/expired/cancelled offer status, recorded drawn-card/winner/pot/settlement/event sequence if accepted. Monetary settlement is complete before the separate room BLUFF_REVEAL presentation phase. |
| Request outcome | Authenticated scope + request ID, validated fingerprint, status/code and original applied revision; retained for room lifetime. Entry requests before a room exists are retained on the session and transferred/referenced by its created membership. |
| Settlement | Unique wager/offer settlement ID, participants, consumed escrow, credited amounts, net dealer delta where relevant, and statistics contribution; retained until room cleanup |

A room's authoritative state must be plain structured data suitable for a candidate copy; sockets, timer handles, native clock/RNG functions, and external request caches are separate runtime metadata. There is no saved browser-authoritative balance. A production shuffle is unpredictable; a test fixture can supply a deterministic shoe without changing the gameplay interface.

### Command and Event Contracts

All mutating requests carry a bounded random `requestId`, current room instance and applicable scope identifiers, and validated payload. Player identity comes from the authenticated socket. Name/code are strings, amounts safe integers in the legal range/increment, and identifiers must match active context. Request fingerprints cover action, scope, and canonical validated payload.

| Client → server | Required context and payload |
|---|---|
| `room:create` | Session entry scope; `{username}`; produces room/player membership once |
| `room:join` | Session entry scope; `{username,roomCode}`; validates accepting lobby, duplicate name and capacity |
| `lobby:ready` | Room + lobby generation; `{ready:boolean}` for self only |
| `match:start` | Room + lobby generation; no client-supplied bankroll/participants/dealer rules |
| `bet:submit` / `bet:withdraw` | Room + match + round + betting phase ID; `{amount}` for submit; latest valid submission replaces own reservation |
| `turn:hit` / `turn:stand` | Room + match + round + decision ID; no proposed card/result |
| `bluff:offer` | Room + match + round + decision ID; `{claimType:'NEXT_HIT_SAFE',amount}` |
| `bluff:accept` | Room + match + round + offer ID; amount is derived from offer, not chosen by challenger |
| `reaction:send` | Current room + event scope; one permitted emoji enum; no arbitrary text/HTML |
| `room:leave` | Current membership; explicit permanent active-seat departure or immediate lobby removal, as the current phase requires |
| `results:return` | Room + completed match ID; return to existing lobby/fresh ready cycle without replaying a finished match's commands |
| `state:sync` | Authenticated current controller requests latest snapshot; no mutation or automatic player creation |

Acknowledgements are `{requestId,status:'ok'|'rejected',code,appliedRevision?,currentRevision,roomInstanceId?}` with safe explanatory details, never cookies/secrets. Matching duplicate requests return their recorded outcome and applied revision without modifying state; a separate current snapshot may have advanced. Acknowledgements do not replace the UI's authoritative state. Replaced/unauthenticated controllers are rejected before deduplication. A rejected payload does not consume its still-current decision/offer; independent due deadlines may legitimately advance state first.

Server → client: `room:state` carries the full current public snapshot plus revision and server instance; `room:event` carries an event ID, type, room/match scope and revision for announcements/reveals; `session:replaced` revokes the old controller; `recovery:error` carries an unavailable/revoked/expired reason and menu action. Snapshot application accepts a new room instance after valid recovery/explicit entry, then ignores lower revisions; an equal-revision refresh may update server-time estimation without replaying an already-presented event. Replayed announcement IDs never trigger additional animations or accounting.

Typed errors include invalid input, room missing/full/in progress, name taken, not host/not ready, no membership, session replaced, expired scope/decision/offer, already accepted, insufficient available chips, phase locked, rate limited, and match unavailable. Show an actionable message and synchronize state where appropriate; do not optimistically change cards/balances on failure. Snapshot delivery is the recovery truth, not an endless replay log.

## File Structure

Derived plan for `5-build`; these files do not exist yet. Use npm workspaces for three packages, with shared built exports imported by backend and browser. Root scripts enforce shared-before-server/client build order.

```text
BluffHouse/
├── package.json                 # workspace scripts: dev, build, start, typecheck, test, test:e2e
├── package-lock.json            # resolved dependency versions, created during build
├── tsconfig.base.json           # strict common TypeScript settings
├── .node-version                # compatible Node 24 LTS baseline
├── .env.example                 # secret-free configuration reference
├── .gitignore                   # preserve profile/credential exclusions; add generated output
├── README.md                    # setup, game/restart limits, four-player demo and verification
├── scripts/
│   ├── dev.mjs                  # portable shared watch + backend watch + Vite orchestration
│   └── build.mjs                # shared/server/frontend build sequence
├── packages/shared/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # public workspace exports only
│       ├── protocol.ts          # request/ack/event contracts and typed error codes
│       ├── snapshots.ts         # public redacted data shapes
│       ├── rules.ts             # approved public limits/constants
│       └── validation.ts        # runtime primitives, enums, names/codes/amounts
├── apps/server/
│   ├── package.json
│   ├── tsconfig.json            # compiled Node ESM; shared package uses built exports
│   └── src/
│       ├── index.ts             # real production entry; owns listener/start/stop
│       ├── app.ts               # server factory accepting clock/RNG for tests
│       ├── config.ts            # environment validation and conservative limits
│       ├── http.ts              # session/init/health, cookie handling, assets, origin checks
│       ├── sessions.ts          # token hashes, stable guests and recovery/revocation
│       ├── sockets.ts           # authentication, generation takeover, command admission/acks
│       ├── rooms.ts             # process-local registry, create/join and membership cleanup
│       ├── commands.ts          # context/dedupe + validate/candidate/commit boundary
│       ├── projection.ts        # explicit public snapshots and event redaction
│       ├── scheduler.ts         # logical deadlines + generation-checked runtime wakeups
│       └── game/
│           ├── state.ts         # typed room/match/round/wager/outcome records
│           ├── cards.ts         # six decks, shuffle, evaluation and unique card consumption
│           ├── blackjack.ts     # turn/dealer rules and Blackjack result calculation
│           ├── ledger.ts        # reserve/commit/release/settle and accounting invariants
│           ├── bluff.ts         # eligibility, offer, atomic acceptance/result, expiry
│           └── lifecycle.ts     # phase progression, presence, host transfer, early end, replay
├── apps/web/
│   ├── package.json
│   ├── tsconfig.json
│   ├── index.html
│   ├── vite.config.ts           # React/Tailwind plugins; API/socket development proxy
│   ├── public/                  # licensed local fonts/assets; no game data
│   └── src/
│       ├── main.tsx
│       ├── App.tsx              # menu/lobby/table/results from authoritative session phase
│       ├── styles.css           # theme tokens, table/mobile layouts, bounded/reduced motion
│       ├── connection.ts       # session bootstrap, socket, takeover and snapshot reconciliation
│       ├── commands.ts         # context-aware request IDs and pending-action handling
│       ├── screens/
│       │   ├── MainMenu.tsx     # logo/tagline, entry forms, How to Play
│       │   ├── Lobby.tsx        # room code, seats/readiness, host start
│       │   ├── Table.tsx        # seats, dealer, phase, timers, betting/turn controls
│       │   └── Results.tsx      # settled leaderboard, stats, highlight, early reason, replay
│       └── components/
│           ├── Cards.tsx        # public card/hidden dealer display
│           ├── PlayerSeat.tsx   # identity, public hand, funds and connection/turn badges
│           ├── BluffEvent.tsx   # offer/accept/reveal from recorded authoritative event
│           ├── SocialFeed.tsx   # announcements and bounded emoji reactions
│           └── Recovery.tsx     # reconnect, replaced, unavailable states
├── tests/
│   ├── unit/
│   │   ├── cards.test.ts
│   │   ├── blackjack.test.ts
│   │   ├── ledger.test.ts
│   │   └── bluff.test.ts
│   ├── integration/
│   │   ├── commands.test.ts     # duplicates, atomic failure, competing acceptances/revisions
│   │   ├── deadlines.test.ts    # boundaries, late callbacks and pauses
│   │   ├── recovery.test.ts     # cookie/session takeover, stale sockets, restart behavior
│   │   └── lifecycle.test.ts    # host, affordability, early end, empty rounds, replay/cleanup
│   ├── e2e/
│   │   ├── match.spec.ts        # four isolated contexts, three rounds, challenge, results/replay
│   │   └── recovery.spec.ts     # refresh, second tab, restart and mobile smoke
│   └── fixtures/
│       ├── clock.ts            # injected clock/deadline control, no public route
│       ├── shoes.ts            # deterministic hard/soft/natural/bust card sequences
│       └── server.ts           # loopback-only test app factory and browser-test fixture
├── vitest.config.ts
├── playwright.config.ts
└── devpost/                     # approved scope/PRD, this draft, roadmap/vision; profile ignored
```

This is a proportional module plan, not a requirement for a particular line count or framework. `game/` depends on plain types/clock/RNG boundaries, not Express/Socket.IO; transport calls it, not vice versa. Generated `dist`, `node_modules`, test artifacts and credential files are ignored; learner-profile ignore rules are preserved. Hosting configuration is added only after the provider choice.

## External Services and Dependencies

No external runtime API, model provider, database, storage account, OAuth provider, payment gateway, or API key is required for gameplay. Express/Socket.IO share the single backend listener; local UI assets/fonts avoid a CDN dependency during the demo. Registry access and a browser download are needed during setup, not per turn.

Render is the only selected external runtime service: Free for initial testing, optional paid compute if needed for submission. The app makes no Render control-plane API calls; deployment is a provider dashboard/Git integration with the selected build/start settings. Provider account/billing access is configured directly by the learner, not pasted into chat or source. Recheck plan/usage cost before provisioning; no load guarantee is inferred from either instance size. Documentation is linked under Stack and the deployment section.

### Configuration and Basic Abuse Protection

| Setting | Contract |
|---|---|
| `NODE_ENV` | development locally (default when unset), test for injected test fixtures only, production explicitly set on Render |
| `PORT` | backend listener, 3000 local and assigned host port in production |
| `PUBLIC_ORIGIN` | exact browser-facing origin, localhost:5173 in proxied dev / localhost:3000 local compiled demo / deployed HTTPS origin |
| `HOST` | loopback locally; 0.0.0.0 on deployed service |

Load local configuration from an optional root `.env` using Node's environment-file support; hosted configuration comes from Render environment variables. The compiled-server start contract is `node --env-file-if-exists=.env apps/server/dist/index.js`. `NODE_ENV=production`, `HOST=0.0.0.0`, assigned `PORT`, and the exact HTTPS `PUBLIC_ORIGIN` are explicit Render settings. Locally, compiled-demo defaults remain HTTP-safe development settings at localhost:3000; merely compiling the app does not silently enable Secure cookies on an HTTP demo.

No frontend secret environment variables. Deployment secrets, if any become necessary, belong in environment variables; do not add them to source or frontend Vite variables. Runtime guest credentials remain cryptographically generated cookie/session data, never environment-variable or source-code constants. Cookie name/protections and gameplay timing/rules are server configuration/constants, not client-controlled inputs. No shared JWT/session signing secret is required for random opaque tokens looked up by hash in memory. `.env.example` contains safe examples, never real cookie values or hosting credentials.

SameSite=Lax is defense in depth, not complete WebSocket protection. Validate exact Origin on browser HTTP mutations and Socket.IO handshakes/upgrades, using Socket.IO request admission for WebSockets as well as HTTP transport. Production uses a single permitted origin with credentials; dev uses its explicit proxy origin. Do not rely on CORS alone to protect WebSocket upgrades. Trust only the known hosting reverse proxy when determining HTTPS/IP; do not blindly trust arbitrary forwarded headers.

Bound incoming payloads (derived default 4 KiB), rate-limit room entry by trusted client IP and commands by authenticated session (for review: 20 per second with a small burst allowance; emoji one per second), cap admitted rooms to a small configurable demo limit (initially 20), and validate capacity server-side. Limit invalid traffic before allocating room-lifetime request records. Do not evict valid settlement protection to make space or block mandatory internal settlement/timeout transitions. These are basic demo protections, not anti-cheat identity verification or a production public matchmaking service. Logs record safe IDs/action/error codes only, never Cookie headers, bearer credentials, hidden shoe/dealer values, or user-controlled HTML.

Read [Socket.IO CORS and request admission](https://socket.io/docs/v4/handling-cors/), [Socket.IO server options](https://socket.io/docs/v4/server-options/), [HTTP cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie), and [cookie parser/serializer](https://github.com/jshttp/cookie) for the relevant API/configuration details.

## Important Failure Modes

- **Temporary network loss or refresh:** preserve server-side guest/match data, authenticate the same session cookie, replace the controller safely, and send current authoritative state. Do not reset identity, chips, or clocks. A replaced connection's delayed events cannot affect its successor.
- **Repeated, competing, delayed, or retried commands:** current-connection checks, context-aware idempotency, private candidate commits, deadline reconciliation, and settlement records prevent duplicate effects while the process remains alive. Invalid commands get a typed rejection/current snapshot; never assume an ack timeout means no effect.
- **Backend process loss/redeployment/Free idle spin-down:** active in-memory state can be lost. Show a connecting/waking state while unavailable, then the unavailable-match message if the process has lost recovery data. Do not fabricate settlement or silently recreate a player; allow explicit return to the main menu. Exact-once settlement is an in-process game guarantee, not durable recovery across crashes. Free-tier evaluation determines whether the optional paid upgrade is necessary before submission.

## What Was Simplified and Why

- One authoritative process and one production origin keep room ownership and deployment simple.
- Memory-only guest matches avoid database setup and recovery work; the learner explicitly accepts match loss on backend restart.
- Sequential per-room processing avoids distributed locks and multiple-writer coordination; idempotent actions and settlements still protect correctness.
- Separate rule logic from transport/storage for later evolution, without adding deferred game mechanics or generalized infrastructure.
- One guest per browser profile and one controlling connection avoid multi-controller conflicts. Use isolated browser contexts/profiles or devices for separate players; no cross-device credential recovery.
- One Render service stays compatible with Free and paid compute. Accept cold starts/process loss during early hosted tests, then evaluate whether the same service needs the optional paid plan for the final experience, avoiding premature hosting expense.

## Verification Approach

### Accepted Session and Recovery Scenarios

The learner explicitly requested the following checks. Use Vitest integration fixtures and selected Playwright browser journeys; no public testing endpoint is required:

| Scenario | Required evidence |
|---|---|
| Refresh during Blackjack | Same player, seat, cards, balances and latest turn restored; no new chips or reset clock |
| Reconnect during accepted challenge | Latest authoritative result, one drawn card, one pot settlement and correct hand continuation |
| Second tab opens mid-match | Newest authenticated connection controls; old tab displays "Session opened elsewhere" and cannot act or reconnect automatically |
| Old controller sends a late command or disconnect | Server rejects mutation and retains the replacement's connected status and host/timer state |
| Former host returns after transfer | Original player seat restored, current host unchanged |
| Recovery after backend restart | Explicit unavailable-session/match response, menu action, no silent replacement or invented payout |

Use separate browser profiles, isolated Playwright contexts, or different devices for distinct players. A second tab inside one context tests replacement of the same player rather than another seat. Cookie redaction and lack of JavaScript access must also be checked.

### Rules and Chip Invariants — Vitest

Inject known shoes and clock/random providers into the plain game modules. Cover multiple-Ace/hard/soft totals; naturals versus dealer naturals and later 21; soft-17 Stand; bust losses even when dealer busts; shuffle card-ID uniqueness and round refresh; the approved 50/100/250 wager payouts; exact 25-chip results; invalid fractions/amounts and insufficient funds; replacement/withdrawal reservations; independent challenge/Blackjack settlements; and no double debit when a reservation commits.

Assert the ledger invariants after complete meaningful action sequences, not only isolated arithmetic helpers. A failed acceptance must leave the offer, shoe cursor, both balances, escrow, statistics, and revision unchanged (except an independent due deadline transition where appropriate). Test both insufficient claimant and insufficient challenger, stale phase/context, and malformed requests. Production RNG is not replaced by an arbitrary browser seed.

### Command, Clock and Lifecycle Integration — Vitest

Use the real application command/transport boundary where practical with Socket.IO test clients, an injected clock/scheduler, and deterministic cards:

- Race two challengers; exactly one consumes the offer and one card/pot outcome appears.
- Retry identical request IDs; reject changed payload under one ID; issue distinct request IDs for one decision; reject consumed/expired decision/offer IDs. Retain outcomes through replay and reject previous-match commands.
- Accept just before, exactly at, and after eight seconds; a delayed expiry callback cannot let a late acceptance succeed. Old callbacks after phase change, cancellation, reconnect, or replay are no-ops.
- Verify paused-time/minimum-five recovery, fresh-20 after accepted playable hit, 21/bust hand end, and automatic Stand. No disconnected command buffering/replay can extend timers.
- Disconnect immediately before acceptance (cancel/release, no card) and immediately after acceptance (recorded result remains, one draw/payout). Invalid acceptance never consumes a valid offer. Mid-reveal actions are rejected while observers still react.
- Verify one revision per committed transition, no revision for a duplicate/rejection, tagged events, out-of-order snapshot rejection, and snapshot correctness after dropped broadcasts/acks. An unrelated reaction does not invalidate a current decision.
- Host transfer at 30/60 seconds; no privilege reclaim; stale-socket disconnect ignored; explicit departure differs from temporary loss. Verify 60-second low-player recovery before affordability, irreversible termination, completed current wagers, and results including absent/departed players.
- If recovery expires during round three, that round still settles before early results and the early-ending reason is retained. If round three finishes without confirmed termination, show normal results immediately rather than adding a new recovery wait.
- All-skip rounds draw nothing but count; unfunded observers can react; one/zero eligible players ends only at the appropriate boundary. Three rounds finish normally. Replay preserves room code but resets all match state/readiness and cannot revive prior requests.
- Empty-lobby/results cleanup at 10/15 minutes and absent lobby seat cleanup at 60 seconds; no cleanup while active obligations remain. Restart uses new process state and rejects old recovery rather than creating a new player.

### Four-Player Browser Proof — Playwright

Start a loopback application fixture through its constructor with test-only injected shoe and clock, then open four isolated BrowserContexts (one guest each). This fixture is not a route or production feature; production entry never loads it. Exercise real UI controls, HTTP cookies, and Socket.IO for all four browsers.

Create one private room, join three guests, ready everyone, host-start, and complete three rounds with real bet/turn commands. The known fixture shoe guarantees a hard eligible hand and accepted challenge; cover a claimant win and a bust loss across tests rather than hoping random draws create them. Observe the same public card, correct available/reserved/committed amounts, one challenge pot transfer, live standings, final winner/ties/statistics/highlight, and same-room replay reset. Advance only the injected server clock for deadlines; use UI assertions rather than arbitrary sleeps.

Additional browser checks: refresh during a turn and reveal; a same-context second tab disables its predecessor server-side; reconnect after host transfer; missing-match restart screen; invalid/full/in-progress join errors; and a mobile viewport smoke for usable controls/no page overflow. Integration tests cover the detailed adversarial matrix; browser tests need not duplicate every rule test. After local checks pass and hosted testing is authorized, run a four-player Render smoke, observe an actual Free cold start/idle recovery when feasible, and verify that process loss gives the expected unavailable-match response. Record deployment stability/performance and the Free-versus-paid decision before submission; manually inspect desktop/mobile casino presentation before recording. Tests simulate process loss without requiring repeated paid or hosted restarts.

### Build Gates and Evidence

Required gates are type checking, meaningful Vitest rules/integration tests, a production build, and the Playwright four-player flow/recovery smoke. Record actual commands/results in `5-build`; do not describe this plan as tests already passing. Verify a fresh npm ci setup and local compiled demo before shipping. Avoid repeated full runs once checks pass unless edits or failures justify them. A live multiplayer/settlement failure blocks claiming a working core; visual polish never substitutes for that proof.

## Implementation Priorities and Milestone Acceptance

The learner explicitly approved these priorities without changing MVP scope. `5-build` may refine their order and split working steps according to real dependencies, but must present the implementation approach for learner review before generating application code. Foundations needed by later steps (stable guest identity, command validation, room revisions, clock injection) should be established early rather than retrofitted. Use minimal functional UI to prove gameplay before completing decorative polish.

These are planned milestone criteria and tests, not a claim of completed work. Each build milestone must identify its PRD/spec references, observable acceptance criteria, relevant tests, actual verification commands/results, and remaining limitations. Run relevant automated tests during each milestone; the final verification milestone integrates evidence rather than postponing testing until the end.

| Priority / milestone | Acceptance criteria | Relevant planned verification |
|---|---|---|
| 1. Working frontend, backend, and private multiplayer rooms | Local frontend/backend start with documented commands; distinct guests can create/join one room, see synchronized seats/readiness/host, receive clear invalid/full/in-progress errors, and start only under approved conditions. Establish authenticated identity and command/state boundaries for later lifecycle work. | Typecheck/build smoke; room/session admission and readiness integration cases in lifecycle/recovery tests; a minimal multi-context browser room flow. |
| 2. Authoritative Blackjack engine | Server-owned six-deck shoe, totals/naturals, legal hit/stand decisions, seating order, dealer soft-17 behavior, turn expiry, and round progression produce the approved outcomes; browser cannot choose cards or results. Monetary settlement connects to the verified ledger in milestone 3. | cards.test.ts, blackjack.test.ts, deadlines.test.ts; deterministic hard/soft/natural/bust fixtures and server turn integration. |
| 3. Chip accounting and exactly-once settlement | Bets reserve immediately, edits/withdrawals do not duplicate reservations, close commits once, and each Blackjack bet pays correctly once including 3:2/25-chip balances. Available/reserved/committed values satisfy the ledger invariant; stale/duplicate requests cannot spend twice. | ledger.test.ts and commands.test.ts; approved payout examples, insufficient funds, reservation replacement, repeated settlement and dealer-transfer accounting sequences. |
| 4. Call My Bluff on verified Blackjack/accounting | Hard 12–20, one offer per hand, eight-second deadline, first valid challenger, no-challenger release without hit, and one atomic accepted card/pot/statistics outcome. Invalid acceptance leaves no partial mutation; server reveal phase prevents hand changes. | bluff.test.ts, commands.test.ts, deadlines.test.ts; competing/duplicate/different-ID acceptance, deadline boundaries, failed candidate validation, revision correctness and reveal lock; minimal shared browser reveal. |
| 5. Reconnection, host transfer, and required lifecycle | Refresh/temp loss restores the original guest and snapshot without new chips; newest tab controls and old commands/disconnects are harmless; committed wagers remain binding. Host transfer, intentional departure, low-player recovery, affordability, early endings and protected cleanup match the PRD. | recovery.test.ts, lifecycle.test.ts, deadlines.test.ts and browser recovery flows; before/after acceptance disconnect, host return, restart-loss error and early-third-round precedence. |
| 6. Complete multiplayer UI, results, and replay | Required casino menu/lobby/table/results are usable on desktop/mobile; shared announcements/emoji and clear stakes/turns/reveals are present. Settled winners/ties, accepted challenge records/highlight, same-room replay and complete readiness/match resets are correct. | Results/replay integration cases, match.spec.ts and mobile browser smoke; manual visual/readability/reduced-motion checks, keeping responsiveness and correctness ahead of optional chat/effects. |
| 7. Automated gates and complete four-player proof | Four isolated players complete three counted Blackjack rounds with accepted bluff challenges, synchronized balances/cards, correct final results, and a fresh same-room replay. Type checking, meaningful unit/integration suites, production build and browser gates pass with recorded evidence. | Full required Vitest and Playwright gates, clean npm ci reproducibility, local compiled demo; complete match.spec.ts/recovery.spec.ts with deterministic fixtures plus a real-randomness manual playthrough. |
| 8. Deploy and test before submission preparation | After local verification and separate deployment authorization, one Render service serves UI/API/Socket.IO correctly on its assigned PORT. Free cold start/reconnect/restart-loss behavior and a four-player hosted match are evaluated; retain Free or upgrade the same service only if needed under the accepted cost strategy. Verify the final URL before preparing/recording the submission. | Hosted health/cookie/WebSocket/four-player smoke, observed cold-start and restart-recovery results, desktop/mobile check, recorded Free-versus-paid assessment and local-recording fallback. No service or charges are created by this document. |

The exact ordered build checklist belongs to the separately invoked `5-build` workflow. Do not create it or begin implementation solely because this specification is approved. Optional chat, advanced backgrounds, and all deferred roadmap mechanics remain outside the critical completion path.

## Decisions and Open Issues

### Accepted Decisions

The learner approved React/TypeScript/Vite/Tailwind, one authoritative Node.js/TypeScript process using Socket.IO, in-memory game state, sequential room commands, request identifiers, and settlement tracking. Serve the frontend from that same process and origin. Render Free is accepted for initial hosted tests, including idle sleeping and match loss; an optional paid upgrade is preferred if needed for final stability, superseding the initial non-sleeping-only preference. Serverless execution remains excluded. Refresh/reconnect must preserve the existing player while the process lives; process restarts may invalidate matches with a clear recovery error. PostgreSQL, Redis, microservices, and restart persistence are not approved additions.

The learner also approved cryptographically random HttpOnly guest-session cookies with production Secure/SameSite protections, no credential exposure/logging, stable identity independent of socket IDs, newest-connection control enforced by the server, stale-connection rejection, and fresh authoritative snapshots on recovery. One player per browser profile is an accepted limitation.

The learner approved the complete command/deadline model and additionally required no partial mutation on failed acceptance, one synchronous validated outcome including money/cards/statistics, monotonic room revisions, a server-controlled reveal lock, same-ID payload conflict rejection, stale timer/decision/offer rejection, room-lifetime request/settlement records, and snapshot-first recovery with discarded offline actions. The adversarial test scenarios above directly implement their requested evidence.

### Approved Implementation Details

The integer-chip ledger, candidate-copy commit mechanism, phase/command tables, same-origin HTTP adapter, modest TypeScript workspace/module layout, runtime/version baseline, CSS presentation defaults and test organization derive from those decisions and are covered by the learner's technical-specification approval. No database, external queue, distributed lock, microservice, account platform, new claim, or deferred game system has been added. The learner additionally specified the milestone priorities and verification expectations above.

### Remaining Verification and Build Handoff

No consequential architecture or deployment-platform choice remains unresolved. The learner explicitly approved this blueprint, completing `4-spec`. Next they will separately invoke `5-build` and review the implementation approach before code generation. Current work authorizes the planning-document updates only; no application implementation, hosting-service creation, paid compute, or deployment starts here.

Exact resolved dependency patches/plugin compatibility, available Render account configuration, actual cold-start behavior/performance and the eventual need for the optional paid upgrade are build/shipping verification tasks, not reasons to extend this planning interview. Use the recorded Free-first strategy and retain local recording as a fallback. Document a real incompatibility rather than silently changing the accepted stack. No package resolution, runtime test, performance measurement, or deployment has been performed during this planning stage.

### Learning Intention and Clarifications

The learner wants to understand real-time networking and complex game state. The interview clarified the actual technical ambiguities between transport delivery and game-effect idempotency, request identity versus decision identity, and atomic recorded settlement versus its later animation. The learner explicitly approved those distinctions and required failed-validation atomicity; candidate-state invariants and competing-acceptance tests are the agreed practical verification. No additional personal uncertainty was volunteered, and no extra technology or comprehension quiz is needed.

### Self-Review and Scope Traceability

Every PRD behavior has a home: room entry/readiness in HTTP/session/room components; wagering in ledger/command validation; cards/dealer in Blackjack; offers/results in bluff plus reveal phase; reactions in public events/UI; disconnect/host/ending/cleanup in lifecycle and connection generation; final records/replay in lifecycle/results projection. Public contracts exclude server secrets and unseen cards. Request caches remain outside candidate state but refer to immutable scoped outcomes, so duplicate acknowledgements cannot become a second mutation. Persistence remains explicitly absent; process loss cannot be described as ordinary recoverable disconnection.

#### PRD Consistency Review

This is a planning-document review, not evidence that application tests have run. All ten headings under the approved PRD's Features and Behavior are addressed:

| PRD behavior | Specification home and planned evidence |
|---|---|
| Private Rooms and Match Start | Guest sessions, HTTP/socket admission and room lifecycle; four-context join/readiness/host-start proof |
| Betting and Chip Availability | Integer ledger and command envelope; edits/withdrawals, reserved-to-committed conversion, absent submitters, 25-chip payouts and no duplicate charge |
| Blackjack Rules and Player Turns | Blackjack engine and phase table; six-deck refresh, Ace/natural precedence, hit/stand, soft-17 dealer, 20-second automatic Stand |
| Blackjack Settlement and Round Progression | Separate Blackjack settlements and lifecycle; one payout, all-skip no-card counted rounds, normal three-round finish |
| Call My Bluff Eligibility and Offer | Bluff/command modules; hard 12–20, one offer per hand, eight seconds, first valid acceptance, no challenger means release/no draw and five-second minimum |
| Call My Bluff Reveal and Settlement | Candidate-copy atomic commit and reveal phase; exactly one draw/pot/statistics update, failed-validation rollback, server-controlled lock and consistent snapshots |
| Shared Reactions and Announcements | Public event contracts and SocialFeed; required emoji/announcements, optional text chat, bounded presentation without turn changes |
| Disconnects and Reconnection | HttpOnly credentials, generation-controlled sockets and snapshot recovery; refresh/takeover/replaced commands, binding accepted bets and intentional-departure revocation |
| Host Departure and Room Lifetime | Lifecycle/deadline generation; 30/60-second host transfer, no automatic privilege reclaim, 60-second absent-lobby seats and 10/15-minute safe cleanup |
| Early Match Conclusion | Parallel low-player countdown and safe-boundary precedence; honor recovery before affordability, retain confirmed early termination even in round three, settle before ranking absent/departed participants |

Results/replay are also traced to `prd.md > Match Results`: final settled balances and shared first place, accepted wins/losses for both participants, largest accepted pot with earliest tie-break/no-event message, same room/code/group where appropriate, and complete match/readiness reset. The later paid-upgrade option changes only compute configuration, not game rules or persistence. No deferred House/duel/bounty/deal/Chaos/Vault/profile/voice/extra-claim system is implemented by this blueprint.

The review reconciled the accepted Free-first hosting choice with earlier non-sleeping-only language, specified development versus compiled-demo origin/cookie settings, and corrected third-round ending precedence. No unresolved product/architecture contradiction was identified after those corrections. Exact resolved dependencies and real hosted performance remain explicit verification tasks.

The full roadmap and original vision remain unchanged by this specification. The largest implementation risks are lifecycle ordering/recovery and the number of coupled acceptance tests, not the database-free runtime. Prove the real four-player Blackjack/bluff journey early in `5-build`, then polish; preserve required timers/settlement safeguards rather than spending the deadline on optional chat or atmospheric animation. Render Free's cold start and restart behavior are accepted initial-test limitations with an explicit final-deployment evaluation gate.

This specification is `approved`. No implementation, package installation, hosting-service creation, paid upgrade, or deployment has begun.
