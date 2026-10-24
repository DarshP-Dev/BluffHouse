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

## Try from another device on your LAN

Use the main checkout. Find the PC's Wi-Fi/Ethernet IPv4 address with `ipconfig`, replace `<PC-LAN-IP>` below, and keep both devices on that network. Stop an existing server on the same port first. For the compiled app:

```powershell
$env:HOST = '0.0.0.0'
$env:PUBLIC_ORIGIN = 'http://<PC-LAN-IP>:3000'
npm start
```

Open that exact `PUBLIC_ORIGIN` address on **both** devices, including the host PC. For development, set `DEV_HOST=0.0.0.0`, use `PUBLIC_ORIGIN=http://<PC-LAN-IP>:5173`, and run `npm run dev`. The development backend can remain on `HOST=127.0.0.1`; Vite forwards its requests. `DEV_PORT` and backend `PORT` are configurable and default to 5173 and 3000. A website loading alone does not prove the game connection: create/join a room, ready both guests, start, and refresh during play. Browsers with different profiles/devices should get different seats.

Plain HTTP LAN browsing now uses random request IDs supported outside secure contexts. Socket.IO polling accepts a matching Referer and exact Host when HTTP browsers omit Origin/Fetch Metadata; present foreign origins still fail. The server honors the configured origin instead of forcing localhost. Cookies remain HttpOnly/SameSite=Lax, with Secure required in HTTPS production. Clipboard access may be unavailable over HTTP; select and copy the displayed room code when prompted. If the PC address changes, update the configured origin and restart. Actual second-device confirmation is still required at the Classic checkpoint.

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

Classic is verified through complete three-round multiplayer games, recovery, replay, and the learner's separate-profile playthrough. A physical second-device LAN retry remains an additional pending verification task. Party now adds a sealed House auction, binding editable bids, a funded Vault, and separate dealer-funded commissions without reducing Blackjack payouts. The funded Vault is shared among original participants at match end, including early endings. Later Party features remain unchecked in the approved checklist.

Slice 4 passed type checking, all 225 unit/integration tests, the production build, and the House plus Classic browser journeys (three tests). Earlier Classic evidence includes all 12 browser tests for recovery, transport, lifecycle, and mobile controls. See the checklist for milestone-specific evidence.

Rooms and guest credentials live in server memory. Restarting the backend loses them; the browser must show an unavailable-match recovery path, never silently insert new chips into a lost match. This is a local proof of concept, not durable account storage. The learner authorized normal fast-forward pushes of verified completed slices after inspecting their exact commits and private-file exclusions. Deployment and purchases require separate authorization. Keep the private learner profile and local credentials out of Git.
