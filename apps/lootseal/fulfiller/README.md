# Lootseal fulfiller

Opens a drop's boxes automatically, strictly in order, as soon as they are bought. Buyers then see their item within a block or two instead of waiting for the publisher to come online.

## How it works

- It holds the **publisher secrets for one drop**: the hidden table, the master seed and the encryption key. They come from the encrypted bundle the publisher exports in the web app's **Vault → Backup**, or from `.secrets/<network>/` when the drop was created by `yarn deploy`.
- Before every `openBox` it **replays the hidden supply from chain data** (`replaySupply` in `contract/lib.ts`). Every draw is deterministic: committed seed, public buyer seed, index. So the fulfiller never drifts from the chain, and the publisher can keep acting from the browser at the same time.
- It listens to the drop's state over the indexer websocket and also polls every `POLL_MS`. On a failure, such as someone else opening the same box first or a network error, it re-reads and retries with backoff.
- `GET /health` returns `{status, drop, opened, requested, pending, lastOpenedAt, lastError}`.

If the fulfiller is down for longer than the drop's fulfilment window, buyers can claim their refund plus the penalty. That is the guarantee working as designed, so keep it running.

## Run with Docker Compose

```bash
yarn compile                                    # the image ships the compiled contract and keys
cp apps/lootseal/fulfiller/.env.example apps/lootseal/fulfiller/.env
mkdir -p apps/lootseal/fulfiller/secrets
cp <your lootseal-publisher-*.json> apps/lootseal/fulfiller/secrets/publisher.json
# edit .env: DROP_ADDRESS, FULFILLER_SEED, BUNDLE_PASSPHRASE
docker compose -f apps/lootseal/fulfiller/compose.yml up -d --build
curl http://127.0.0.1:8787/health
```

The proof server runs beside the fulfiller, because a proof server sees the witness data it proves. Never point the fulfiller at a shared public proof server.

## Run without Docker

```bash
yarn env:up   # or: yarn workspace @lootseal/app proof:up for just the proof server
MIDNIGHT_NETWORK=preview DROP_ADDRESS=… FULFILLER_SEED=… \
BUNDLE_PATH=./publisher.json BUNDLE_PASSPHRASE=… yarn fulfiller
```

## Environment

| Variable | Meaning |
|---|---|
| `MIDNIGHT_NETWORK` | `local`, `preview` or `preprod` |
| `DROP_ADDRESS` | the drop to fulfil |
| `FULFILLER_SEED` / `FULFILLER_MNEMONIC` | the wallet paying fees (needs DUST) |
| `BUNDLE_PATH`, `BUNDLE_PASSPHRASE` | the encrypted publisher bundle |
| `MIDNIGHT_PROOF_SERVER` | proof server URL (compose sets it) |
| `POLL_MS`, `PORT`, `LOG_LEVEL` | optional |
