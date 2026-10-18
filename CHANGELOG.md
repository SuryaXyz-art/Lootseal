# Changelog

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
