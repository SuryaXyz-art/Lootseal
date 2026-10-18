# @lootseal/ui

The Lootseal web app: React 19, Vite 6 and Tailwind 4, connected to Midnight through the Lace DApp Connector API 4.0.1.

```bash
yarn compile        # from the repo root: the app serves the compiled ZK keys
yarn dev            # http://localhost:5173
yarn build          # static build in apps/lootseal/ui/dist (deploy as-is, e.g. `vercel deploy dist`)
yarn test:ui
```

Configuration comes from `../deployments/preview.json`. You can override it with `VITE_*` variables; see `.env.example`.

| Route | Page |
|---|---|
| `#/` | drop directory (registry entries verified against each drop) |
| `#/drop/<address>` | catalog, proven odds, buy → sealed → reveal, refunds, publisher queue |
| `#/vault` | your items, decrypted locally: prove rarity, send, list, deliver sales, backups |
| `#/bazaar` | listings with ZK-proven rarity, escrowed buying, refunds |
| `#/studio` | create and launch a drop, then run it |
| `#/audit/<address>` | every guarantee checked from public data; verify the odds on chain |
| `#/verify/<address>/<badge>` | public rarity-badge check (no wallet needed) |

The wallet connector, providers, encrypted private-state store, hooks and generic components come from the midnight-examples UI template (Apache-2.0). Lootseal's own code is in `src/pages`, `src/components/{loot,box-opener,shell,modal}.tsx`, `src/hooks/use-lootseal.ts`, `src/midnight/lootseal-api.ts`, `src/lib/{art,drop-view,format}.ts`, `src/providers/tx-context.tsx` and `src/router.tsx`.
