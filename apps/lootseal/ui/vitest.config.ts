import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests only: jsdom + a mocked `window.midnight`, no wallet, network or
// proof server. vitest brings its own Vite, so none of the app's browser
// plugins (wasm, polyfills) are needed; JSX is transformed natively.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    // Keep the app off the live network: no registry and no featured drops,
    // whatever deployments/preview.json currently records.
    env: { VITE_REGISTRY_ADDRESS: "", VITE_FEATURED_DROPS: "" },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
