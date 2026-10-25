# Room voice feasibility

Evaluation date: October 25, 2026. Scope: approved conditional Phase 5 Slice 16.

The application leaves room voice unavailable while physical-device audio and network connectivity remain unverified. It requests no microphone, creates no peer connections, accepts no voice commands or settings, and provides no recording or transcription. This is an explicit optional gap, not a delivered voice service or a claim that WebRTC itself is unsupported.

## Evaluation boundary

The local transport trial uses Chromium 156 and synthetic WebAudio oscillators in two independent browser contexts. Each context explicitly joins the test. Peers use `iceServers: []`; the test harness exchanges descriptions in memory without adding a production signaling endpoint. Both peers connected with host-only ICE and received audio RTP packets/bytes on the first connection and after leaving/rejoining. The trial made zero `getUserMedia` calls and performed no recording. Synthetic transport is distinct from microphone capture or audible intelligibility.

Mute disabled the owned outgoing track. Leave stopped local and remote tracks and the oscillator, closed the AudioContext and peer connection, and repeated cleanly. The production browser check observed zero microphone-capture, peer-connection and recorder creations through room entry and actual Blackjack play.

The separate permission probe queried both denied and granted microphone states correctly. In each context, an explicit fake-device capture attempt returned `NotSupportedError` with no captured tracks or peer. A diagnostic launch with the documented fake-UI flag produced one fake audio track, but that flag bypasses permission and cannot verify permission handling. The full-browser channel could not launch in this execution environment. These are specific runtime/harness observations; they do not establish that WebRTC or microphone capture is generally unsupported, and they do not prove a `NotAllowedError` permission-denial path.

`npm run typecheck` and the fresh production build passed. The focused integration command passed 4 tests, the full suite passed 847 tests across 39 files, and the required voice/Classic browser command passed 5 tests. The final RTP run observed 6 received packets per peer (413/404 bytes) initially and 5 per peer (372/361 bytes) after rejoining. These are observations from one local trial, not throughput or capacity guarantees. No human microphone, external STUN/TURN server, account, purchase or deployment is involved.

## Remaining product evidence

Physical two-device LAN audio, intelligibility, permission revocation on real hardware, six-person mesh behavior, and general internet/NAT traversal are not verified. Automated fake audio on one computer cannot establish these. The separate game LAN verification task also remains pending. The approved conditional evaluation is complete with voice deferred/unavailable; no room voice signaling, capture or mesh implementation is represented as delivered. Any future TURN or hosted signaling architecture needs its own approval; this evaluation provisions nothing.

## References

- [Official WebRTC testing flags](https://webrtc.github.io/webrtc-org/testing/) distinguish fake devices from bypassed permission prompts.
- [Playwright browser-context permissions](https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions) describe scoped test permissions.
- [W3C WebRTC statistics](https://www.w3.org/TR/webrtc-stats/) define received RTP evidence; packet receipt does not establish intelligibility or general network reachability.
