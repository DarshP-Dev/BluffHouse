# Gameplay artwork

Created on 2026-10-25 for the user's requested Chaos-card and achievement-badge visual revision. Both assets were generated with the **built-in image generation tool**, without an API/CLI fallback, then copied into the repository and visually inspected. Live names, effect summaries and achievement evidence remain application text; the artwork contains no labels and does not alter eligibility or game rules.

## Assets and sprite contract

| Asset | Dimensions | Format | File size | Grid |
| --- | --- | --- | --- | --- |
| `apps/web/public/art/chaos-atlas.png` | 1774 × 887 | RGB PNG | 2,904,574 bytes | 4 columns × 2 rows |
| `apps/web/public/art/badges-atlas.png` | 1774 × 887 | RGBA PNG, genuine transparent backdrop | 2,307,374 bytes | 4 columns × 2 rows |

The two atlases have an exact 2:1 canvas ratio and square CSS cells. Source cell boundaries may land on half-pixels; use CSS background sizing instead of cutting or rounding image coordinates. Display a square element with `background-size: 400% 200%`, `background-repeat: no-repeat`, and the positions below. Image art is decorative when a nearby visible label names the card or badge.

| Index | Column | Row | Background position | Chaos kind | Badge ID |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | `0% 0%` | `DOUBLE_DOWN` | `HOUSEBREAKER` |
| 1 | 1 | 0 | `33.333333% 0%` | `TRIPLE_DOWN` | `BOUNTY_HUNTER` |
| 2 | 2 | 0 | `66.666667% 0%` | `POT_TWIST` | `MASTER_BLUFFER` |
| 3 | 3 | 0 | `100% 0%` | `EMERGENCY_FUND` | `VAULT_THIEF` |
| 4 | 0 | 1 | `0% 100%` | `HAND_SWAP` | `UNTOUCHABLE` |
| 5 | 1 | 1 | `33.333333% 100%` | `TABLE_TURN` | `BETRAYER` |
| 6 | 2 | 1 | `66.666667% 100%` | `SECOND_CHANCE` | `HIGH_ROLLER` |
| 7 | 3 | 1 | `100% 100%` | Decorative Chaos card back | `COMEBACK_KING` |

The seven Chaos subjects depict two chip stacks, three chip stacks, a pot vortex, a rescue purse, swapped hands, a rotating table, and a rewind card. Badge emblems depict a broken crown, struck target, masquerade mask, opened vault, protective shield, divided cards/dagger, jeweled chip stack and comeback crown.

## Verification

Both copied repository images were opened with `view_image` and inspected for correct row-major order, unique readable subjects, consistent square cells, no text, no cross-cell objects and the intended gold/navy/purple illustrated style. PNG headers confirm the dimensions and color types above. The badge PNG retains its generated RGBA alpha channel; no raster-editing script or lossy conversion was used.

## Final prompt set

These are the exact final built-in generation prompts. The target dimensions in the prompts were preferences; the generator returned the verified 1774 × 887 dimensions above.

### Chaos atlas

```text
Use case: stylized-concept. Asset type: production game-art sprite atlas for Bluff House, an illustrated social Blackjack game. Create ONE landscape PNG containing EXACTLY EIGHT distinct square game-art tiles in a STRICT uniform FOUR-COLUMN TWO-ROW grid; entire canvas aspect ratio 2:1, preferably 2048x1024. Every cell exactly one quarter of canvas width and one half of canvas height. NO gutters, margins, dividers, text, lettering, numerals, logos or UI.
Style: polished colorful hand-painted cartoon casino collectible-card art, bold clean silhouettes, chunky beveled gold framing INSIDE each cell, rich near-black navy, royal purple, warm gold, jewel green, cyan and magenta glow. Each square cell has an independent fullbleed dark navy/purple vignette; clear distinct subject with ample internal safe padding so CSS can crop exact cells without clipping. Not photorealistic, no people.
ROW 1 left to right:
1 Double Down: TWO chunky red-and-gold casino chip stacks with a large energetic golden upward arrow; vivid ruby.
2 Triple Down: THREE tall green-and-gold chip stacks erupting in golden sparks; vivid emerald.
3 Pot Twist: a glowing cyan swirling vortex lifting mixed poker chips above a little gold jackpot bowl; vivid cyan.
4 Emergency Fund: a gold treasure purse with emerald medical-cross medallion and a few coins spilling; vivid emerald/gold.
ROW 2 left to right:
5 Hand Swap: two white playing cards, one heart and one spade, with two opposed curved blue arrows exchanging their places; vivid blue.
6 Table Turn: a miniature oval green felt casino table ringed by a bright clockwise purple arrow with cards circling; vivid violet.
7 Second Chance: one white playing card emerging from a magical golden rewind ring, a second shadow card fading behind; vivid orange/gold.
8 decorative card back: large luminous gold spade emblem inside a purple jeweled diamond, elegant ornate card-back pattern.
Important: precise uniform 4x2 sprite grid, each cell illustration independent and centered, no objects crossing cell boundaries, no visible labels; the real app supplies accessible live text. All seven effects must visibly differ.
```

### Achievement atlas

```text
Use case: stylized-concept. Asset type: production achievement badge sprite atlas for Bluff House, a colorful illustrated social Blackjack game.
Create ONE landscape PNG atlas, aspect ratio2:1, preferably2048x1024, with EXACTLY EIGHT separate achievement emblem icons in a mathematically STRICT uniform FOUR-COLUMN TWO-ROW grid. Every square cell has ONE centered cutout badge with consistent size, generous internal padding (badge fits inside central75% of each square), no objects crossing cell edges. Entire backdrop genuinely transparent alpha, including spaces between and around emblems. NO enclosing rectangular panels, NO text, NO letters, NO numerals, NO interface, NO shadows stretching between icons.
Style: polished hand-painted cartoon casino-game achievement emblems, bold readable silhouettes, glossy beveled gold metal, jewel enamel, dark navy interior details, purple/ruby/emerald/cyan accents, strong ornamental craft, small warm rim highlights. Distinct silhouette and meaning for every badge. Do not use generic identical medals.
ROW1 left-to-right:
1 Housebreaker: a gold crown broken cleanly in two over a small royal-purple shield, ruby shards.
2 Bounty Hunter: a gold target reticle with one diagonal emerald-tipped arrow striking its center, backed by compact navy shield.
3 Master Bluffer: a mysterious purple theatrical masquerade mask above two tiny contrasting heart/spade cards, cyan eyes, ornate gold trim.
4 Vault Thief: an open gold bank-vault door with a tiny purple burglar-mask emblem and three spilling emerald poker chips.
ROW2 left-to-right:
5 Untouchable: a bright cyan protective shield with three gold stars arching above it, glossy hard enamel.
6 Betrayer: one ornate gold dagger dividing two playing cards, one red heart and one black spade, purple ribbon accents; no violence or blood.
7 High Roller: a tall gold-and-ruby poker-chip stack with a prominent gold diamond jewel rising above it, energetic sparkle.
8 Comeback King: a splendid gold crown carried upward by a curved emerald comeback arrow, ruby centerpiece and purple wing-shaped flourishes.
Critical invariants: precise equal4x2 cell layout for CSS background-position sprite cropping, square cells, all8icons centered and consistently padded, transparent background, no labels.
```
