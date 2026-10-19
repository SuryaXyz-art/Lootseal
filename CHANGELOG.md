# Changelog

## 0.4.0 — Field test on Preview

### Real use, checked on chain
- `scripts/field-test.ts` (`yarn field-test`): Lootseal played by 15 identities on Midnight Preview across three drops, with every step verified against the chain afterwards: 102 checks, 62 transactions, 23 attacks refused. Resumable; writes a public journal to `deployments/preview-field-test.json` and keeps private details under `.secrets/`.
- Two new drops on Preview: **Lantern Run** (sold out, revealed, `verifyOdds` = true, escrow refund after a missed deadline) and **Ghost Lantern** (publisher default: refund plus a penalty from the bond).

### Web app
- **Field test** page (`#/field-test`): every check by story, with stats, and a live re-check of each transaction against the public indexer (block height and circuit must match the journal).
- 4 new unit tests (journal summary, grouping, indexer matching, bounded pool); 76 in total.

## 0.3.0 — Live on Preview, redesigned app

### Deployed
- Registry `9a50e32c…b9eca3` and **Genesis Relics** `24c64a4e…fde406` on Midnight Preview: odds proven, seed committed, drop registered; a fulfiller opens boxes automatically.

### Web app
- New "Midnight Arcana" theme from the logo's violet and gold, with a colour pair per section (Drops, drop page, Vault, Bazaar, Studio, Audit) and new type (Unbounded, Outfit, JetBrains Mono).
- Animated backdrop: section-tinted aurora, ledger grid, a turning rune seal and a canvas of loot sparks over a proof constellation; static under reduced motion.
- Landing page: live stats, the guarantees, "How a box opens", who it is for (players, creators, collectors, auditors), and a closing call to action; scroll reveals throughout.
- **Demo box:** a free, off-chain opening with the real Genesis Relics odds, no wallet needed.
- **Sharing:** every pull and rarity badge renders a 1200×675 image card; "Post on X" opens a decorated post and copies the card for pasting; phones share the image natively. Link previews (Open Graph / X cards) with a branded image.
- Box opening with sparks and light rays; animated odds bars, progress shine, rotating gradient borders on key panels.
- Fixes: "Browse drops" no longer routes to "Page not found"; the Bazaar empty state explains how listings appear; "Base tier" instead of "Top 100%".

### Tooling
- `scripts/indexer-cache.mjs`: parallel prefetch of zswap/dust ledger events plus a local proxy, cutting a first Preview wallet sync from ~12 hours to ~12 minutes; resumable, verified against the live indexer.
- `yarn deploy` resumes an interrupted launch (`RESUME_REGISTRY`, `RESUME_DROP`, `LOOTSEAL_STATE_STORE`).

## 0.2.0 — Midnight Buildathon submission

### Contracts (Compact 0.31.1, language 0.23)
- **`lootseal.compact` (15 provable circuits, one deployment per drop).**
  - Hidden drop table with a zero-knowledge odds proof at launch (`commitTable`).
  - Committed master seed (`commitSeed`).
  - Box purchase with buyer seed and keys (`requestBox`).
  - FIFO draw from the hidden remaining supply with witness-checked roll and pick, plus in-circuit Jubjub Diffie-Hellman encrypted delivery (`openBox`).
  - Bonded refunds with a penalty (`claimRefund`).
  - Rarity badges (`proveRarityTier`) and private gifting (`transferItem`).
  - Escrowed bazaar with a proven rarity bound (`listItem`, `buyListing`, `settleListing`, `cancelListing`, `refundListing`).
  - Proceeds (`claimProceeds`), public reveal (`finalReveal`) and an on-chain audit record (`verifyOdds`).
- **15 exported pure circuits** shared with TypeScript, so the browser's maths is identical to the proof's: keys, DH, masks, commitments, `rollOf`, `resaltOf`.
- **`registry.compact`:** an on-chain drop directory with publisher-key verification.

### TypeScript layer
- `contract/witnesses.ts`: typed, browser-safe private state and witnesses; every returned value is checked in circuit.
- `contract/lib.ts`: delivery decryption, vault sync, supply replay (`replaySupply`), odds maths, Lootseal IDs.
- `contract/bundle.ts`: AES-GCM / PBKDF2 encrypted backups for publishers and holders.
- `contract/staged-deploy.ts`: deploys large contracts within block limits by installing verifier keys through signed maintenance updates; resumable.

### Tests
- **68 simulator tests:** every circuit, a rejection test for every reachable `assert` (including lying witnesses), privacy invariants after every phase, an exact-table check on a sold-out drop, and a chi-square uniformity test.
- **14 devnet end-to-end tests** with real proofs, NIGHT payments, refunds and escrow.
- **72 web-app unit tests.**

### Web app
- Drops directory, drop page with buying, sealed wait, reveal animation and refunds, Vault (local decryption, badges, gifting, listing, delivery, backups), Bazaar, Studio (drop wizard with live odds preview, launch steps, dashboard), Audit and badge Verify pages.
- Onboarding guide, wrong-network guard, transaction toasts with readable errors.
- Procedural item art; responsive and keyboard-accessible; reduced-motion aware.

### Operations
- **Fulfiller service:** opens boxes automatically and statelessly, replaying the supply from chain data before each open. Includes Docker Compose, a health endpoint and retry with backoff.
- **`yarn deploy`:** registry plus the "Genesis Relics" demo drop on Preview, with addresses recorded in `deployments/`.
- CI: compile, typecheck, simulator tests, UI tests, build.
