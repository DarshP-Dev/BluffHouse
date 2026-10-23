# Bluff House

**Trust Nobody. Call Their Bluff.** A private multiplayer Blackjack party game using fictional, nonredeemable chips. One Node process owns rooms, cards, wagers, clocks, and outcomes; browsers send validated commands and display redacted snapshots.

## Local setup (PowerShell)

Use Node 24 LTS. From the existing checkout:

```powershell
Set-Location C:\Users\Darsh\BluffHouse
# Only needed if npm is missing from this shell's PATH:
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
npm ci
npx playwright install chromium
npm run dev
```

Open **http://localhost:5173**. Vite proxies API and Socket.IO traffic to the backend on `127.0.0.1:3000`. Keep using localhost consistently; changing to 127.0.0.1 creates a different browser origin/session. Ctrl+C stops the development processes. Do not run the compiled server on port 3000 at the same time as development.

For a compiled, single-process local demo:

```powershell
npm run build
npm start
```

Open **http://localhost:3000**. No API keys, database, paid service, or real-money mechanism is needed. Optional local configuration belongs in ignored `.env`; see `.env.example`. Production requires an exact HTTPS `PUBLIC_ORIGIN`, `NODE_ENV=production`, `HOST=0.0.0.0`, and the provider's port. No hosting has been provisioned or deployed.

## Play and verification

Use separate browser profiles, independent browsers, or Playwright's isolated contexts for different guests. Tabs in one profile share one HttpOnly guest cookie: the newest connection takes control and the previous tab is replaced. Host a room, share its six-character code, join, ready everyone, and let the host start.

```powershell
npm run typecheck
npm test
npm run test:e2e
```

Unit and integration tests use injected shoes and clocks; browser tests drive actual controls over HTTP and Socket.IO. Test fixtures are local constructors, never public production endpoints. Windows execution sandboxes may block loopback connections; that is an execution-environment limitation rather than a reason to skip multiplayer verification. The normal local PowerShell commands do not require administrator mode.

## Architecture

- `packages/shared/src/index.ts`: public contracts, limits, input primitives.
- `apps/server/src/game/`: cards, chip ledger, Blackjack rules, and serializable game transitions.
- `apps/server/src/rooms.ts`: room admission, command scopes/idempotency, candidate commits, logical deadlines, and lifecycle.
- `apps/server/src/app.ts`: same-origin HTTP, HttpOnly credentials, current-controller authorization, and Socket.IO transport.
- `apps/server/src/projection.ts`: explicit viewer snapshots; no credentials, shoe order, or hidden dealer values.
- `apps/web/src/`: casino UI, connection recovery, pending commands, and server-driven presentation.
- `tests/`: rules, transport/command integration, and isolated-browser journeys.
- `devpost/checklist.md`: approved 17-slice implementation plan and actual verification/progress state.

Reservations stay inside a player's uncommitted balance; available chips exclude them. Commitment moves a reserved stake into escrow once. Settlement consumes escrow once and credits the authoritative return. Player balances plus escrow equal starting chips plus explicit dealer transfers. Request IDs prevent retries; decision IDs prevent different clicks consuming the same decision. Candidate state must pass invariants before one root replacement and revision increment. Animation cannot draw or settle.

## Current implementation boundary

Slice 1 implements private rooms, guest sessions, readiness/host start, funded Blackjack wagers, six-deck server draws, Hit/Stand, dealer resolution, and synchronized round presentation. It passed type checking, 98 unit/integration tests, the production build, and three real-browser tests; the checklist records milestone evidence. Call My Bluff, full recovery regression, and Party systems are not yet advertised as completed. The approved Party corrections remain recorded in the checklist: dealer-funded commissions, successful hidden busted bluffs in Shadow Draw, and a bounded two-contest six-round preset.

Rooms and guest credentials live in server memory. Restarting the backend loses them; the browser must show an unavailable-match recovery path, never silently insert new chips into a lost match. This is a local proof of concept, not durable account storage. No push or deployment is authorized by the build plan. Keep the private learner profile and local credentials out of Git.
