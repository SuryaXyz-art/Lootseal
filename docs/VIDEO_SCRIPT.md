# Lootseal demo video: script and shot list (about 3:50, voiced)

**Setup before recording:**
- Two browser profiles, each with Lace on **Preview**, funded with NIGHT, and with DUST accruing:
  - **Publisher**: your Studio wallet.
  - **Player**: a second wallet.
- The fulfiller running for Genesis Relics.
- Record at 1920×1080 with the browser at 110% zoom, and the mic close.

| Time | Shot | Voice-over |
|---|---|---|
| 0:00–0:15 | Black → Lootseal landing hero, the box floating | "One percent legendary. Says who? Every loot box and mystery mint publishes odds — and nobody can check them." |
| 0:15–0:40 | Deck slide 2 (problem), then 3 (why transparency fails) | "Insiders snipe the rares, bots time their buys, and regulators from China to South Korea now demand odds disclosure. But publishing the whole drop table ruins the surprise and hands bots a map. We need to prove the odds while hiding the table — which is exactly what Midnight's selective disclosure is for." |
| 0:40–1:15 | **Studio** (publisher profile): the template loads, the live odds preview, hover over the "How many of each item exist stays secret" text, click **Launch**, the launch steps tick through | "This is Lootseal. A publisher designs a drop: item names and tiers are public, but how many of each item exists stays secret. When they launch, Lootseal commits that hidden table and proves, in zero knowledge, that it matches the advertised odds — before anyone buys. The publisher also posts a bond." |
| 1:15–1:35 | **Drop page** (player profile): the odds bars with "Proven in zero knowledge at launch", the "What's left is hidden, by design" card | "Players see the proven odds — and nothing about what's left. Because the remaining supply is hidden, every box carries exactly the advertised chance. There's nothing to snipe." |
| 1:35–2:10 | Click **Open a box** → Lace approval → "Sealed · #1 in queue · refundable in …" → the reveal animation plays: shake, burst, flip, a legendary or epic card | "I open a box and pick my own seed. The draw combines it with a seed the publisher committed before the sale — so neither of us controls the result. The publisher's fulfiller proves the draw on chain, and the item is encrypted to me inside the same proof. If they ever miss the deadline, I get a refund plus a penalty from their bond." |
| 2:10–2:35 | **Vault**: the item card → **Prove rarity** → follow the `/verify` link in a fresh incognito window (no wallet) | "My vault decrypts items locally — nobody else can see what I hold. I can prove 'this is top 5%' without revealing which item it is, and anyone can verify the badge, no wallet needed." |
| 2:35–3:00 | **List on bazaar** → switch to the publisher profile → **Bazaar** → **Buy** → back to the player → **Deliver & get paid** → the item appears in the buyer's vault | "On the bazaar, buyers see the proven rarity, not the item. Payment sits in escrow, and when I settle, the contract itself delivers the item to the buyer's keys and pays me in the same transaction — a fair exchange enforced by zero knowledge." |
| 3:00–3:20 | **Audit page**: the checklist; after the reveal, the advertised-vs-delivered chart; **Verify odds on chain** | "After the sale, the publisher reveals the table. The audit page re-checks everything from public data, and anyone can record the verification on chain. The master seed is never revealed, so individual draws stay private forever." |
| 3:20–3:40 | Deck slide 7 (dual ledger), then slide 8 (tests) | "Under the hood: two Compact contracts, private state in the browser, witness-checked draws, Jubjub Diffie-Hellman delivery, and a staged deploy that installs circuits through signed maintenance updates. Sixty-eight simulator tests, including privacy checks after every phase and a chi-square fairness test, plus fourteen devnet end-to-end tests with real proofs." |
| 3:40–3:50 | Hero, then the GitHub URL | "Lootseal. Prove the odds were real — spoil no surprise." |

**Captions to burn in:** "Odds proven at launch", "Seed nobody controls", "Remaining supply hidden", "Encrypted delivery", "Rarity proof", "Escrowed bazaar", "Public audit".
