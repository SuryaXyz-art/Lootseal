# LOOTSEAL: ONE-SHOT MASTER BUILD PROMPT

> Paste everything below the line into Claude Code, opened in `C:\Users\msi\Desktop\claudeFiles\Lootseal`.

---

You are the lead engineer building **Lootseal**, a complete, production-quality Midnight dApp for the Midnight Buildathon (Akindo wave hack `jaMZjqPOBsLXvjdG`). Build the **entire** product described in `docs/LOOTSEAL_PLAN.md`. Read that file in full first; it is the source of truth for the design. This prompt adds the build rules, the toolchain, the order of work and the definition of done. Build everything fully working end to end. Do not make a reduced version, do not leave placeholders or TODO stubs, and do not ship UI that isn't wired up.

## 0. Non-negotiable rules

1. **Verify every Midnight/Compact API against ground truth. Don't recall it from memory.** Ground truth, in priority order:
   (a) the official verified monorepo `https://github.com/midnightntwrk/midnight-examples` (clone it to `~/ref/midnight-examples` and read `AGENTS.md`, `docs/compact-gotchas.md`, `docs/patterns.md`, `templates/example`, `templates/ui`, plus the examples `shielded-chips`, `silent-auction`, `private-bid`, `calculator`, `zk-loan`, `battleship`, `private-tip-jar`, `token-transfers`);
   (b) the Midnight docs `https://docs.midnight.network` (the support matrix and the Compact standard library reference);
   (c) the Midnight Kapa MCP. Install it with `claude mcp add --transport http midnight https://midnight.mcp.kapa.ai`. Also install the Midnight Expert plugins (`/plugin`, then add the marketplace `https://midnightntwrk.expert`). Use them for every Compact syntax question: loops/`fold`/`map`, `JubjubPoint` storage, `ecMul`, `blockTime*`, `receiveUnshielded`/`sendUnshielded`, `UserAddress`, `Counter`, `Map` value types, and pure circuits.
   If anything in the plan conflicts with what actually compiles and runs, keep the plan's **guarantee** and change the mechanism. Then record the change in `docs/ARCHITECTURE.md` under "Deviations".
2. **Pinned toolchain.** Never bump it:
   - Compact compiler 0.31.1 with `pragma language_version 0.23;` and `compact` devtools 0.5.1
   - `@midnight-ntwrk/midnight-js-*` 4.1.1, `@midnight-ntwrk/testkit-js` 4.1.1, `@midnight-ntwrk/wallet-sdk` 1.2.0, `@midnight-ntwrk/dapp-connector-api` 4.0.1
   - proof server 8.1.3, Node 22, Yarn 4 (node-modules linker), Vitest 4.1, Vite 6.4.3, React 19, Tailwind 4
   - Keep the midnight-examples root workarounds: the `bn.js` 5.2.5 devDependency and the `uuid` resolution.
3. **Nothing fake.** No mock data, no hard-coded balances, no simulated transactions in the UI, no "coming soon" buttons. Every button either performs a real contract or wallet action or isn't rendered. If an action depends on state, show it disabled with a one-line reason.
4. **Privacy is proven by tests, not by comments.** Every invariant in plan §6 gets an `assertNotInPublicState` check. **Never index a ledger field with a private value.** Read whole vectors and select in-circuit. Bound every witness quotient so the arithmetic holds over the integers (see `zk-loan/contract/schnorr.compact`).
5. **Secrets.** Never commit wallet seeds, mnemonics, passphrases, `.env.*`, `midnight-level-db/` or private-state exports. Commit only `.env.*.example` templates. Generate test wallets with the repo scripts and fund them from the faucet.
6. **Git.** Run `git init` in the project folder. Commit after each phase with plain conventional messages. **Never add `Co-Authored-By` or any AI attribution line** to commits or PRs. **Don't push or create a GitHub repo.** At the very end, stop and ask the user which GitHub account, commit email and repo URL to use. Then set `git config user.name` and `git config user.email` locally in this repo only, not globally.
7. Work autonomously through every phase. After each phase, run its gate (plan §14) and fix failures before moving on. Don't ask for confirmation between phases. Ask only for things only the user can do: installing the Lace extension, receiving faucet funds, choosing the GitHub account, recording the voice-over.

## 1. Environment (Windows 11, so use WSL2)

