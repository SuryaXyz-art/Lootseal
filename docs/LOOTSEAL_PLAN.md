# Lootseal: Master Plan

**Prove the odds were real. Spoil no surprise.**

Lootseal is a fairness layer on Midnight for loot boxes, gacha pulls and NFT mystery mints. Before the sale, a publisher commits a hidden drop table and **proves in zero knowledge that it matches the advertised odds**. Every box is drawn from that table by a circuit, using randomness that neither the publisher nor the buyer controls. The remaining supply stays hidden, so nobody can snipe the last legendaries. Each item is delivered to its buyer **encrypted inside the same proof**. Holders can prove "this item is top 1%" on a marketplace without revealing what it is. When the sale ends, the publisher opens the table and anyone can audit the result.

This document covers strategy, architecture, the contract specification, UX, testing, deployment, the submission package and the roadmap. `MASTER_PROMPT.md` (repo root) is the one-shot build instruction that turns this plan into the working dApp.

---

## 1. Why this wins: mapped to the official rubric

The source is the Akindo wave-hack page (API `api.akindo.io/public/wave-hacks/jaMZjqPOBsLXvjdG`), plus what judges rewarded in Wave 1.

| Criterion (weight) | What judges check | How Lootseal scores |
|---|---|---|
| **Engineering & Implementation (40%)** | Compact compiles, private state, understanding of the dual-ledger model, organized repo, clear README, Midnight topics/attribution | Two Compact contracts (drop + registry). Hidden state is held in salted commitments and updated by every circuit. The draw is witness-verified (bounded-quotient reduction plus divMod). **In-circuit verifiable encryption** uses Jubjub Diffie-Hellman (`ecMul`), and a fair-exchange marketplace sits on top. Unshielded NIGHT flows (pay, refund, bond, proceeds). A `SPEC.md` lists privacy invariants and accepted leaks. Repo topics include `midnightntwrk`, plus NOTICE attribution |
| **QA & Reliability (15%)** | Simulator and test files, passing tests, stability | Simulator (`*.sim.test.ts`) tests for every circuit, with a negative test for every `assert`. Lying-witness tests. `assertNotInPublicState` privacy tests. A full-supply statistical test. A devnet end-to-end suite. UI unit tests. CI on every push |
| **Product & Vision (15%)** | Soundness, link to Midnight's core capabilities, realistic scope/roadmap | The product only works with selective disclosure: the odds are proven while the table stays hidden. It addresses real regulatory pressure on loot-box odds disclosure. The threat model is honest and the roadmap is concrete |
| **UX & Design (15%)** | Intuitive frontend, behaves as expected, contract wired end to end | Box-opening reveal animation, procedural item art, a Vault that decrypts items locally, a Bazaar with verified rarity badges, a Publisher Studio wizard and a public Audit page. **No button that doesn't work** |
| **Communication (10%)** | Video and deck clarity | A 10-slide deck and a 3–4 minute voiced demo video following a scripted story (§12) |
| **Business (5%)** | Audience, market, adoption path | Game studios, gacha publishers and NFT launchpads. A per-box fee plus a "Lootseal Verified" badge. An SDK path (§13) |

**Low saturation:** none of the 197 submissions so far does loot boxes, gacha or mystery mints. The nearest are Midnight Casino (casino games), ShadowArena and VeilWolf (hidden-information games). Lootseal is infrastructure for publishers, not a game.

---

## 2. What changed from the original pitch, and why

| Pitch said | Plan does | Reason |
|---|---|---|
| "buyer seed + block value + publisher seed" | **buyer seed + committed publisher master seed + request index**, with no block value | Compact circuits cannot read block hashes or any chain randomness; the standard library only exposes `blockTimeLt/Gte/Gt/Lte`. The two committed, independent seeds give the needed guarantee (§4) |
| "Belgium, China, South Korea demand odds disclosure" | China and South Korea mandate **probability disclosure**, and Apple and Google require it in app stores. Belgium treats paid loot boxes as **illegal gambling** (since 2018) | Accuracy matters in the deck. Judges notice. |
| "circuit proves the item came from the committed table" | Also proves **at launch** that the hidden table matches the advertised tier totals (`commitTable`) | Players get the guarantee before they buy, not only after the reveal |
| Item delivery unspecified | **Verifiable encrypted delivery**: the same proof that draws the item encrypts it to the buyer's key | Without it, the buyer can't learn their item privately, and the publisher could lie about it |
| `transferItem` | Gift transfers **plus** an escrowed Bazaar sale (`listItem` / `buyListing` / `settleListing`) | Turns `proveRarityTier` into a real marketplace flow |

