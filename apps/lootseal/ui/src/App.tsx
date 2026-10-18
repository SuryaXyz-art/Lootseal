// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { WalletProvider } from "@/providers/wallet-context";
import { MidnightProvidersProvider } from "@/providers/midnight-providers";
import { TxProvider, Toaster } from "@/providers/tx-context";
import { Guide, Header, Logo, NetworkGuard } from "@/components/shell";
import { useRoute, Link } from "@/router";
import { HomePage } from "@/pages/home";
import { DropPage } from "@/pages/drop";
import { VaultPage } from "@/pages/vault";
import { BazaarPage } from "@/pages/bazaar";
import { StudioPage } from "@/pages/studio";
import { AuditPage, VerifyPage } from "@/pages/audit";
import { Empty } from "@/components/shell";
import { Compass } from "lucide-react";
import { config } from "@/config";

export function App() {
  return (
    <WalletProvider>
      <MidnightProvidersProvider>
        <TxProvider>
          <Shell />
          <Toaster />
        </TxProvider>
      </MidnightProvidersProvider>
    </WalletProvider>
  );
}

function Shell() {
  const route = useRoute();
  const [guide, setGuide] = useState(false);
  return (
    <div className="min-h-screen">
      <Header route={route} onOpenGuide={() => setGuide(true)} />
      <NetworkGuard />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
        {route.name === "home" && <HomePage />}
        {route.name === "drop" && <DropPage address={route.address} />}
        {route.name === "vault" && <VaultPage />}
        {route.name === "bazaar" && <BazaarPage />}
        {route.name === "studio" && <StudioPage />}
        {route.name === "audit" && <AuditPage address={route.address} />}
        {route.name === "verify" && <VerifyPage address={route.address} badge={route.badge} />}
        {route.name === "notFound" && (
          <Empty icon={<Compass className="size-8" />} title="Page not found">
            <Link to={{ name: "home" }} className="text-violet-300 hover:underline">
              Back to drops
            </Link>
          </Empty>
        )}
      </main>
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <Logo className="size-5" /> Lootseal · provably fair loot on Midnight ({config.networkId})
          </span>
          <span className="flex gap-4">
            <a className="hover:text-foreground" href="https://midnight.network" target="_blank" rel="noreferrer">
              Midnight
            </a>
            <a className="hover:text-foreground" href="https://docs.midnight.network" target="_blank" rel="noreferrer">
              Docs
            </a>
            <button className="hover:text-foreground" onClick={() => setGuide(true)}>
              Get set up
            </button>
          </span>
        </div>
      </footer>
      <Guide open={guide} onClose={() => setGuide(false)} />
    </div>
  );
}
