# Lootseal architecture

This document explains how Lootseal is built and why. The contract-level design card, covering every ledger field, circuit, assert, witness and privacy invariant, is [apps/lootseal/SPEC.md](../apps/lootseal/SPEC.md). The threat model is [THREAT_MODEL.md](THREAT_MODEL.md).

## Repository layout

```
Lootseal/
├─ apps/lootseal/
│  ├─ contract/        lootseal.compact · registry.compact            (Compact 0.31.1, language 0.23)
│  │                   witnesses.ts · registry-witnesses.ts          (off-chain half of the circuits)
│  │                   lib.ts · bundle.ts · staged-deploy.ts         (shared TS: browser + Node)
│  │                   index.ts                                       (compiled-contract exports)
│  ├─ src/             config.ts · providers.ts · wallet.ts           (Node harness)
│  │                   test/*.sim.test.ts · test/lootseal.test.ts    (simulator + devnet suites)
│  ├─ ui/              React 19 + Vite 6 + Tailwind 4 web app
│  ├─ fulfiller/       automatic box opener (Node + Docker Compose)
│  ├─ scripts/         deploy.ts · wait-for-dust.ts
│  └─ deployments/     <network>.json (public addresses)
├─ packages/           sim · fast-sync · coins (vendored midnight-examples harness)
├─ scripts/            compile-contracts.mjs · validate-example.mjs
└─ docs/               ARCHITECTURE · THREAT_MODEL · VIDEO_SCRIPT · deck/
```

## Contracts

### `lootseal.compact` — one deployment per drop

The drop is a state machine: `SETUP → TABLE_COMMITTED → LIVE → REVEALED`, or `LIVE → DEFAULTED` if any box goes unopened past its window.

| Phase | Circuit | What is proven |
|---|---|---|
| Launch | constructor | the catalog, tier totals and terms are sealed; the tier totals add up to the supply |
| | `commitTable` | **the hidden per-item counts sum, per tier, to `tierTotals`** (the odds proof); the publisher's bond is received |
| | `commitSeed` | the master seed is bound by a salted commitment |
| Sale | `requestBox` | the price is received; the buyer's seed, owner key and encryption key are queued |
| | `openBox` | for request `openedCount` (strict FIFO): the roll = `rollOf(seed, buyerSeed, idx)`, reduced mod the remaining total by a checked witness; the pick lands in the right item's slice of the hidden remaining supply; the supply is decremented and re-committed under a fresh salt; the item commitment and its encrypted delivery are written |
| | `claimRefund` | past `requestedAt + fulfillWindow` a pending request pays price + penalty from the bond, and the drop becomes DEFAULTED |
| Holding | `proveRarityTier` | the caller can open the item's commitment with their owner key, and its tier is ≤ the claimed bound |
| | `transferItem` | the same ownership proof, then a re-commitment and re-encryption to the receiver's keys |
| Bazaar | `listItem` / `buyListing` / `settleListing` / `cancelListing` / `refundListing` | the listing carries a proven rarity bound; payment is escrowed with the buyer's keys; settling moves the item **to those keys** and pays the seller in one transaction; refund after `settleWindow` |
| Close | `claimProceeds` | proceeds for opened boxes only |
| | `finalReveal` | after the sale, both commitments are opened publicly; the bond is returned |
| | `verifyOdds` | anyone re-checks the revealed table and records the result |

### `registry.compact`

A directory of drops. `registerDrop` stores `persistentHash("lootseal:pub:", secret)` derived from the registrant's witness. The app lists an entry only if that key equals the `publisherPk` stored by the drop at that address, so spam entries are hidden.

## Randomness

```
roll  = first 8 bytes of persistentHash("lootseal:roll:", masterSeed, buyerSeed, idx)    (Uint<64>)
pick  = roll mod (totalSupply − idx)          witness divMod64, checked: rem < d ∧ q·d + rem = roll
type  = t with before(t) ≤ pick < before(t) + remaining[t]   witness pickType, checked by prefix sums
```

- The **master seed** is committed before the sale and never revealed.
- The **buyer seed** is chosen in the buyer's browser at purchase time, after the seed commitment exists.
- Compact circuits cannot read block hashes, so there is no block entropy. The two committed sources give the guarantees in [THREAT_MODEL.md](THREAT_MODEL.md).
- `Uint` arithmetic doesn't wrap, so the division check holds over the integers. The roll is 64 bits against at most 2³² remaining boxes, so the modulo bias is below 2⁻³².