---

## 3. System architecture

```
                       ┌─────────────────────────────── Midnight (Preview network) ───────────────────────────────┐
                       │                                                                                           │
                       │   lootseal-registry.compact          lootseal-drop.compact  (one deployment per drop)    │
                       │   ┌──────────────────────┐          ┌──────────────────────────────────────────────────┐ │
                       │   │ drops: Map<id,Entry> │◄─────────│ PUBLIC: catalog names+tiers, tierTotals, price,  │ │
                       │   │ dropCount: Counter   │ register │ saleEnd, state, tableCommit, remainingCommit,    │ │
                       │   └──────────────────────┘          │ seedCommit, requests, items(id→commit),          │ │
                       │                                     │ deliveries(id→ciphertext), badges, listings,     │ │
                       │                                     │ NIGHT pot (price, bond, escrow)                  │ │
                       │                                     │ PRIVATE (only in provers' local state):          │ │
                       │                                     │ per-item counts, remaining, minted, salts,       │ │
                       │                                     │ master seed, enc secret keys, owner secret keys  │ │
                       │                                     └──────────────────────────────────────────────────┘ │
                       └──────▲─────────────────────▲──────────────────────────▲───────────────────────▲──────────┘
                              │ indexer GraphQL/ws  │ tx (proof + NIGHT)       │ tx                    │ read
                 ┌────────────┴───────┐   ┌─────────┴────────────┐   ┌─────────┴───────────┐   ┌───────┴──────────┐
                 │ Lootseal web app   │   │ Lace (Midnight)      │   │ Fulfiller service   │   │ Public verify &  │
                 │ React 19 + Vite    │◄─►│ DApp Connector 4.0.1 │   │ Node 22 + wallet-sdk│   │ audit pages      │
                 │ Drops·Vault·Bazaar │   │ balances, proves,    │   │ + proof-server 8.1.3│   │ (no wallet       │
                 │ Studio·Audit       │   │ submits, DUST fees   │   │ opens boxes FIFO    │   │  needed)         │
                 └────────────────────┘   └──────────────────────┘   └─────────────────────┘   └──────────────────┘
                   private state: IndexedDB (levelPrivateStateProvider, passphrase-encrypted)
```

**Dual-ledger use** (the explicit Engineering signal):
- **Public ledger:** commitments, catalog, odds, queue, item commitments, ciphertexts, badges, listings, NIGHT balances.
- **Private state (per participant):** publisher hidden table, seed and salts. Buyer owner keys and encryption keys. Decrypted item openings.
- **Unshielded NIGHT:** box price, publisher bond, Bazaar escrow, refunds, proceeds. Fees are paid in DUST.
- **Witness-verified computation:** the hash-to-integer reduction, the modulo and the pick are all computed off-chain and checked in-circuit.

---

## 4. Fairness and randomness design

**Per-box randomness:**
```
R_k   = transientHash([ "lootseal:roll", masterSeed, requestId_k, buyerSeed_k ])     (Field)
lo_k  = R_k reduced to Uint<64>     (witness gives q, lo; circuit checks q < Q_MAX and q·2^64 + lo == R_k)
roll  = lo_k mod remainingTotal     (witness divMod; circuit checks rem < d and quo·d + rem == lo_k)
type  = the unique i with prefix(i) ≤ roll < prefix(i) + remaining[i]
```

- `masterSeed` is committed (`seedCommit = persistentCommit(masterSeed, seedSalt)`) **before the sale opens**. The publisher can't change it afterwards.
- `buyerSeed` is fresh randomness the buyer chooses at request time, after the seed commitment exists. The publisher can't influence it.
- The publisher can't pick outcomes for other people's boxes. The outcome is fixed the moment the request lands, and the circuit enforces it.
- The buyer can't grind, because `masterSeed` is secret.
- `masterSeed` is **never revealed**, so no one can replay draws after the sale and work out who got what. Holder privacy is permanent. Correctness of each draw is guaranteed by the proof, not by replay.
- **Withholding** (the publisher refusing to open a bad-for-them box) is blocked three ways. Opening is strictly **FIFO**, so skipping a box stalls the whole queue. Every request has a **fulfillment deadline**. After it, the buyer claims a refund plus a penalty from the publisher's **bond**, and the drop is permanently marked `DEFAULTED` on the public page.
- **Hidden remaining supply** makes every box *ex ante identical*. Because the draw order is uniformly random and no one can see what's left, each box's probability of a legendary is exactly the advertised share. This is the key line in the pitch. Sniping and "the legendaries are gone" games become impossible.

