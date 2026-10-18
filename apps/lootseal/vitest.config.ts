import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';

// Remote runs read their wallet seeds from a single repo-root .env.<network>,
// so one set of funded wallets serves every example. Shell env still wins over
// file values. Generate the file with `yarn wallets:new` from the repo root.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const envFromFile = isRemote ? loadEnv(network, repoRoot, '') : {};

// LOOTSEAL_SAFE_JIT=1 turns off V8's Turboshaft optimizer phases.
// Long devnet runs on some machines hit sporadic optimizer crashes
// ("Fatal error … unreachable code"); this trades a little speed for stability.
const safeJit = process.env['LOOTSEAL_SAFE_JIT'] === '1';

export default defineConfig({
  test: {
    environment: 'node',
    execArgv: safeJit ? ['--no-turboshaft'] : [],
    globals: true,
    env: envFromFile,
    testTimeout: 10 * 60_000,
    // A remote wallet build plus the faucet funding gate needs far longer than
    // a local devnet's beforeAll.
    hookTimeout: isRemote ? 90 * 60_000 : 15 * 60_000,
    include: ['src/**/*.test.ts'],
    reporters: ['default'],
    sequence: { concurrent: false },
    // Each sim worker loads the Compact runtime (~0.5 GB); the default of one
    // worker per core overloads WSL on many-core machines.
    maxWorkers: 4,
    disableConsoleIntercept: true,
  },
});
