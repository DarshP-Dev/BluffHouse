# Bluff House — Future Roadmap

This preserves future intent, not approved implementation work. `scope.md` and `prd.md` define the approved MVP. The original full vision is retained in `vision.md`.

## Expansion Gate and Priorities

Complete and test the core multiplayer Blackjack / Call My Bluff experience first, protecting demo and submission time. Basic text chat is conditional within the MVP effort. If time remains, discuss hidden House auctions first; the Vault is a subsequent preference. No other ordering or delivery dates are established.

## Retained Systems

- **Blackjack expansion:** double down, originally requested in the full vision and outside the hit/stand MVP; splitting, insurance, and surrender were also explicitly deferred during the product interview.
- **Become the House:** sealed starting-chip bids; highest bidder wins, ties randomly resolved among tied bidders; winning bid funds the Vault; House receives a balanced commission on Blackjack winnings. After at least one House round, 75% of eligible non-House players can trigger an overthrow; randomly select an eligible challenger, then a duel determines ownership. House cannot manipulate random card draws.
- **Fast duels:** matched virtual-chip wagers, challenged player chooses the minigame, winner takes the pot, others spectate. Target roughly a minute or less. Candidates: Rock Paper Scissors, Connect 4, Bullet Chess, Coin Flip. Also support overthrows and bounty challenges. Timing feasibility remains to be validated for each game.
- **Bounty Board:** players create and contribute to bounties; target chooses the duel game. Three consecutive successful bounty defenses let the target claim the bounty. A loss pays most to the challenger and a smaller portion to the Vault. Include safeguards against challenge spam.
- **Deals and Betrayals:** two players commit chips and secretly choose Split or Steal. Split/Split returns shares plus a cooperation bonus; a lone Steal takes the pot; Steal/Steal sends the pot to the Vault. Bonus funding and balance remain future design questions.
- **Chaos Cards:** award cards to the bottom two chip positions after eligible rounds, including everyone tied at qualifying positions. Possible effects: double/triple eligible wagers or pots, swap hands, rotate hands left, discard/redraw a recent card, bonus chips, special betting conditions. Define activation windows, limits, funding, and balance before building.
- **Vault finale:** grow the Vault through auctions, contributions, penalties, and designated mechanics; end with a Blackjack showdown and comeback opportunity. Shadow Draw allows hidden draws, optional reveals or claims, and calls by other players including the House. Reward successful bluffs, penalize caught bluffs and incorrect calls; possible consequence is revealing the challenger's hidden cards. Exact rules remain future work.
- **Platform:** public Quick Play, accounts and persistent/customizable profiles, avatars, unlockable achievement badges, match and lifetime leaderboards, in-game text chat if not delivered earlier, optional open-mic voice, and dedicated spectator views for duels and major events. Private room codes and current-match standings are already in the core scope.

## Future Call My Bluff Claims

- "I'll beat the dealer this round."
- "My next card will put me at exactly 21."
- "I'll win this round with three or more cards."
- "The dealer is going to bust."

Preserve extensibility for additional claim types during technical planning. These claims, further player interactions, and Shadow Draw are not initial-MVP requirements.

## Continuing Product Boundary

Entertainment with fictional virtual chips only; no real-money gambling, deposits, purchases of wagerable chips, or cash redemption.

Advanced recovery, long-term match restoration, and guest recovery across unrelated devices are deferred. The MVP supports same-session recovery within its room/match lifecycle.


## Phase 5 Party Expansion Approval

The learner approved the 17-slice Fast-mode build in `checklist.md`, including its corrected **Approved Party-Mode Rules**. The original Classic three-round Blackjack / Call My Bluff behavior above remains the required baseline. Deferred-from-POC language describes that Classic boundary; the approved additional Party work follows only after the verified slice-3 core and actual early learner feedback. The original vision is preserved.

Party commissions are additional fictional dealer-bank payments: floor(3% of eligible positive Blackjack profit), maximum 50 total per round, allocated in settled seat order. They never reduce advertised player payouts and must be included in net dealer funding and idempotent settlement tests. Shadow Draw uses a specific declared total 17–21: an unchallenged lie scores the declaration plus one and can win despite a real bust; challenged exact truth scores real total plus two and penalizes/reveals the incorrect challenger; a caught lie is disqualified and rewards the successful caller two points. No-claim busts are ineligible. Jackpot payouts remain funded and once-only. Six-round Party will attempt two sequential, bounded social contests after the one-contest engine is verified, with an immutable 180-second phase cap and one qualifying bounty defense per target per interval. See the checklist for complete outcome, privacy, deadline, and regression criteria.

This approval authorizes local implementation, verification, and meaningful commits in the existing repository. It does not authorize push, deployment, purchases, or history rewriting. All unimplemented slices remain unchecked.
