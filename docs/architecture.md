# Runtime and rules map

One Express/Socket.IO process serves the compiled React app, same-origin APIs and authenticated commands. Development adds a Vite proxy, never a second game authority. Production uses secure randomness; injected clocks/shoes are test-constructor dependencies only.

1. `apps/server/src/app.ts` issues an opaque HttpOnly guest cookie, checks the exact configured origin and grants control only to the newest socket. Credentials stay out of snapshots and client storage.
2. `apps/server/src/rooms.ts` validates context, caches request fingerprints and reconciles deadlines. A synchronous candidate transition checks authority, rules and invariants before replacing one room root and incrementing its revision. Retries return their original result.
3. `apps/server/src/game/` owns Blackjack, claims, contests, Chaos, House, bounties, deals and Shadow Draw. Commitments have funded sources, owned escrow and once-only settlement; animations cannot draw or pay.
4. `apps/server/src/projection.ts` explicitly builds viewer snapshots. Dealer holes, bids, simultaneous choices, private Shadow hands/shoes and claim proofs remain hidden as required.
5. `apps/web/src/connection.ts` follows snapshots, rejects stale revisions, disables offline sends and reconciles uncertain acknowledgements without replaying speculative actions. Chat has a separate acknowledgement lane so a pending message cannot block Hit/Stand.
6. `apps/web/src/App.tsx` presents the illustrated lounge, three-column lobby, sealed auction stage and responsive dashboard. `reference-theme.css` is imported after the existing component styles; local artwork and its prompts are documented in `ui-artwork.md`. The October 25 gameplay stylesheet loads after the reference theme and keeps the large felt and every seated hand first. Contextual decisions and live evidence follow without moving the table. `BetBuilder.tsx` maintains only a local additive chip draft; the server still authorizes all wagers. `HostControls.tsx` submits validated lobby configuration and `ChessDuelBoard.tsx` renders authoritative clock interpolation. A single chat portal keeps its actual composer/history mounted while its container moves between layout slots, preserving focus, draft, reading position and unread tracking across phase changes.

Party conservation is `balances + committed escrow + Vault + remaining bonus reserve = initial chips + initial reserve + net dealer funding`. Reservations stay inside balance and reduce availability. Peer pots and bonuses never become dealer funding. House commissions are additional dealer-bank payments and never reduce Blackjack returns.

Delayed claims hold two stakes without drawing; actual round settlement evaluates the contract, pays once, then grants Chaos and advances. Unresolved bounties refund before finale entry/ranking. Accepted contests drain during early termination. Shadow Draw has a separate private shoe; its funded award precedes final standings. Replay retains the room/chat/session profile and resets match funds, obligations and statistics.

Demo safeguards: 20 rooms, six seats per room, 2,000 guests, 4KiB incoming payloads, 30 commands/second/guest, 60 entry requests/minute/IP, 60 system events and 100 chat messages per room, two Chaos cards and eight badges per guest, and a 100,000-record request-memory admission cap. Match limits bound contest histories; room cleanup releases request/archive records. These are not measured concurrency guarantees. See the final report for observed load/payload evidence.

Production imports no test fixture or experiment and exposes no clock, draw, voice-signaling or test-control API. Audio experiments remain test-only. Fonts are bundled through `@fontsource/cormorant-garamond`, with the OFL at `apps/web/public/fonts/OFL.txt`; pinned `chess.js` has its recorded BSD license. No external font CDN, API key or paid service is required.


Lobby configuration now validates 1–20 rounds,100–100,000 chips in steps of 10,and5–120 whole seconds per betting/decision turn. Relevant changes reset readiness and lock after match start. Lobby-only kicks remove membership and notify the removed controller without touching active obligations. Room-owned win records increment once at final settlement and survive replay/guest rejoin until that room ends.

R4/R5 accounting and private-card replacements are explicitly approved in `devpost/gameplay-revision-proposal.md` but not present in this R1–R3 snapshot. Existing Party funding and Shadow scoring above describe this recovery build.
