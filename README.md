# Lootseal

**Prove the odds were real. Spoil no surprise.**

Lootseal is a fairness layer for loot boxes, gacha pulls and NFT mystery mints, built on [Midnight](https://midnight.network).

- **Odds proven at launch.** The publisher commits a hidden drop table and proves, in zero knowledge, that it matches the advertised odds before anyone buys.
- **A draw nobody can steer.** Every box is drawn from that table by a circuit, using a committed seed and the buyer's own seed.
- **Nothing to snipe.** The remaining supply stays hidden.
- **Encrypted delivery.** The item reaches its buyer encrypted inside the same proof that drew it.
- **Rarity without disclosure.** Holders can prove "this is top 1%", gift items, and sell them through an escrowed bazaar, all without revealing what they hold.
- **A public audit.** When the sale ends, anyone can check that the table matched what was advertised.

> Built for the Midnight Buildathon (Akindo). Repository topics: `midnightntwrk` `midnight` `compact` `zero-knowledge` `zk` `privacy` `loot-box` `gacha` `nft` `provably-fair`.

---

## The problem

Games and NFT launches publish odds ("1% legendary") that nobody can check. Insiders snipe rare items before a reveal, and bots time purchases when the rares are left. Regulators are pushing on this:

- **China and South Korea** require loot-box probability disclosure. South Korea's rules have been in force since 2024.
- **Apple and Google** require odds disclosure in their app stores.
- **Belgium** treats paid loot boxes as gambling.

Publishing the whole drop table isn't the answer either. It spoils the surprise, and it hands bots a map.

## How Lootseal solves it

| Guarantee | How |
|---|---|
| The odds are real | `commitTable` proves in zero knowledge that the hidden per-item counts sum, per tier, to the advertised `tierTotals`. Only the tier totals are public; the item-level table stays secret. |
| Nobody controls the draw | The roll for box *k* is `persistentHash(masterSeed, buyerSeed, k)`. The master seed is committed before the sale and never revealed. The buyer picks their seed when buying. `openBox` proves the item came from that roll and from the hidden remaining supply. |
| No sniping, every box is equal | Remaining supply is only ever a salted commitment, re-committed after every open. Because the draw order is random and the remainder is hidden, every box carries exactly the advertised chance. This is tested statistically in `fairness.sim.test.ts`. |
| The publisher can't withhold a bad box | Boxes open strictly first-in, first-out (FIFO), within `fulfillWindow`. Once it passes, anyone can call `claimRefund`, which pays the buyer the price plus a penalty from the publisher's bond and marks the drop **DEFAULTED** forever. |
| Only the buyer learns the item | `openBox` encrypts the item to the buyer's Jubjub key with Diffie-Hellman (`ecMul`), and the same proof binds the ciphertext to the item commitment. The buyer's browser decrypts it using the contract's own pure circuits. |
| Rarity without disclosure | `proveRarityTier` publishes "tier ≤ T" for an item the caller owns; type and serial stay private. Badges are tied to the item's version and go stale when it moves. |
| Private gifting and trade | `transferItem` re-encrypts the item to a receiver's Lootseal ID. The bazaar (`listItem` → `buyListing` → `settleListing`) escrows NIGHT, and the contract itself delivers the item to the buyer's keys in the settling transaction. If the seller doesn't settle, the buyer is refunded after the deadline. |
| A public audit | `finalReveal` opens the initial table and the unsold remainder. `verifyOdds` lets anyone re-check them on chain. The master seed is never revealed, so individual draws stay private forever. |

The residual risks are stated in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), including a publisher buying its own boxes through other wallets.

## Architecture