The Compact compiler and the example scripts are Unix-only, so do all building inside **WSL2 Ubuntu**.
- **Build on the Linux filesystem, never across it.** `C:\Users\msi\Desktop\claudeFiles\Lootseal` is the source of truth. Build and test in `~/lootseal` inside WSL, refreshing it with `rsync -a --delete --exclude node_modules --exclude managed --exclude dist --exclude .git /mnt/c/Users/msi/Desktop/claudeFiles/Lootseal/ ~/lootseal/` before each run. Copy generated outputs back the same way. Never run `yarn`, the compiler or tests on `/mnt/c`, and never open WSL files through `\\wsl.localhost` from Windows tools: heavy cross-filesystem I/O hangs the WSL VM.
- Keep Vitest at `maxWorkers: 4`, and run `fairness.sim.test.ts` on its own (`yarn test:sim fairness`).
- If WSL hangs (high load average with idle CPU, or `ps` hanging), run `wsl --shutdown` from Windows PowerShell, then restart Docker Desktop. Restarting only the distro does not reset the VM.
- If WSL is missing, tell the user to run `wsl --install -d Ubuntu` in an admin PowerShell and reboot. Docker Desktop needs WSL integration enabled for Ubuntu.
- In WSL, set up: `nvm` → Node 22, `corepack enable`, and Yarn 4.
- Install Compact with the official installer from the docs (`curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`; check the URL against the docs). Then run `compact update 0.31.1` and confirm with `compact compile --version`.
- Docker images (node, indexer, proof-server): use exactly what `midnight-examples` `compose.yml` pins.
- Browser: the Lace wallet extension with Midnight support. Use **Preview** for the hosted demo and **Undeployed** for the local devnet. Faucet (Preview): `https://midnight-tmnight-preview.nethermind.dev/`. DUST comes from designating NIGHT in Lace, and `yarn fund:wallet <mn_dust_…>` funds a browser wallet on the local devnet.

## 2. Scaffold (use the official generators, then make it standalone)

1. In `~/ref/midnight-examples`, run `yarn install`, then `yarn new:example lootseal --witnesses`. This gives you the harness, compose file, SPEC card, sim test and devnet test skeletons.
2. Turn `Lootseal/` into a **standalone Yarn 4 workspace**. Copy in the generated example plus the workspace packages it depends on (`packages/sim`, `packages/fast-sync`, `packages/coins`), along with the root tsconfig, vitest config and validation scripts it needs. Keep the original Apache-2.0 headers. Add a `NOTICE` crediting "Midnight Foundation: midnight-examples (Apache-2.0)" and listing what was copied. All Lootseal code carries `SPDX-License-Identifier: Apache-2.0`. The root `LICENSE` is Apache-2.0.
3. Write `contract/SPEC.md` first, from plan §5–§6, before any Compact code.
4. After the contracts compile, run the UI generator **inside the reference repo** (`yarn new:ui lootseal --private-state persistent`). Move the generated UI into `Lootseal/ui`. Keep its wallet-context, provider and proving-mode plumbing exactly as generated. Then build the full Lootseal UI on top of it.

## 3. Contracts

Implement `contract/lootseal-drop.compact` and `contract/lootseal-registry.compact` exactly as in plan §5, with every circuit, ledger field and assert:
`constructor`, `commitTable`, `commitSeed`, `requestBox`, `openBox`, `claimRefund`, `proveRarityTier`, `transferItem`, `listItem`, `buyListing`, `settleListing`, `cancelListing`, `refundListing`, `claimProceeds`, `finalReveal`, `verifyOdds`, the pure helpers `deriveOwnerPk`, `deriveEncPub`, `sharedMask` and `decryptDelivery`, and in the registry, `registerDrop`.

Key mechanics to get exactly right:
- **Identity keys:** `persistentHash([pad(32,"lootseal:<role>:"), sk, kernel.self()])`, with one secret per job.
- **Commitments:** salted `persistentCommit`. The remaining and minted state is re-committed with a new salt after every open.
- **The draw:** `transientHash` → bounded-quotient reduction to `Uint<64>` → `divMod` witness against `remainingTotal` → `pickType` witness checked against prefix sums. Every witness output is asserted.
- **Encrypted delivery:** DH over Jubjub (`ecMulGenerator` / `ecMul`). Secret scalars are `Uint<248>` so they stay below the subgroup order. The ciphertext is `packed(type, serial) + mask`, and the salt is derived from the shared secret. The browser decrypts using the compiled pure circuits, so its maths is identical to the contract's.
- **Money (unshielded NIGHT):** use `receiveUnshielded` and `sendUnshielded` for the price, bond, penalty, escrow, refunds and proceeds, following the `silent-auction` and `private-party` patterns.
- **Time:** a caller passes `now`, checked as ±120 s with `blockTimeGte` / `blockTimeLt`. Deadlines are checked with `blockTimeGte`.
- **Strict FIFO** `openBox` on `openedCount`. Once a refund is claimed, the drop is `DEFAULTED`.
- Keep every circuit a proof circuit: each one must touch the ledger, or `submitCallTx` won't accept it.

`contract/witnesses.ts` must be browser-safe (no `node:*`). It implements `reduce64`, `divMod` and `pickType`, and returns the publisher and holder secrets from typed private state.

## 4. Tests (plan §9), all green before the UI starts

- Sim tests run in memory with `packages/sim` (`Sim.deploy`, `call`, `as`, `expectRejects`). Write one happy-path test per circuit and **one negative test per assert**, including lying-witness tests for `reduce64`, `divMod` and `pickType`.
- `privacy.sim.test.ts`: `assertNotInPublicState` after every phase, for every invariant.
- `fairness.sim.test.ts`: open a full 200-box drop and check exact totals. Then run many seeded drops and check that the legendary rate by position is uniform (chi-square bound).
- `crypto.test.ts`: encryption round-trips through the pure circuits, and trial decryption ignores other users' deliveries.
- Devnet end-to-end suite: the full lifecycle plus the refund/default path. `yarn validate` must pass.
- UI unit tests with Vitest + Testing Library. Fulfiller queue tests.
- `.github/workflows/ci.yml` runs `compile:fast` → typecheck → `test:sim` → UI typecheck, unit tests and build.

