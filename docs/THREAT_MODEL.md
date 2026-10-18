# Lootseal threat model

This document lists what Lootseal guarantees, against whom, and what it does not protect.

## Actors

- **Publisher:** creates the drop and holds the hidden table, the master seed and the encryption key.
- **Buyer / holder:** buys boxes, holds items, gifts and trades them.
- **Observer:** anyone reading the chain, including bots and competitors.
- **Fulfiller operator:** whoever runs the fulfiller. Usually the publisher, since it holds the publisher secrets.

## Guarantees

| # | Guarantee | Enforced by | Holds against |
|---|---|---|---|
| G1 | The hidden table matches the advertised tier odds | `commitTable` (ZK proof) plus `finalReveal`, which opens the same commitment | publisher |
| G2 | Each box's item is determined at purchase by inputs fixed before it | `openBox` checks the seed against `seedCommit`, the supply against `remainingCommit`, and the roll, reduction and pick | publisher and buyer |
| G3 | The publisher cannot skip or reorder boxes | strict FIFO on `openedCount` | publisher |
| G4 | A box that isn't opened in time is refunded with a penalty | `claimRefund` (anyone can call it) pays the stored refund address, and the drop becomes DEFAULTED | publisher |
| G5 | Only the buyer learns what they got | DH-encrypted delivery computed in the proof; a commitment check on decryption | observer and publisher (see L4) |
| G6 | Remaining supply is hidden, so every box has exactly the advertised odds | salted `remainingCommit`, re-salted on every open; vectors never read at a secret index | observer, bots, insiders without the seed |
| G7 | Rarity badges are sound | `proveRarityTier` requires the owner key and checks tier ≤ bound | holder |
| G8 | Bazaar sales are fair exchanges | escrowed payment; `settleListing` pays the seller **and** delivers to the buyer's escrowed keys in one transaction; `refundListing` after the deadline | seller and buyer |
| G9 | Individual draws stay private after the sale | the master seed is never revealed; only aggregates are | observer and future publisher leaks |
| G10 | Registry entries can't impersonate a drop | the entry's key is derived from the registrant's witness and checked against the drop's `publisherPk` | spammer |

## Privacy invariants

Every invariant is checked by `assertNotInPublicState` (see `apps/lootseal/SPEC.md`):

- **Never public:** the master seed, every salt, the publisher secrets and encryption scalar, holder owner and encryption secrets, DH shared secrets, and any item's type and serial.
- **Never public until `finalReveal`:** per-item counts and remaining supply.

## Accepted leaks

- **L1. Purchases are visible.** The buyer's NIGHT address, how many boxes it bought, and the request-to-item mapping are public (item id = `itemIdOf(requestIndex)`). Payments use unshielded NIGHT. Shielded purchases are on the roadmap.
- **L2. Transfers are visible, recipients are not.** That an item changed hands is visible (its version bumps), but not to whom.
- **L3. Listing details are visible.** A listing's price and the proven tier bound are public by design.
- **L4. The publisher knows each buyer's item.** It computes the draw. The publisher cannot change the item, and cannot prove it to anyone else without revealing its own secret. An observer still learns nothing.
- **L5. Aggregates after the reveal.** Per-item totals become public after the reveal.
- **L6. Circuit names are public.** The entry point of every transaction is visible.

## Residual risks

- **R1. Self-dealing publisher.** A publisher that buys its own boxes through other wallets knows the master seed, so it can choose buyer seeds that draw rare items *for itself*.
  - **What still holds:** the committed totals (G1) and FIFO (G3), every box an honest buyer opens is still drawn by the committed rule (G2), and the final reveal still proves the table.
  - **What changes:** the honest buyers' share of rare items shrinks.
  - **Today's mitigations:** each attempt costs a real box, and the per-wallet purchase pattern is public (L1).
  - **Planned fix:** threshold seed keepers. An independent auditor co-commits half of the seed, and `openBox` needs both shares.
- **R2. Fulfiller downtime.** If the fulfiller is down, buyers wait, then get refunds plus the penalty (G4). The publisher loses bond, not the buyers.
- **R3. Key loss.** Holder and publisher secrets live in the browser's encrypted store. Losing them loses the ability to prove ownership. Backups (AES-GCM, PBKDF2 at 310k iterations) are provided; keeping them safe is the user's job.
- **R4. Proof server trust.** Whoever runs the proof server sees the witness data. The app defaults to the wallet's own proving; the fulfiller runs its proof server locally. Never use a shared public proof server.
- **R5. Clock skew.** `requestBox` and `buyListing` accept the caller's timestamp within ±5 minutes of block time. A malicious caller can shift `requestedAt` by up to 5 minutes, and with it their own refund deadline. That is a bounded effect on their own box only.
