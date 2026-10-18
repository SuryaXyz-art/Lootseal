# SPEC — Lootseal

## Purpose

A publisher runs a loot box / mystery mint whose odds anyone can verify: the hidden drop table is proven at launch to match the advertised tier totals, every box is drawn from the hidden remaining supply with randomness neither side controls, and the item is delivered encrypted to the buyer inside the same proof. Holders prove rarity, gift and sell items without revealing them. Kept private: the per-item supply (until the final reveal), the remaining supply, the master seed (forever), every item's identity, and who holds an item after it moves.

## Roles

| Role | Recognised by | Can |
|---|---|---|
| Publisher | `persistentHash(["lootseal:pub:", publisherSecret])` equal to the sealed `publisherPk` | commitTable, commitSeed, openBox, claimProceeds, finalReveal |
| Buyer | anyone; their per-drop owner key `persistentHash(["lootseal:own:", kernel.self(), holderSecret])` and encryption key `holderEncSecret·G` are recorded with the request | requestBox |
| Holder | knows the opening of an item's commitment and the owner secret inside it | proveRarityTier, transferItem, listItem, settleListing, cancelListing |
| Bazaar buyer | anyone; keys derived like a buyer's | buyListing |
| Anyone | no key | claimRefund (pays the stored refund address), refundListing, verifyOdds |

## Public ledger fields

| Field | Type | Written by | Why public |
|---|---|---|---|
| `title` | `Bytes<32>` | constructor | the drop's name, shown to buyers |
| `publisherPk` | `Bytes<32>` | constructor | authorises publisher circuits; the registry entry is checked against it |
| `publisherPayout` | `UserAddress` | constructor | where proceeds and the bond are paid |
| `publisherEncKey` | `JubjubPoint` | constructor | the DH key every box delivery is encrypted with |
| `catalogNames` | `Vector<16, Bytes<32>>` | constructor | the possible items, shown to buyers |
| `catalogTiers` | `Vector<16, Uint<8>>` | constructor | each item's tier; read whole, never at a secret index |
| `tierTotals` | `Vector<5, Uint<32>>` | constructor | the advertised odds |
| `totalSupply` | `Uint<32>` | constructor | number of boxes |
| `price` | `Uint<128>` | constructor | box price in NIGHT |
| `bondAmount` | `Uint<128>` | constructor | the publisher's bond |
| `penaltyPerBox` | `Uint<128>` | constructor | paid from the bond per late box |
| `saleEnd` | `Uint<64>` | constructor | sale deadline |
| `fulfillWindow` | `Uint<64>` | constructor | how long the publisher has to open a box |
| `settleWindow` | `Uint<64>` | constructor | how long a seller has to deliver a bazaar sale |
| `state` | `DropState` | lifecycle circuits | state machine |
| `tableCommit` | `Bytes<32>` | commitTable | binds the hidden drop table |
| `remainingCommit` | `Bytes<32>` | commitTable, openBox | binds the hidden remaining supply |
| `seedCommit` | `Bytes<32>` | commitSeed | binds the master seed |
| `requestCount` | `Uint<32>` | requestBox | queue length |
| `openedCount` | `Uint<32>` | openBox | FIFO cursor |
| `requests` | `Map<Uint<32>, Request>` | requestBox, openBox, claimRefund | buyer seed and keys must be public inputs of the draw |
| `items` | `Map<Bytes<32>, Bytes<32>>` | openBox, transferItem, settleListing | each item's salted commitment |
| `deliveries` | `Map<Bytes<32>, Delivery>` | openBox, transferItem, settleListing | ciphertext the current owner decrypts |
| `badges` | `Map<Bytes<32>, Badge>` | proveRarityTier | proven rarity bounds marketplaces check |
| `listings` | `Map<Bytes<32>, Listing>` | listItem, buyListing, settleListing, cancelListing, refundListing | the bazaar escrow |
| `publisherClaimable` | `Uint<128>` | openBox, claimProceeds | proceeds owed for opened boxes |
| `bondRemaining` | `Uint<128>` | commitTable, claimRefund, finalReveal | bond left for penalties |
| `refundedCount` | `Uint<32>` | claimRefund | public default record |
| `revealedInitial` | `Vector<16, Uint<32>>` | finalReveal | the audit, after the sale |
| `revealedRemaining` | `Vector<16, Uint<32>>` | finalReveal | the audit, after the sale |
| `oddsVerified` | `Boolean` | verifyOdds | on-chain audit record |
| `drops` (registry) | `Map<Uint<32>, DropEntry>` | registerDrop | the public directory of drops |
| `dropCount` (registry) | `Uint<32>` | registerDrop | directory size |
| `registered` (registry) | `Set<Bytes<32>>` | registerDrop | prevents duplicate entries |

