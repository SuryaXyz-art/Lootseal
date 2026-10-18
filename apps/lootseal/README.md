# @lootseal/app

The Lootseal contracts, their TypeScript layer, the test suites, the deploy script and the fulfiller. See the [repository README](../../README.md) for the overview, and [SPEC.md](SPEC.md) for the contract design card.

| Path | Contents |
|---|---|
| `contract/lootseal.compact` | the drop contract (15 provable circuits + 15 pure circuits) |
| `contract/registry.compact` | the drop registry |
| `contract/witnesses.ts`, `registry-witnesses.ts` | private state and witnesses (browser-safe) |
| `contract/lib.ts` | decryption, vault sync, supply replay, odds, Lootseal IDs |
| `contract/bundle.ts` | encrypted backups |
| `contract/staged-deploy.ts` | deploy within block limits, then install circuits |
| `src/test/*.sim.test.ts` | in-memory suites (no network, no proofs) |
| `src/test/lootseal.test.ts` | devnet end-to-end suite (real proofs) |
| `scripts/deploy.ts` | `yarn deploy`: registry + demo drop |
| `fulfiller/` | automatic box opener |
| `ui/` | the web app |

## Commands (from the repository root)

```bash
yarn compile          # both contracts with ZK keys (compile:fast skips the keys)
yarn test:sim         # simulator suites
yarn env:up           # local devnet (compose.yml)
yarn test:local       # devnet suite
MIDNIGHT_NETWORK=preview yarn deploy
```
