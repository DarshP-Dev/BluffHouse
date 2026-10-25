# Reference-based interface artwork

The learner supplied four Bluffhouse screenshots on October 25, 2026: Game Lounge (menu), Lobby, House Auction Interface and Blackjack Dashboard (gameplay). These guide the art direction and layout; the implemented server remains the source of truth for all rules, names, cards, bids and balances.

Three new assets were generated using the built-in image-generation tool, inspected, and copied into the repository. No API key, paid service purchase or external asset URL is required at runtime. The logo preserves a transparent alpha background. The pages use live HTML controls and text over the art, rather than a screenshot of an interface.

| Local asset | Role |
| --- | --- |
| `apps/web/public/art/lounge-background.png` | Clean illustrated lounge backdrop for menu, lobby and table |
| `apps/web/public/art/bluffhouse-logo.png` | Transparent gold wordmark, spade and red cards |
| `apps/web/public/art/auction-background.png` | Purple/gold throne hall for the sealed House auction |

The reference's visible highest bids, example player totals, eight seats, ten rounds, insurance, split and additional card effects do not add game mechanics. Auctions remain sealed until reveal; capacities, rounds, dealer rules and actions follow the approved implementation.

## Final generation prompts

### Lounge background

Use case: stylized-concept. Asset type: production web game background, wide landscape 16:9, highly polished illustrated casino lounge. Create only the environment, NO interface and NO words. Match the warm bold cartoon social-casino aesthetic described here: luxurious wood-paneled lounge at night, tall arched windows showing a deep blue city skyline with small orange lit windows, burgundy leather sofas arranged along the back and sides, lush broad-leaf potted plants, gold-orange table lamps and pendant lamps, red wall art with simple gold spade motifs. Bottom foreground is the curved edge of a large emerald green blackjack table, thick polished wood and gold rim, a few colorful glossy poker chip stacks and corner playing cards at bottom edges. Central upper and middle space should be uncluttered, suitable for overlaying a large logo and live UI. Strong clean black outlines, saturated rich red/purple/navy shadows, amber warm illumination, hand-painted cel-shaded 3D game illustration, crisp cinematic composition. No people, no characters, no logos, no numbers, no typography, no buttons, no panels, no watermark. The user references a colorful Bluffhouse game lounge, this is the underlying clean art asset only.

### Transparent wordmark

Use case: logo-brand. Asset type: transparent production game wordmark, wide composition with tight crop and transparent background. Exact text: "Bluffhouse" (capital B, all remaining letters lowercase, spelled B l u f f h o u s e). A bold playful polished social casino logo: enormous chunky golden yellow-to-orange beveled 3D letters, subtle cream gleaming highlights, thick deep black and burgundy extrusion outlines and shadow, similar to a premium illustrated board game title. Behind the middle top of the lettering put one large golden spade with a black inset, flanked by a small fan of red playing-card backs with gold borders. All pieces form one cohesive compact logo. Word must be exceptionally legible at small sizes. Background fully transparent with genuine alpha, no rectangle, no scene. No slogan, no other words, no watermark. Leave only a small margin around the mark. Designed to sit on a dark navy illustrated casino game interface.

### Auction background

Use case: stylized-concept. Asset type: production web game backdrop, wide landscape 16:9. Create a glorious royal casino auction hall environment only, no UI, no text. Centerpiece: a luxurious empty purple velvet throne with elaborate glossy gold frame, crown detail at top and a large gold spade symbol on its backrest. It sits on a circular gold-edged purple platform reached by a small red carpet staircase. The throne should occupy the middle third of the image, leaving the left and right thirds relatively quiet dark royal purple/blue to allow live UI panels to overlay. Tall pillars, purple hanging banners with gold spade motifs, distant deep blue windows, warm glowing sconces, a few broad-leaf green potted plants at bottom corners. Deep royal purple, warm shiny gold, ruby red carpet, atmospheric blue upper background. Bold black outlines, rich saturated cel-shaded illustrated 3D mobile board-game aesthetic, polished detailed highlights, cinematic but inviting. Do not include people, words, letters, numbers, logos, title banners, cards with text, buttons, status panels or watermark. This is clean background art for a real interactive House Auction screen.