## Private state

`LootsealPrivateState` in `contract/witnesses.ts`, one per participant per drop, created in the browser (IndexedDB, passphrase-encrypted) or the fulfiller:

- `holderSecret`, `holderEncSecret`: the owner and encryption keys; random, generated locally.
- `items`: openings `{itemType, serial, salt}` of the items the holder owns, recovered by decrypting `deliveries` (`syncVault` in `contract/lib.ts`).
- `publisher` (publisher only): `secret`, `encSecret`, the drop table opening `table`, the current supply opening `supply` (updated by `saveSupply` on every open), and the master seed opening `seed`.

## Circuits

| Circuit | Caller | Args | Effect | Asserts |
|---|---|---|---|---|
| `constructor` | publisher | `p: DropParams` | seals catalog, odds and terms; state SETUP | "Tier totals must add up to the total supply", "Total supply must be positive", "Every catalog tier must be between 0 and 4", "Penalty per box cannot exceed the bond" |
| `commitTable` | publisher | — | proves the hidden table's per-tier sums equal `tierTotals`; writes `tableCommit`, `remainingCommit`; receives the bond | "The table is already committed", "Only the publisher can do this", "Hidden table does not match the advertised odds", "An empty catalog slot cannot have supply" |
| `commitSeed` | publisher | — | writes `seedCommit`; state LIVE | "Commit the table first", "Only the publisher can do this" |
| `requestBox` | buyer | `buyerSeed`, `refundTo`, `now` | receives `price`; queues a request with the buyer's keys | "This drop is not live", "Sold out", "The sale has ended", "Invalid timestamp", "Your clock is too far from block time" |
| `openBox` | publisher | — | FIFO: draws an item for the next request from the hidden supply, re-commits the supply, writes the item commitment and its encrypted delivery | "This drop is not live", "No boxes are waiting to be opened", "Only the publisher can do this", "Seed does not match its commitment", "Supply does not match its commitment", "Invalid roll reduction", "Invalid item type", "Invalid item pick", "Wrong publisher encryption key" |
| `claimRefund` | anyone | `requestId` | after `fulfillWindow`: pays price + penalty to the buyer; state DEFAULTED | "Unknown request", "This box is not waiting to be opened", "The fulfillment window is still open" |
| `proveRarityTier` | holder | `itemId`, `maxTier`, `context` | writes a badge with the proven bound | "Unknown item", "You do not own this item", "This item is not that rare" |
| `transferItem` | holder | `itemId`, `toOwnerPk`, `toEncKey` | re-commits and re-encrypts the item to the receiver | "Unknown item", "You do not own this item", "This item has a pending bazaar sale" |
| `listItem` | holder | `itemId`, `askPrice`, `maxTier`, `payout` | opens a listing with a proven rarity bound | "Unknown item", "You do not own this item", "This item is not that rare", "This item is already listed", "Price must be positive" |
| `buyListing` | bazaar buyer | `itemId`, `refundTo`, `now` | escrows the price with the buyer's keys | "This item is not listed", "This listing is not open", "This listing is stale", "Invalid timestamp", "Your clock is too far from block time" |
| `settleListing` | seller | `itemId` | delivers to the escrowed keys and pays the seller | "This item is not listed", "This listing has no buyer waiting", "Unknown item", "You do not own this item" |
| `cancelListing` | seller | `itemId` | cancels an open listing | "This item is not listed", "Only an open listing can be cancelled", "Unknown item", "You do not own this item" |
| `refundListing` | anyone | `itemId` | after `settleWindow`: returns the escrow to the buyer | "This item is not listed", "This listing has no buyer waiting", "The seller still has time to deliver" |
| `claimProceeds` | publisher | — | pays `publisherClaimable` | "Only the publisher can do this", "Nothing to claim" |
| `finalReveal` | publisher | — | after the sale: opens both commitments publicly; returns the bond; state REVEALED | "Only a live drop can be revealed", "Only the publisher can do this", "The sale is still running", "Open every requested box first", "Table does not match its commitment", "Supply does not match its commitment" |
| `verifyOdds` | anyone | — | re-checks the revealed table against the odds and the opened count; records the result in `oddsVerified` | "The table has not been revealed yet" |
| `publisherKey` (pure) | app | `sk` | the publisher key the contract stores | — |
| `holderKey` (pure) | app | `self`, `sk` | a holder's per-drop owner key | — |
| `encPublicKey` (pure) | app | `sk` | a Jubjub public key `sk·G` | — |
| `sharedPoint` (pure) | app | `sk`, `other` | the DH shared point `sk·other` | — |
| `itemIdOf` (pure) | app | `idx` | the item id of request `idx` | — |
| `itemSalt` (pure) | app | `shared`, `itemId`, `version` | an item commitment's salt, derived from the shared point | — |
| `deliveryMask` (pure) | app | `shared`, `itemId`, `version` | the one-time mask over the packed opening | — |
| `packOpening` (pure) | app | `op` | `itemType·2^32 + serial` | — |
| `itemCommit` (pure) | app | `op`, `ownerPk` | an item's commitment | — |
| `badgeIdOf` (pure) | app | `itemId`, `context`, `version` | a badge's key | — |
| `tableCommitOf` (pure) | app | `t` | the drop table commitment | — |
| `supplyCommitOf` (pure) | app | `s` | the supply commitment | — |
| `seedCommitOf` (pure) | app | `s` | the seed commitment | — |
| `registerDrop` (registry) | publisher | `dropAddress`, `title`, `now` | adds a directory entry carrying the publisher key derived from the registrant's secret | "This drop is already registered", "Invalid timestamp", "Your clock is too far from block time" |

