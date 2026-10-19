<div align="center">

<img src="docs/screenshots/banner.png" alt="Lootseal: provably fair loot boxes and mystery mints on Midnight" width="100%" />

# Lootseal

**Prove the odds were real. Spoil no surprise.**

A fairness layer for loot boxes, gacha pulls and NFT mystery mints, built on [Midnight](https://midnight.network).

[![Midnight Preview](https://img.shields.io/badge/Midnight-live%20on%20Preview-8b5cf6)](#deployed-on-midnight-preview)
[![Compact](https://img.shields.io/badge/Compact-0.31.1-a78bfa)](apps/lootseal/contract)
[![Midnight.js](https://img.shields.io/badge/Midnight.js-4.1.1-c4b5fd)](https://docs.midnight.network)
[![Tests](https://img.shields.io/badge/tests-75%20sim%20·%2076%20UI%20·%20devnet%20e2e-34d399)](#testing)
[![Field test](https://img.shields.io/badge/field%20test-102%2F102%20checks-34d399)](#field-test-lootseal-used-for-real-on-preview)
[![License](https://img.shields.io/badge/license-Apache--2.0-f6c453)](LICENSE)

### [▶ Live app: lootseal.vercel.app](https://lootseal.vercel.app)

[How it works](#how-it-works) · [App tour](#app-tour) · [Field test](#field-test-lootseal-used-for-real-on-preview) · [Architecture](#architecture) · [Try it](#try-it-in-5-steps) · [Run locally](#run-locally)

</div>

---

## Why Lootseal

Games and NFT launches publish odds ("1% legendary") that nobody can check. Insiders snipe rare items before a reveal, and bots time purchases for when the rares are left. Regulators are pushing back:

- **China and South Korea** require loot-box probability disclosure. South Korea's rules have been in force since 2024.
- **Apple and Google** require odds disclosure in their app stores.
- **Belgium** treats paid loot boxes as gambling.

Publishing the whole drop table isn't the answer either. It spoils the surprise and hands bots a map. Lootseal uses Midnight's public/private split to give players **verifiable odds without revealing the table**.

| | Guarantee | How |
|---|---|---|
| 🛡️ | **Odds proven at launch** | `commitTable` proves in zero knowledge that the hidden per-item counts sum, per tier, to the advertised totals. Only the tier totals are public. |
| 🎲 | **A draw nobody can steer** | The roll for box *k* is `persistentHash(masterSeed, buyerSeed, k)`. The master seed is committed before the sale and the buyer picks their own seed. `openBox` proves the item came from that roll and the hidden remaining supply. |
| 🙈 | **Nothing to snipe** | Remaining supply is only ever a salted commitment, re-committed after every open, so every box carries exactly the advertised chance. This is checked statistically in `fairness.sim.test.ts`. |
| ⏱️ | **No withholding** | Boxes open strictly first-in, first-out within `fulfillWindow`. After that, `claimRefund` pays the buyer the price plus a penalty from the publisher's bond and marks the drop **DEFAULTED** forever. |
| 🔐 | **Only the buyer learns the item** | `openBox` encrypts the item to the buyer's Jubjub key (Diffie-Hellman via `ecMul`), and the same proof binds the ciphertext to the item commitment. |
| 🏅 | **Rarity without disclosure** | `proveRarityTier` publishes "tier ≤ T" for an item the caller owns. Its type and serial stay private. |
| 🤝 | **Private gifting and trade** | `transferItem` re-encrypts an item to a new owner. The bazaar escrows NIGHT, and the contract itself delivers the item to the buyer's keys when the sale settles. |
| 🔎 | **Public audit** | `finalReveal` opens the table and `verifyOdds` lets anyone re-check it on chain. The master seed is never revealed, so individual draws stay private forever. |

Residual risks are stated in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## How it works

<img src="docs/screenshots/how-it-works.png" alt="Five steps: commit, buy, open, hold and trade, audit" width="100%" />

1. **Commit.** The publisher commits a hidden drop table and proves it matches the advertised odds. The master seed is committed and a bond is posted.
2. **Buy.** The buyer pays NIGHT and adds their own secret seed. The box joins a FIFO queue.
3. **Open.** A circuit draws from the hidden remaining supply and encrypts the item to the buyer, all in one proof.
4. **Hold and trade.** Holders prove "top 1%" without revealing the item, gift privately, or sell through escrow.
5. **Audit.** After the sale, the table is opened and anyone can re-check it on chain.

---

## App tour

The web app (React 19 + Vite) talks to Midnight through Lace. Every page that reads chain data works without a wallet.

### Landing page

<img src="docs/screenshots/home-hero.png" alt="Landing page hero" width="100%" />

**Hero.** The pitch, live network stats (live drops, boxes sold, boxes opened, read from the indexer) and three ways in: browse drops, try a **demo box** with no wallet, or launch a drop.

<img src="docs/screenshots/home-guarantees.png" alt="The guarantees" width="100%" />

**The guarantees.** A scrolling ribbon of everything Lootseal enforces, then the four core promises: odds proven at launch, randomness nobody controls, no sniping, and enforced refunds.

<img src="docs/screenshots/home-how-it-works.png" alt="How a box opens" width="100%" />

**How a box opens.** Four steps, one proof each: the publisher seals the table, you add your own seed, a proof opens your box, and your item arrives sealed.

<img src="docs/screenshots/home-audiences.png" alt="Made for everyone in the loop" width="100%" />

**Who it's for.** Players, creators and studios, collectors and traders, and auditors and regulators, each with a direct link to the part of the app built for them.

<img src="docs/screenshots/home-drops.png" alt="Drops directory" width="100%" />

**Drops.** Every drop listed in the on-chain registry and verified against its own contract, with its odds, items, progress and trust badges (odds proven, registry verified, on-time opens, audit passed, or defaulted).

### Demo box

<img src="docs/screenshots/demo-box.png" alt="Demo box reveal with share card" width="100%" />

A free, off-chain opening with the real Genesis Relics odds, so anyone can feel the reveal before installing a wallet. Every pull renders a 1200×675 **share card**: *Post on X* copies the image and opens a ready-made post, and phones share it natively.

### Drop page

<img src="docs/screenshots/drop.png" alt="Genesis Relics drop page" width="100%" />

The heart of the app. It shows the advertised odds with the **"Proven in zero knowledge at launch"** mark, a reminder that the remaining supply is hidden by design, and the full catalog with procedural item art and tier ranks. A stepper takes the buyer through *Pay & seed → Sealed* (with queue position and refund countdown) *→ Reveal*. **Claim refund + penalty** appears only after the deadline. The trust record below shows boxes opened, late refunds, the bond left and the table commitment.

### Vault

<img src="docs/screenshots/vault.png" alt="Vault" width="100%" />

Your items, decrypted **in this browser** from the encrypted deliveries on chain, so nobody else can see what you hold. From here you can prove rarity badges, gift items by Lootseal ID, list them on the Bazaar, and back up your keys to a passphrase-encrypted file.

### Bazaar

<img src="docs/screenshots/bazaar.png" alt="Bazaar" width="100%" />

Trade items with rarity **proven** in zero knowledge, not claimed. Listings show their proven tier bound, and the buyer's NIGHT sits in escrow until the contract itself delivers the item. If the seller doesn't settle, the buyer is refunded after the deadline. The page also shows market stats (listed, floor, sold, volume, in escrow) and recent trades.

### Studio

<img src="docs/screenshots/studio.png" alt="Studio" width="100%" />

Launch a drop whose odds are proven at launch, then run it. A wizard builds the catalog and tiers with a live odds preview. Launch steps run the staged deploy, the odds proof, the seed commitment, the bond and the registry entry. The dashboard then opens boxes, and the publisher's hidden table, seed and keys never leave the browser.

### Audit

<img src="docs/screenshots/audit.png" alt="Audit page" width="100%" />

Everything Lootseal guarantees about a drop, checked from public chain data: the odds proof, committed randomness, on-time opens, the revealed table against the committed one, and the on-chain `verifyOdds` record. The commitments panel lists the drop table, remaining supply, master seed and publisher key commitments. Rarity badges get a shareable `#/verify/…` page.

### Field test

<img src="docs/screenshots/field-test.png" alt="Field test page" width="100%" />

A public journal of Lootseal used for real on Preview. **Re-check on chain** confirms every one of its transactions against the public indexer from your browser.

---

## Field test: Lootseal used for real on Preview

Beyond the test suites, Lootseal was **used** on Midnight Preview by 15 separate identities, each with its own keys and private state. Every step was checked against the chain afterwards: **102/102 checks passed, 62 real transactions (62/62 confirmed live), 23 attacks refused, 17 circuits exercised, 3 drops.**

| Story | What happened on chain |
|---|---|
| **A · Genesis Relics, played by a community** | 8 players bought 12 boxes, and the publisher opened all 12 strictly in order. Each player decrypted only their own pulls (all 12 deliveries were cross-checked against all 8 keys). The run also produced 3 rarity badges, one of them **Legendary**, plus a gift by Lootseal ID and 5 bazaar listings with proven rarity bounds. One listing was cancelled, an escrowed sale settled end to end, and proceeds were withdrawn. |
| **B · Lantern Run, launched → sold out → revealed → audited** | A fresh staged deploy, odds proof, bond, seed and registry entry. 6 buys sold it out and 6 FIFO opens followed. A seller missed the escrow deadline and the buyer was refunded. `finalReveal` published the table and `verifyOdds` recorded **TRUE** on chain. |
| **C · Ghost Lantern, a publisher who never opens** | The buyer waited out the window, then `claimRefund` returned the price **plus a 3 NIGHT penalty from the bond**. The drop is marked DEFAULTED for good. |

<details>
<summary><b>The 23 attacks the contract refused</b></summary>

Opening boxes without publisher secrets, or with forged ones; a clock 2 hours off; opening an empty queue; refunding an opened box, refunding early, or refunding twice; claiming a Legendary badge for a lower-tier item; moving, cancelling or reselling an item **while knowing its full plaintext opening** but not the owner key; listing twice or overstating rarity; buying a cancelled listing; dodging an escrowed sale by gifting the item; pulling escrow early; getting paid twice; stealing the publisher's proceeds; re-registering a drop; overselling a sold-out drop; revealing early; buying from a finished drop; opening after a default.

</details>

To run it yourself: `MIDNIGHT_NETWORK=preview LOOTSEAL_STATE_STORE=<deploy store> yarn workspace @lootseal/app field-test` ([`scripts/field-test.ts`](apps/lootseal/scripts/field-test.ts)). The public journal is [`deployments/preview-field-test.json`](apps/lootseal/deployments/preview-field-test.json). Who pulled which item stays private.

---

## Architecture

```
 Lootseal web app (React 19 + Vite) ──── Lace (DApp Connector 4.0.1): balance · prove · submit · DUST fees
   Drops · Drop · Vault · Bazaar · Studio · Audit · Verify · Field test
   private state: IndexedDB, passphrase-encrypted (levelPrivateStateProvider)
        │ reads: public indexer (no wallet needed)        │ writes: one tx at a time
        ▼                                                  ▼
 ┌──────────────────────────── Midnight ─────────────────────────────┐
 │ registry.compact            lootseal.compact (one per drop)        │
 │  drops (verified entries)    public: catalog, tier odds, price,     │
 │                              commitments, queue, item commitments,  │
 │                              ciphertexts, badges, listings, NIGHT   │
 │                              private (only in provers): per-item    │
 │                              counts, remaining supply, master seed, │
 │                              owner/enc keys, item openings          │
 └────────────────────────────────────────────────────────────────────┘
        ▲
 Fulfiller (Node 22 + wallet-sdk + proof server): opens boxes FIFO, replaying the
 hidden supply from chain data before each open (contract/lib.ts replaySupply)
```

### Contracts and circuits

| Contract | Circuits |
|---|---|
| [`lootseal.compact`](apps/lootseal/contract/lootseal.compact) | `commitTable`, `commitSeed`, `requestBox`, `openBox`, `claimRefund`, `proveRarityTier`, `transferItem`, `listItem`, `buyListing`, `settleListing`, `cancelListing`, `refundListing`, `claimProceeds`, `finalReveal`, `verifyOdds`, plus 15 pure circuits shared with TypeScript (`rollOf`, `itemCommit`, `deliveryMask`, `sharedPoint`, …) |
| [`registry.compact`](apps/lootseal/contract/registry.compact) | `registerDrop` |

### Using the dual-ledger model

- **Public ledger:** commitments, catalog, odds, the request queue, item commitments, ciphertexts, badges and listings.
- **Private state:** the publisher's table, seed and supply, plus each holder's keys and decrypted items. It lives only in the prover's own store.
- **Witness-checked work:** the roll reduction (`divMod64`) and the item pick (`pickType`) are computed off chain and verified in circuit, so a lying witness only makes the call fail.
- **Never index a ledger field with a secret.** The catalog and supply vectors are always read whole and selected in-circuit with `fold`/`map`.
- **Unshielded NIGHT** flows through `receiveUnshielded` and `sendUnshielded`: price, bond, penalty, escrow, refunds and proceeds.

### Engineering highlights

- **Staged deploy.** Deploying all 15 provable circuits at once exceeds the per-block `bytes_written` budget. So [`staged-deploy.ts`](apps/lootseal/contract/staged-deploy.ts) deploys the 4 launch circuits first, then installs the other 11 verifier keys with signed contract-maintenance updates (`VerifierKeyInsert`), 4 per transaction. An interrupted launch resumes from chain state.
- **Fast first sync.** The public indexer streams ledger events to one subscription at about 6 per second, which is about 12 hours for the DUST stream. [`indexer-cache.mjs`](apps/lootseal/scripts/indexer-cache.mjs) pulls both streams over parallel subscriptions and serves them locally, falling through to the real indexer for anything newer. With it, the deployer synced in 12 minutes.
- **A fulfiller that holds no state.** [The fulfiller](apps/lootseal/fulfiller/README.md) rebuilds the hidden supply from chain data before every open, so it can restart anywhere. It ships with Docker Compose, a health endpoint and retry with backoff.

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Contract card: [apps/lootseal/SPEC.md](apps/lootseal/SPEC.md)

---

## Deployed on Midnight Preview

| Contract | Address |
|---|---|
| Drop registry | `9a50e32ce590446b1c0eef5a5c0e0bf6897bbbc79b11975716d935d452b9eca3` |
| **Genesis Relics** (demo drop) | `24c64a4eceaeb7f810bd6ca6812e8af9ad82ad1fa476491e8cfd6741e9fde406` |

Genesis Relics is live: 1,000 boxes at 5 NIGHT, with odds of 1% Legendary, 4% Epic, 15% Rare, 30% Uncommon and 50% Common, proven in zero knowledge at launch. A fulfiller opens bought boxes automatically. Full record: [`deployments/preview.json`](apps/lootseal/deployments/preview.json).

## Try it in 5 steps

1. Install [Lace](https://www.lace.io) with Midnight and switch it to **Preview**.
2. Fund the wallet from the [Preview faucet](https://midnight-tmnight-preview.nethermind.dev/). In Lace, designate the NIGHT for DUST and wait a few minutes.
3. Open the web app at **[lootseal.vercel.app](https://lootseal.vercel.app)**, click **Connect wallet**, and choose a passphrase for your encrypted vault.
4. Open **Genesis Relics** and click **Open a box**. When the publisher's proof lands, the reveal plays and the item appears in your **Vault**.
5. In the Vault, **Prove rarity** and follow the `/verify` link, **List** the item on the **Bazaar**, or launch your own drop in the **Studio**. The **Audit** page shows every guarantee.

No wallet? Click **Try a demo box** on the landing page.

## Run locally

Requirements: WSL2 or Linux/macOS, Node 22, Docker, and the Compact toolchain (`compact update 0.31.1`).

```bash
corepack enable
yarn install
yarn compile                 # both contracts, with ZK keys
yarn test:sim                # in-memory simulator tests (no network)
yarn test:ui                 # web-app unit tests
yarn env:up                  # local node + indexer + proof server (compose.yml)
yarn test:local              # devnet end-to-end suite (real proofs)
yarn dev                     # web app on http://localhost:5173 (Lace on "Undeployed")
```

If ports 9944, 8088 or 6300 are taken, set `LOOTSEAL_NODE_PORT`, `LOOTSEAL_INDEXER_PORT` and `LOOTSEAL_PROOF_PORT`. Set `LOOTSEAL_SAFE_JIT=1` for long devnet runs on machines that hit V8 optimizer crashes.

**Deploy:** run `MIDNIGHT_NETWORK=preview yarn deploy`. It creates and funds a deployer wallet (printing the address for the faucet), deploys the registry and Genesis Relics, launches the drop, and writes `deployments/preview.json` plus an encrypted publisher bundle under `.secrets/` (gitignored). An interrupted launch resumes with `RESUME_REGISTRY`, `RESUME_DROP` and `LOOTSEAL_STATE_STORE`.

**Fulfiller:** see [apps/lootseal/fulfiller/README.md](apps/lootseal/fulfiller/README.md) (Docker Compose: proof server + fulfiller).

## Testing

| Suite | Count | What it covers |
|---|---|---|
| Simulator (`yarn test:sim`) | **75** | Every circuit; a rejection test for every reachable `assert`, including lying witnesses; privacy invariants after every phase; an exact-table check on a sold-out drop; a chi-square test that every box position is equally likely to hold the legendary |
| Devnet end-to-end (`yarn test:local`) | 14+ | Real proofs, NIGHT payments, refunds, escrow, and the fulfiller running unattended |
| Web app (`yarn test:ui`) | **76** | Components, routing, private state, providers, the field-test journal |
| Field test on Preview | **102/102** | 15 identities, 62 real transactions, 23 refused attacks |

CI runs compile, typecheck, simulator tests, UI tests and the build on every push.

## Project structure

```
apps/lootseal/
  contract/        lootseal.compact, registry.compact, witnesses, lib, staged deploy
  src/test/        simulator, devnet and fulfiller suites
  fulfiller/       box-opening service (Docker Compose)
  scripts/         deploy, field test, indexer cache
  deployments/     Preview addresses and the public field-test journal
  ui/              React 19 + Vite web app
packages/          Midnight harness packages (coins, fast-sync, sim)
docs/              architecture, threat model, plan, video script, deck, screenshots
```

## Roadmap

- **Threshold seed keepers:** an independent auditor co-commits the master seed, which removes the self-dealing residual risk.
- **Shielded-token purchases**, so buying is private too.
- **Provable pity timers** and guaranteed-drop rules.
- **Multi-box packs** in one proof.
- **Anonymous holder badges** using a Merkle tree with nullifiers.
- **A cross-drop publisher reputation registry.**
- **A Unity / Godot SDK.**

## Attribution and license

Lootseal is licensed under **Apache-2.0** ([LICENSE](LICENSE)). The harness packages under `packages/`, the build scripts under `scripts/` and the generated UI plumbing come from Midnight Foundation's [midnight-examples](https://github.com/midnightntwrk/midnight-examples) (Apache-2.0); see [NOTICE](NOTICE). Built with Compact 0.31.1, Midnight.js 4.1.1, wallet SDK 1.2.0 and the DApp Connector API 4.0.1.

<div align="center">

Built for the **Midnight Buildathon** on Akindo · `midnightntwrk` `compact` `zero-knowledge` `privacy` `loot-box` `gacha` `nft` `provably-fair`

</div>