```
 Lootseal web app (React 19 + Vite) ──── Lace (DApp Connector 4.0.1): balance · prove · submit · DUST fees
   Drops · Drop · Vault · Bazaar · Studio · Audit · Verify
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

The full design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the contract card is in [apps/lootseal/SPEC.md](apps/lootseal/SPEC.md).

### Contracts and circuits

| Contract | Circuits |
|---|---|
| `apps/lootseal/contract/lootseal.compact` | `commitTable`, `commitSeed`, `requestBox`, `openBox`, `claimRefund`, `proveRarityTier`, `transferItem`, `listItem`, `buyListing`, `settleListing`, `cancelListing`, `refundListing`, `claimProceeds`, `finalReveal`, `verifyOdds`, plus 15 pure circuits shared with TypeScript (`rollOf`, `itemCommit`, `deliveryMask`, `sharedPoint`, …) |
| `apps/lootseal/contract/registry.compact` | `registerDrop` |

**Staged deploy.** A drop has 15 provable circuits, and deploying them all at once exceeds the per-block `bytes_written` budget. So `contract/staged-deploy.ts` deploys the 4 launch circuits, then installs the other 11 verifier keys with signed contract-maintenance updates (`VerifierKeyInsert`), 4 per transaction. A launch that stops part-way resumes from chain state.

### Using the dual-ledger model

- **Public ledger:** commitments, catalog, odds, the request queue, item commitments, ciphertexts, badges, listings.
- **Private state:** the publisher's table, seed and supply; each holder's keys and decrypted items. It lives only in the prover's own store.
- **Witness-checked work:** the roll reduction (`divMod64`) and the item pick (`pickType`) are computed off chain and verified in circuit, so a lying witness only makes the call fail.
- **Never index a ledger field with a secret.** The catalog and supply vectors are always read whole and selected in-circuit with `fold`/`map`.
- **Unshielded NIGHT** flows through `receiveUnshielded` and `sendUnshielded`: price, bond, penalty, escrow, refunds, proceeds.

## Deployed (Midnight Preview)

See [`apps/lootseal/deployments/preview.json`](apps/lootseal/deployments/preview.json) for the registry address, the demo drop **Genesis Relics** (1,000 boxes: 1% Legendary, 4% Epic, 15% Rare, 30% Uncommon, 50% Common) and the deploy time.

## Try it (judges: 5 steps)

1. Install [Lace](https://www.lace.io) with Midnight and switch it to **Preview**.
2. Fund the wallet from the [Preview faucet](https://midnight-tmnight-preview.nethermind.dev/). In Lace, designate the NIGHT for DUST and wait a few minutes.
3. Open the web app, click **Connect wallet**, and choose a passphrase for your encrypted vault.
4. Open **Genesis Relics** and click **Open a box**. When the publisher's proof lands, the reveal plays and the item appears in your **Vault**.
5. In the Vault, **Prove rarity** and follow the `/verify` link; **List** the item on the **Bazaar**; or launch your own drop in the **Studio**. The **Audit** page shows every guarantee.

## Run it locally

Requirements: WSL2 or Linux/macOS, Node 22, Docker, and the Compact toolchain (`compact update 0.31.1`).

```bash
corepack enable
yarn install
yarn compile                 # both contracts, with ZK keys
yarn test:sim                # 68 in-memory tests (no network)
yarn test:ui                 # 72 web-app unit tests
yarn env:up                  # local node + indexer + proof server (compose.yml)
yarn test:local              # devnet end-to-end suite (real proofs)
yarn dev                     # web app on http://localhost:5173 (Lace on "Undeployed")
```

If ports 9944, 8088 or 6300 are taken, set `LOOTSEAL_NODE_PORT`, `LOOTSEAL_INDEXER_PORT` and `LOOTSEAL_PROOF_PORT`. Set `LOOTSEAL_SAFE_JIT=1` for long devnet runs on machines that hit V8 optimizer crashes.

**Deploy:** `MIDNIGHT_NETWORK=preview yarn deploy`. It creates and funds a deployer wallet (it prints the address for the faucet), then deploys the registry and Genesis Relics, launches the drop, and writes `deployments/preview.json` plus an encrypted publisher bundle under `.secrets/` (gitignored).

**Fulfiller:** see [apps/lootseal/fulfiller/README.md](apps/lootseal/fulfiller/README.md) (Docker Compose: proof server + fulfiller).

## Tests

| Suite | What it covers | Result |
|---|---|---|
| `lootseal.sim.test.ts` | every circuit's happy path, plus a rejection test for every reachable `assert`, including lying witnesses, tampered supply, wrong seed, early reveal, a forged owner and stale listings | 53 passing |
| `privacy.sim.test.ts` | `assertNotInPublicState` after every phase (launch, sales, opens, badges, transfers, bazaar, reveal); item openings never visible; transfer receivers unlinkable | 3 passing |
| `fairness.sim.test.ts` | a sold-out 100-box drop hands out exactly the committed table; legendary position uniform over 150 drops (chi-square) | 2 passing |
| `lib.sim.test.ts` | supply replay, encrypted backups, Lootseal IDs, text encoding | 7 passing |
| `registry.sim.test.ts` | registration, impostor entries, guards | 3 passing |
| `lootseal.test.ts` (devnet) | full lifecycle with real proofs: staged deploy, launch, registry, 3 buys (sells out), FIFO opens, decryption, badge, gift, bazaar sale, cancel, proceeds, reveal + `verifyOdds`, refund and escrow-refund paths | 14 passing |
| `ui/src/__tests__` | routing, formatting, art, drop views, error mapping, providers, wallet context, app rendering | 72 passing |

## Progress this wave

This wave covers all of Lootseal: both contracts, the shared TypeScript layer (decryption, supply replay, staged deploy, encrypted bundles), the tests above, the web app, the fulfiller, the deploy script and the docs. See [CHANGELOG.md](CHANGELOG.md).

## Roadmap

- **Threshold seed keepers:** an independent auditor co-commits the master seed, which removes the self-dealing residual.
- **Shielded-token purchases**, so buying is private too.
- **Provable pity timers** and guaranteed-drop rules.
- **Multi-box packs** in one proof.
- **Anonymous holder badges** using a Merkle tree with nullifiers.
- **A cross-drop publisher reputation registry.**
- **A Unity / Godot SDK.**

## Attribution and license

Lootseal is licensed under **Apache-2.0** ([LICENSE](LICENSE)). The harness packages under `packages/`, the build scripts under `scripts/` and the generated UI plumbing come from Midnight Foundation's [midnight-examples](https://github.com/midnightntwrk/midnight-examples) (Apache-2.0); see [NOTICE](NOTICE). Built with Compact 0.31.1, Midnight.js 4.1.1, wallet SDK 1.2.0 and the DApp Connector API 4.0.1.