`verifyOdds` records a Boolean instead of asserting: `finalReveal` only accepts openings of the commitments that `commitTable` and `openBox` already checked, so for any drop that reached REVEALED the checks hold, and asserting them would add failure paths no chain can reach.

## Witnesses

| Witness | Returns | From private state |
|---|---|---|
| `publisherSecret` | `Bytes<32>` | `publisherSecret` |
| `publisherEncSecret` | `Field` | `publisherEncSecret` |
| `tableOpening` | `TableOpening` | `publisher.table` |
| `supplyOpening` | `SupplyOpening` | `publisher.supply` |
| `seedOpening` | `SeedOpening` | `publisher.seed` |
| `saveSupply` | `[]` | writes `publisher.supply` |
| `divMod64` | `[Uint<64>, Uint<32>]` | none (computed; checked in circuit) |
| `pickType` | `Uint<8>` | none (computed; checked in circuit) |
| `holderSecret` | `Bytes<32>` | `holderSecret` |
| `holderEncSecret` | `Field` | `holderEncSecret` |
| `itemOpening` | `ItemOpening` | `items[itemId]` |
| `ephemeralSecret` | `Field` | none (fresh random scalar per transfer) |
| `registrantSecret` (registry) | `Bytes<32>` | the drop's `publisherSecret` (`RegistryPrivateState` in `contract/registry-witnesses.ts`) |

## Privacy invariants

- Never on chain: the master seed → `publisherMasterSeed`
- Never on chain: the seed commitment salt → `publisherSeedSalt`
- Never on chain: the drop table salt → `publisherTableSalt`
- Never on chain: the remaining-supply salt → `publisherSupplySalt`
- Never on chain: the publisher secret → `publisherSecret`
- Never on chain: the publisher encryption secret → `publisherEncSecret`
- Never on chain: a holder's owner secret → `aliceHolderSecret`
- Never on chain: a holder's encryption secret → `aliceHolderEncSecret`
- Never on chain: an item's commitment salt → `aliceItemSalt`
- Never on chain: the DH shared secret of a delivery → `aliceItemSharedSecret`
- Until finalReveal, no per-item initial count or remaining supply is public (`revealedInitial` and `revealedRemaining` stay zero; checked after every phase in `src/test/privacy.sim.test.ts`).
- Never on chain: an item's type and serial, i.e. its packed opening (also checked numerically against every ciphertext in `src/test/privacy.sim.test.ts`) → `aliceItemOpening`
- Never on chain: the receiver of a transfer or bazaar sale, i.e. their owner and encryption keys → `bobOwnerPk`, `bobEncKeyX`, `bobEncKeyY`

## Accepted leaks

- The buyer's NIGHT address and how many boxes it bought (payments are unshielded NIGHT), plus the buyer's per-drop owner and encryption keys in its requests.
- That request *k* produced item *k* (so the original buyer of each item is known), and the time of every open.
- That an item changed hands (its commitment and version change), but not to whom.
- A bazaar listing's price, the rarity bound the seller chose to prove, the buyer's per-drop keys and refund address.
- After `finalReveal`: the initial per-item counts and the unsold remainder (aggregates only; individual draws stay private because the master seed is never revealed).
- Which circuit each transaction called (entry points are public).
- Self-dealing residual: a publisher buying its own boxes through other wallets knows the master seed and could pick buyer seeds that draw rare items for itself. The committed totals still hold and are verified at the reveal; the planned fix is threshold seed keepers.

## Out of scope

- Shielded (private) payments for boxes and bazaar sales.
- More than 16 item types or 5 tiers per drop; multi-box packs in one proof.
- Anonymous holder badges that hide which item they refer to (a Merkle tree with nullifiers).
- Cross-contract calls between the registry and drops.

## Test-only contracts

None.