## Encrypted delivery

Each holder has an encryption scalar `x` and publishes `X = x·G` with their request. The circuit performs Jubjub Diffie-Hellman:

```
openBox:   S = ecMul(X_buyer, y_publisher)        (asserts y·G = publisherEncKey)
transfer:  S = ecMul(X_receiver, e)               (fresh ephemeral e; E = e·G published)
cipher     = (itemType·2³² + serial) + mask(S, itemId, version)      (Field arithmetic)
salt       = H("lootseal:salt:", S.x, itemId, version)
commitment = persistentCommit([itemType, serial, ownerPk], salt)
```

The receiver computes `S = x·E` using the contract's own pure circuit (`sharedPoint`), removes the mask, rebuilds the commitment, and accepts the item only if it matches the one on chain (`tryDecryptDelivery` in `contract/lib.ts`). Trial-decrypting other people's deliveries therefore always fails. Because the ciphertext is computed inside the proof, a dishonest publisher or seller cannot send garbage.

## Private state and the replay trick

Each participant's private state is one `LootsealPrivateState` per drop: owner and encryption secrets, decrypted item openings, and for the publisher the table, seed and a supply cache. The web app stores it in IndexedDB, encrypted under a passphrase (`levelPrivateStateProvider`). Backups move between devices as AES-GCM bundles (`contract/bundle.ts`).

The publisher's supply opening changes with every box. Instead of trusting a cached copy, `replaySupply` rebuilds it from the secrets plus the public request log: every draw is deterministic. It also checks the result against `remainingCommit` on chain. This means the browser and the fulfiller can both act for the publisher without ever diverging. The same check rejects secrets that belong to another drop.

## Staged deployment

Deploying a 15-circuit drop in one transaction writes about 40 KB of modelled state, against a 50 KB per-block `bytes_written` limit. The node accepts the transaction into its mempool but never includes it in a block. `contract/staged-deploy.ts`:

1. Runs the constructor with `createUnprovenDeployTx`, but deploys a `ContractState` holding only `commitTable`, `commitSeed`, `requestBox` and `openBox`.
2. Stores the private state and the maintenance signing key before submitting, so nothing is lost if the run is interrupted.
3. Installs the remaining 11 verifier keys with signed `MaintenanceUpdate`s (`VerifierKeyInsert`), 4 per transaction.
4. `installMissingCircuits` resumes from chain state; the Studio shows **Install remaining circuits** only if a launch stopped part-way.

The keys installed are the contract's compiled keys, and anyone can compare them with the published build.

## Web app

- **Reads** use a public indexer client (`config.indexerUri`), so drops, the audit and badge verification work with no wallet.
- **Writes** go through the Lace DApp Connector. The wallet balances the transaction, pays DUST, and proves it (or a local proof server does). midnight-js `submitCallTx` runs locally, so a failing `assert` is reported before anything is submitted.
- **All writes run through one queue** (`enqueue`). The private-state store has a single active contract address, so two concurrent calls on different drops could otherwise cross wires.
- **Every control is wired.** State-dependent buttons are disabled with a reason (for example, final reveal before the sale ends).
- **Item art** is procedural SVG, deterministic per `(drop, item, tier)`. The reveal is a CSS animation that respects `prefers-reduced-motion`.

## Deviations from the original plan

| Plan | Built | Why |
|---|---|---|
| "block value" as an entropy source | committed master seed + buyer seed + index | Compact circuits cannot read block hashes |
| one deploy transaction per drop | staged deploy with maintenance key installs | the 50 KB per-block write limit |
| `requestedAt` from block time | caller's `now`, checked to ±5 min against block time | circuits can only compare against block time, not read it |
| publisher key bound to `kernel.self()` | bound to a fresh per-drop secret | the constructor runs before the contract has an address |
| `verifyOdds` with asserts | records a Boolean | the checks are unreachable after `finalReveal`'s commitment checks; asserting would add dead failure paths |
| reduce-to-64-bits witness | `slice<8>(hash)` cast to `Uint<64>` | Compact can slice bytes directly, which avoids a bounded-quotient witness |