**Accepted residual (stated openly in SPEC/README):** a publisher who buys its own boxes through sock-puppet wallets knows `masterSeed` and could grind its own buyer seeds. Even then, aggregate totals stay exactly as committed, the final reveal proves it, and every such purchase costs a real box. The roadmap fix is **threshold seed keepers** (§14). Stating this openly is a strength with judges.

---

## 5. Contract specification: `contract/lootseal-drop.compact`

Constants: `K = 16` item types and `T = 5` tiers (0 = Legendary, 1 = Epic, 2 = Rare, 3 = Uncommon, 4 = Common).

### Public ledger
| Field | Type | Notes |
|---|---|---|
| `publisherPk` | sealed `Bytes<32>` | `persistentHash([pad(32,"lootseal:pub:"), pubSk, kernel.self()])` |
| `publisherPayout` | sealed `UserAddress` | for proceeds and bond return |
| `publisherEncKey` | sealed `JubjubPoint` (or x,y Fields if a point can't be stored) | `Y = ecMulGenerator(y)` |
| `catalogNames` | sealed `Vector<16, Bytes<32>>` | on-chain item names (≤32 bytes); empty slots are zero |
| `catalogTiers` | sealed `Vector<16, Uint<8>>` | tier of each type; **always read as the whole vector** (see the gotcha below) |
| `tierTotals` | sealed `Vector<5, Uint<32>>` | advertised exact count per tier, so odds = tierTotals/totalSupply |
| `totalSupply` | sealed `Uint<32>` | |
| `price`, `bondAmount`, `penaltyPerBox` | sealed `Uint<128>` | NIGHT smallest units |
| `saleEnd`, `fulfillWindow` | sealed `Uint<64>` | seconds |
| `state` | `DropState { SETUP, LIVE, ENDED, REVEALED, DEFAULTED }` | |
| `tableCommit`, `remainingCommit`, `seedCommit` | `Bytes<32>` | salted `persistentCommit` |
| `requestCount`, `openedCount` | `Counter` (or `Uint<32>`) | `remainingTotal = totalSupply − openedCount` is public anyway |
| `requests` | `Map<Uint<32>, Request>` | `{buyerSeed, buyerEncKey, ownerPk, refundTo: UserAddress, requestedAt, status}` |
| `items` | `Map<Bytes<32>, Bytes<32>>` | itemId → `persistentCommit([type, serial, ownerPk], salt)` |
| `deliveries` | `Map<Bytes<32>, Delivery>` | itemId → `{ephemeral: JubjubPoint, cipher: Field, version: Uint<32>}` |
| `badges` | `Map<Bytes<32>, Badge>` | `{itemId, maxTier, context, version}` |
| `listings` | `Map<Bytes<32>, Listing>` | `{price, maxTier, sellerPayout, status, buyerOwnerPk, buyerEncKey, buyerRefund, deadline}` |
| `publisherClaimable`, `bondRemaining` | `Uint<128>` | |
| `revealedInitial`, `revealedRemaining` | `Vector<16, Uint<32>>` | written only by `finalReveal` |
| `oddsVerified` | `Boolean` | written by `verifyOdds` |

### Private state (`contract/witnesses.ts`, browser-safe with no `node:*` imports)
- **Publisher:** `pubSk`, `encSk y` (Uint<248> scalar), `initialCounts[16]`, `remaining[16]`, `minted[16]`, `tableSalt`, `remainingSalt`, `masterSeed`, `seedSalt`.
- **Holder:** `ownerMasterSk`, `encSk x`, and a local book of decrypted openings `{itemId → type, serial, salt, ownerSk}`.
- **Witness helpers:** `reduce64(R) → [q, lo]`, `divMod(a, d) → [quo, rem]`, `pickType(roll, remaining) → i`.
- Use one secret per job (gotchas doc): identity, encryption and blinding never share a key.

### Circuits (every `assert` gets a negative sim test)
1. **`constructor(params)`**: sets the sealed catalog, tiers, tierTotals, supply, price, bond, penalty, saleEnd, window, publisherPk, payout and encKey. Asserts Σ tierTotals == totalSupply, that every catalog tier is < 5, and that every tier with a non-zero total has at least one catalog item. State = SETUP.
2. **`commitTable()`** (publisher): the witness gives `initialCounts` and `tableSalt`. Asserts publisher identity. Asserts the Σ of counts per tier == `tierTotals[t]` (**odds proven at launch**) and that empty catalog slots have count 0. Writes `tableCommit` and `remainingCommit = commit({remaining=initial, minted=0}, remainingSalt)`. Receives `bondAmount` NIGHT (`receiveUnshielded`).
3. **`commitSeed()`** (publisher): writes `seedCommit = persistentCommit(masterSeed, seedSalt)`. Once both commits exist, state = LIVE.
4. **`requestBox(buyerSeed, buyerEncKey, ownerPk, refundTo, now)`** (anyone): asserts LIVE, `requestCount < totalSupply`, `blockTimeLt(saleEnd)`, and `now` within ±120 s of block time (`blockTimeGte(now−120)`, `blockTimeLt(now+120)`). Receives `price` NIGHT. Stores the request with `requestedAt = now` and status PENDING.
5. **`openBox()`** (publisher, FIFO on `openedCount`): reads `requests[openedCount]`. Witnesses the seed (checked against `seedCommit`) and the remaining/minted state (checked against `remainingCommit`). Computes R → lo → roll → type (all witness-verified). Sets `serial = minted[type]+1`. Decrements and re-commits with a new salt. Derives `itemId = persistentHash(["lootseal:item", kernel.self(), requestId])`. Computes the shared secret `S = ecMul(buyerEncKey, y)`, asserting `ecMulGenerator(y) == publisherEncKey`. Sets `salt = persistentHash(["lootseal:salt", S.x, itemId, 0])`. Writes `items[itemId] = commit([type, serial, ownerPk], salt)` and `deliveries[itemId] = {ephemeral: publisherEncKey, cipher: (type·2^32 + serial) + transientHash(["lootseal:mask", S.x, S.y, itemId, 0]), version: 0}`. Adds `price` to `publisherClaimable` and marks the request OPENED.
6. **`claimRefund(requestId)`** (the buyer, by owner-key proof): asserts PENDING and `blockTimeGte(requestedAt + fulfillWindow)`. Sends `price + min(penaltyPerBox, bondRemaining)` to `refundTo`. Status becomes REFUNDED and state becomes DEFAULTED. Requests are blocked from then on; refunds stay open to every pending buyer.
7. **`proveRarityTier(itemId, maxTier, context)`** (holder): the witness opening must match `items[itemId]`. Reads `catalogTiers` whole and asserts `tier ≤ maxTier`. Writes `badges[persistentHash([itemId, context, version])]`. Only `maxTier` and `context` become public, never the type or serial.
8. **`transferItem(itemId, toOwnerPk, toEncKey)`** (holder): proves the current opening. The witness gives an ephemeral scalar `e`. Computes `E = ecMulGenerator(e)` and `S = ecMul(toEncKey, e)`, then a new salt, commit and ciphertext with `version+1`. The receiver finds the item by trial decryption.
9. **`listItem(itemId, price, maxTier, payout)`**: an inline rarity proof plus a listing record. **`buyListing(itemId, buyerOwnerPk, buyerEncKey, refundTo, now)`**: escrows NIGHT and sets a deadline. **`settleListing(itemId)`** (seller): does the same as `transferItem`, but to the escrowed buyer keys, which the circuit enforces, and pays the seller. That is fair exchange guaranteed by ZK. **`cancelListing`** and **`refundListing`** (buyer, after the deadline).
10. **`claimProceeds()`** (publisher): sends `publisherClaimable` to `publisherPayout`.
11. **`finalReveal()`** (publisher): requires `blockTimeGte(saleEnd)` or sold out, and no pending requests. Witnesses the initial and remaining openings and checks them against both commitments. Writes `revealedInitial` and `revealedRemaining`, returns the bond, and sets state = REVEALED. **The master seed is never revealed.**
12. **`verifyOdds()`** (anyone, after the reveal): asserts that the per-tier sums of `revealedInitial` equal `tierTotals`, that Σ(initial − remaining) == `openedCount`, and that every `initial ≥ remaining`. Writes `oddsVerified = true`, a permanent on-chain verification anyone can trigger.
13. **Pure circuits** exported to TypeScript: `deriveOwnerPk`, `deriveEncPub`, `sharedMask` and `decryptDelivery`, so browser decryption uses exactly the circuit's math.

### Compact gotchas this design must respect (verified in midnight-examples)
- **Never index a ledger vector or map with a private value.** The read lands in the public transcript and leaks it. Read `catalogTiers` as a whole field and select in-circuit.
- Ledger writes publish; `disclose()` only acknowledges a boundary. Audit the *state*, not the `disclose` calls.
- Bound every witness quotient so equations hold over the integers, not mod p. See `zk-loan/schnorr.compact`, where the quotient is checked to be < 116. Without this, a prover could choose any roll.
- Narrowing casts fail at run time. Size counters for their real range.
- Circuit names are public via the indexer `entryPoint`. That's fine here: every draw uses one circuit.

### `contract/lootseal-registry.compact`
`registerDrop(dropAddress: Bytes<32>, name: Bytes<32>, publisherPk: Bytes<32>)` adds entries to `drops: Map<Uint<32>, Entry>`. The UI checks each entry by reading that drop's own state and confirming `publisherPk` matches. Cross-contract calls aren't used; they're still experimental.

---

## 6. Privacy invariants (SPEC.md and privacy tests)

**Never on chain:** per-type initial counts (until `finalReveal`) · per-type remaining counts (until `finalReveal`) · master seed (ever) · any box's roll or type · any item's type or serial (unless the holder chooses to reveal) · who currently owns an item after a transfer · owner, encryption or publisher secret keys · DH shared secrets · salts.

**Accepted leaks (documented):** the buyer's NIGHT address and the number of boxes it bought · that request k produced itemId k · that an item changed hands (but not to whom) · listing price and the *proven tier bound* the seller chose to show · aggregate counts after the reveal · which circuit was called · the publisher-self-dealing residual (§4).

---

## 7. Fulfiller service (`fulfiller/`)

Opening needs the publisher's private state, so a headless Node 22 service runs it. It uses the wallet-sdk wallet facade, `levelPrivateStateProvider` on disk, the indexer public-data provider, and `httpClientProofProvider` pointed at a local proof-server container. It subscribes to the drop's ledger, opens pending requests FIFO, retries on state conflicts, exposes `/health`, writes structured logs, and runs from a Docker Compose file (proof-server + fulfiller). The publisher wallet seed and the backup passphrase come from environment variables and are never committed.

Publisher Studio exports a **passphrase-encrypted fulfiller bundle** with the hidden table, seeds and keys. The service imports it. There is exactly **one** active fulfiller per drop, because private state can't be split between two places. Studio shows "Fulfillment: this browser | fulfiller service" and moves the state between them by export and import.

---

## 8. UX and design

**Visual language:** a dark midnight palette (indigo-black base, violet glow, glass cards) with consistent tier colours: Legendary amber-gold, Epic violet, Rare sky, Uncommon emerald, Common slate. Each item gets procedural SVG art seeded by `(dropAddress, type, tier)` (sigil, gem facets, glow ring), so there are no external assets. Framer Motion handles the box-opening sequence and respects `prefers-reduced-motion`. The layout is responsive down to 360 px.

**Pages (every control is wired; anything state-dependent shows a disabled reason):**

| Route | What it does |
|---|---|
| `/` Drops | Hero, live drops from the registry, cards with art, price, opened/total, odds bars and trust chips ("Odds proven at launch ✓", "On-time fulfillment 100%", "DEFAULTED" in red) |
| `/drop/:addr` | Catalog grid, odds table with a proof tx link, progress, and a "Remaining by tier: 🔒 hidden, by design" explainer. **Open a box** stepper: Pay & seed → Sealed (queue position, refund countdown) → **Reveal** (box shakes, cracks, card flips with a tier glow) → item card "Dragon Blade · #37 of 40 · Legendary · top 1%". **Claim refund + penalty** appears only after the deadline |
| `/vault` | Items decrypted locally, filters, item detail. **Prove rarity** creates a badge plus a shareable `/verify` link. **Send** takes a Lootseal ID or QR. **List on Bazaar**. Identity card (Lootseal ID copy/QR) and passphrase-encrypted key backup/restore |
| `/bazaar` | Listings with ZK-verified tier badges. Buy → escrow → "waiting for seller delivery" → the item appears in the Vault. Refund after the deadline |
| `/studio` | Create-drop wizard: catalog (≤16 items with tiers) → hidden supplies, with a live odds preview → price, sale end, window, bond → review → deploy, commitTable, commitSeed and register, each step with a progress state. Dashboard: queue, in-browser auto-fulfill, export fulfiller bundle, claim proceeds, final reveal (enabled only when allowed) |
| `/audit/:addr` | Before the reveal: commitments and what each proof guarantees. After: advertised vs. actual chart, in-browser recomputation of both commitments ("✓ matches"), opened per item, and a **Verify odds on-chain** button (anyone) |
| `/verify/:addr/:badge` | Public badge check with no wallet. Reads the indexer directly |

**Onboarding:** a "Get set up" sheet covering installing Lace (Midnight), switching to Preview, and the tNIGHT faucet link and DUST explanation, with live checks for each (wallet detected, network, balance).

**Error UX:** wallet and proof errors are mapped to plain-language messages with a retry. Transactions show pending → proving → submitted → confirmed.

---

## 9. Testing and QA plan

| Layer | Contents |
|---|---|
| `src/test/lootseal-drop.sim.test.ts` | Every circuit's happy path. A negative test for every assert (wrong role, wrong seed, wrong table, lying `reduce64`/`divMod`/`pickType`, out-of-order open, double open, request after end or sold out, early refund, early reveal, wrong opening, tier over-claim, settle to the wrong keys, double settle) |
| `src/test/privacy.sim.test.ts` | `assertNotInPublicState` for counts, remaining, master seed, salts, each item's type and serial, secret keys and shared secrets, checked after every phase |
| `src/test/fairness.sim.test.ts` | Opens a full 200-box drop: final per-type totals equal the table exactly. Over many seeded drops, legendary frequency by position is uniform (chi-square bound), which demonstrates the ex-ante fairness claim |
| `src/test/crypto.test.ts` | DH encrypt/decrypt round-trips through the pure circuits. Trial decryption ignores other people's deliveries |
| `src/test/lootseal.test.ts` | Devnet end to end: deploy → commit → request ×N → open → badge → list → buy → settle → reveal → verifyOdds, and the refund/default path |
| `ui/src/__tests__` | Components, hooks, the stepper state machine, error mapping, decryption, and form validation tested against the real circuits |
| `fulfiller/test` | Queue logic and conflict retry |
| CI | `compile:fast` → typecheck → `test:sim` → UI build/unit tests on every push. Badge in the README |

---

## 10. Deployment

- **Network:** Midnight **Preview**. It has public indexer and RPC endpoints, faster wallet sync and a faucet. Preprod is supported by config (it needs a free Blockfrost project ID).
- **Demo drop "Genesis Relics":** 1,000 boxes, 16 items. Tiers: Legendary 10 (1%), Epic 40 (4%), Rare 150 (15%), Uncommon 300 (30%), Common 500 (50%).
- **Hosting:** web app on Vercel (static Vite build with ZK assets in `public/managed`). Fulfiller plus proof server via Docker Compose on a small VPS.
- **Recorded in README and `deployments/preview.json`:** contract addresses, deploy tx hashes, the registry address and the demo drop address.

---

## 11. Repository layout

```
Lootseal/
├─ contract/          lootseal-drop.compact · lootseal-registry.compact · witnesses.ts · index.ts · SPEC.md
├─ src/               config.ts · providers.ts · wallet.ts · crypto.ts · test/*.test.ts
├─ packages/          sim · fast-sync · coins   (from midnight-examples, Apache-2.0, credited in NOTICE)
├─ ui/                React 19 + Vite 6 + Tailwind 4 app (Drops, Vault, Bazaar, Studio, Audit, Verify)
├─ fulfiller/         Node service + Dockerfile + compose.yml
├─ scripts/           deploy-preview.ts · seed-demo-drop.ts · wait-for-dust.ts
├─ deployments/       preview.json
├─ docs/              ARCHITECTURE.md · THREAT_MODEL.md · deck/ · VIDEO_SCRIPT.md · LOOTSEAL_PLAN.md
├─ .github/workflows/ ci.yml
└─ README.md · LICENSE (Apache-2.0) · NOTICE · CHANGELOG.md · package.json (Yarn 4 workspaces)
```

GitHub topics: `midnightntwrk`, `midnight`, `compact`, `zero-knowledge`, `zk`, `privacy`, `loot-box`, `gacha`, `nft`, `provably-fair`.

---

## 12. Submission package

**README sections:** one-line pitch and GIF · problem · how it works (diagram) · what's private and what's public · fairness guarantees and residuals · architecture · contracts and circuits table · deployed addresses · run locally (one command per step) · test (sim, devnet, UI) · judge quick test (5 steps on Preview) · progress this wave · roadmap · attribution · license.

**Deck (10 slides):**
1. Title and tagline
2. Problem: unverifiable odds, insider sniping, regulation
3. Why transparency alone fails: a public table spoils the surprise and enables bots
4. The Lootseal answer, in one diagram
5. Proof at launch, randomness nobody controls, hidden remaining supply
6. Encrypted delivery and rarity badges
7. Live demo screenshots
8. Midnight architecture: dual ledger, witnesses, Jubjub DH
9. Tests and QA numbers, plus the threat model
10. Market, business model and roadmap

**Video (3–4 minutes, with voice):**
- 0:00 Hook: "1% legendary. Says who?"
- 0:20 Problem
- 0:45 Publisher creates a drop and proves the odds at launch
- 1:30 A buyer opens a box, it reveals, and it lands in the Vault
- 2:10 Prove "top 1%" and list on the Bazaar, then a second wallet buys and receives the item
- 2:50 Final reveal and Verify odds on-chain
- 3:20 Architecture and tests
- 3:45 Close

---

## 13. Business and adoption

- **Who it's for:** mobile and PC gacha studios, web3 game studios, NFT launchpads, trading-card platforms and esports drop campaigns.
- **Why now:** probability-disclosure laws (China; South Korea's mandatory disclosure in force since 2024), platform rules (Apple and Google require odds disclosure), and enforcement of gambling law against paid loot boxes (Belgium). Players widely distrust published rates.
- **Model:** 1–2% fee per opened box, or a flat fee per drop. A "Lootseal Verified" embeddable badge and audit page. An enterprise tier with a self-hosted fulfiller.
- **Adoption path:** a TypeScript SDK and REST fulfiller → Unity and Godot plugins → launchpad integrations. Start with one web3 game partner from the Midnight ecosystem.

---

## 14. Roadmap (build phases with acceptance gates)

| Phase | Deliverable | Gate (must be true to continue) |
|---|---|---|
| P0 Setup | WSL2 toolchain, Compact 0.31.1, Yarn 4, Docker, scaffold from midnight-examples templates, Kapa MCP plus Midnight Expert | `compact compile` works on the hello contract |
| P1 Spec | `contract/SPEC.md`: roles, ledger, private state, circuits with asserts, invariants, leaks | Spec reviewed against §5 and §6 |
| P2 Contracts | Both `.compact` files and `witnesses.ts` | `yarn compile` (with ZK keys) is clean |
| P3 Sim QA | All sim, privacy, fairness and crypto tests | `yarn test:sim` green; every assert has a negative test |
| P4 Devnet | Local devnet end-to-end suite | `yarn validate` green |
| P5 UI | All pages wired through the Lace connector | `typecheck`, `test:unit` and `build` green; manual run through every page |
| P6 Fulfiller | Service plus compose | Opens 20 queued boxes unattended on devnet |
| P7 Preview | Deploy registry and demo drop, host the UI and fulfiller | A judge flow works from a fresh browser and fresh Lace wallet |
| P8 Package | README, deck, video script, CHANGELOG, topics, NOTICE | Checklist in §12 complete |

**Next-wave growth (new Midnight features for later waves):** threshold seed keepers (publisher plus an independent auditor co-commit the seed; `openBox` needs both shares, which removes the self-dealing residual) · shielded-token purchases (private buying) · provable pity timers and guaranteed-drop rules · multi-box packs in one proof · anonymous holder badges (Merkle tree plus nullifiers) · a cross-drop publisher reputation registry · a Unity SDK.