## 5. Web app (`ui/`): attractive, intuitive, fully wired

Build every route in plan §8: `/` Drops, `/drop/:addr`, `/vault`, `/bazaar`, `/studio`, `/audit/:addr`, `/verify/:addr/:badge`, plus the onboarding sheet.

- **Design system:** a dark "midnight" theme (indigo-black base, violet accents, glass cards with soft borders) and the tier colours Legendary amber-gold, Epic violet, Rare sky, Uncommon emerald, Common slate. Use Inter, or a single Google font. Build on Tailwind 4 with shadcn-style primitives and lucide icons. Generate procedural SVG item art deterministically from `(dropAddress, type, tier)`; use no external images. Use Framer Motion for the box-opening reveal (shake → crack → light burst → card flip with tier glow) and honour `prefers-reduced-motion`. Make it fully responsive from 360 px up, accessible (keyboard, focus rings, AA contrast, aria-labels) and clear in empty and loading states.
- **Wallet:** the generated Lace DApp Connector flow, with a network badge, DUST and NIGHT balance readouts, and wallet or local proving modes. Encrypted persistent private state lives behind a passphrase.
- **Transaction UX:** a status toast per action (preparing → proving → submitting → confirmed, with an explorer link if one exists). Map wallet, proof and assert errors to human-readable messages, with a retry.
- **Live data:** read all ledger state through the indexer public-data provider and subscribe to updates. The Vault trial-decrypts deliveries locally with the holder's keys.
- **Studio:** the wizard deploys the drop, then calls commitTable and commitSeed (the master seed comes from `crypto.getRandomValues`), then registers the drop. It offers export and import of the passphrase-encrypted fulfiller bundle, an in-browser auto-fulfill toggle, claim proceeds, and final reveal.
- `/verify` and `/audit` work **without a wallet**, reading the indexer directly through the default network config.

## 6. Fulfiller (`fulfiller/`)

A Node 22 TypeScript service, as in plan §7. It uses the wallet-sdk facade and the level private-state provider, imports the Studio bundle, watches the drop, opens boxes FIFO, retries on conflicts, exposes `/health`, and logs as structured JSON. Ship a Dockerfile and `compose.yml` (proof-server + fulfiller) and a README covering configuration through environment variables.

## 7. Deploy to Preview and record it

- `scripts/deploy-preview.ts` deploys the registry plus the demo drop "Genesis Relics": 1,000 boxes and 16 named items. Tier counts are Legendary 10, Epic 40, Rare 150, Uncommon 300, Common 500, with the per-item split chosen privately.
- The script calls commitTable and commitSeed, registers the drop, and writes `deployments/preview.json` with addresses and tx ids.
- Before the UI build, copy the ZK assets into `ui/public/managed`. Add a Vercel-ready config (SPA rewrites, WASM MIME and headers).
- Ask the user only for the hosting logins. Start the fulfiller with the demo bundle.
- Smoke test on Preview with two browser profiles, which means two Lace wallets: open boxes → reveal → badge → list → buy → settle.

## 8. Docs and submission assets

- `README.md` with every section in plan §12, including the deployed addresses, a judge quick-test in 5 steps, and a "Progress this wave" section.
- `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md` (fairness guarantees, the self-dealing residual and its mitigations, accepted leaks) and `CHANGELOG.md`.
- `docs/deck/`: a 10-slide deck following plan §12, as an HTML slide deck plus an exported PDF.
- `docs/VIDEO_SCRIPT.md`: the 3–4 minute voiced script with a shot list and timings.
- Tell the user to add these GitHub topics: `midnightntwrk midnight compact zero-knowledge zk privacy loot-box gacha nft provably-fair`.

## 9. Definition of done (verify every line, then report honestly)

- [ ] `yarn compile` compiles both contracts with ZK keys and no warnings left unexplained.
- [ ] `yarn test:sim`, `yarn validate` (devnet), UI `typecheck`/`test:unit`/`build`, fulfiller tests and CI are all green. Report the pass counts.
- [ ] Every privacy invariant has a passing `assertNotInPublicState` test.
- [ ] The demo drop is live on Preview. Addresses are in the README and `deployments/preview.json`.
- [ ] Manual run with two wallets passes, with no console errors and no dead controls: create drop → buy → reveal → Vault → prove rarity → `/verify` → list → buy → settle → final reveal → verify odds. The refund path was tested on devnet.
- [ ] README, NOTICE, LICENSE, SPEC, ARCHITECTURE, THREAT_MODEL, CHANGELOG, deck and video script all exist.
- [ ] Git history is clean, with no secrets and no AI co-author lines. You stopped and asked the user for the GitHub account before any push.

Report what passed, what failed and any deviations from the plan, with evidence (command output). Never claim something works that you didn't run.
