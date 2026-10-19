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
import { FieldTestPage } from "@/pages/field-test";
import { Empty } from "@/components/shell";
import { ArcaneBackground } from "@/components/background";
import { Compass, Github, BookOpen, Sparkles } from "lucide-react";
import { config } from "@/config";
import type { Route } from "@/router";

/** Which colour family a route belongs to (see the section palettes in index.css). */
export function sectionOf(route: Route): string {
  switch (route.name) {
    case "drop":
      return "drop";
    case "vault":
      return "vault";
    case "bazaar":
      return "bazaar";
    case "studio":
      return "studio";
    case "audit":
    case "verify":
    case "fieldTest":
      return "audit";
    default:
      return "home";
  }
}

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
    <div className="relative flex min-h-screen flex-col" data-section={sectionOf(route)}>
      <ArcaneBackground />
      <Header route={route} onOpenGuide={() => setGuide(true)} />
      <NetworkGuard />
      <main key={route.name} className="mx-auto w-full max-w-6xl flex-1 animate-[fade-up_0.5s_ease-out] px-4 py-8 sm:py-10">
        {route.name === "home" && <HomePage />}
        {route.name === "drop" && <DropPage address={route.address} />}
        {route.name === "vault" && <VaultPage />}
        {route.name === "bazaar" && <BazaarPage />}
        {route.name === "studio" && <StudioPage />}
        {route.name === "audit" && <AuditPage address={route.address} />}
        {route.name === "verify" && <VerifyPage address={route.address} badge={route.badge} />}
        {route.name === "fieldTest" && <FieldTestPage />}
        {route.name === "notFound" && (
          <Empty icon={<Compass className="size-8" />} title="Page not found">
            <Link to={{ name: "home" }} className="sec-text hover:underline">
              Back to drops
            </Link>
          </Empty>
        )}
      </main>
      <footer className="relative mt-16 border-t border-white/5 bg-black/20 backdrop-blur-sm">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--sec-a)] to-transparent opacity-60" />
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <span className="flex items-center gap-2 font-[family-name:var(--font-display)] text-lg font-bold">
              <Logo className="size-7" /> Lootseal
            </span>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Provably fair loot on Midnight. Odds proven in zero knowledge, randomness nobody controls, items delivered sealed to you.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              Live on {config.networkId}
            </p>
          </div>
          <div className="text-sm">
            <p className="mb-3 font-semibold">Explore</p>
            <ul className="space-y-2 text-muted-foreground">
              <li><Link to={{ name: "home" }} className="hover:text-foreground">Drops</Link></li>
              <li><Link to={{ name: "vault" }} className="hover:text-foreground">Vault</Link></li>
              <li><Link to={{ name: "bazaar" }} className="hover:text-foreground">Bazaar</Link></li>
              <li><Link to={{ name: "studio" }} className="hover:text-foreground">Studio</Link></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="mb-3 font-semibold">Learn</p>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <a className="inline-flex items-center gap-1.5 hover:text-foreground" href="https://midnight.network" target="_blank" rel="noreferrer">
                  <Sparkles className="size-3.5" /> Midnight
                </a>
              </li>
              <li>
                <a className="inline-flex items-center gap-1.5 hover:text-foreground" href="https://docs.midnight.network" target="_blank" rel="noreferrer">
                  <BookOpen className="size-3.5" /> Docs
                </a>
              </li>
              <li>
                <a className="inline-flex items-center gap-1.5 hover:text-foreground" href="https://github.com/SuryaXyz-art/Lootseal" target="_blank" rel="noreferrer">
                  <Github className="size-3.5" /> Source
                </a>
              </li>
              <li>
                <button className="hover:text-foreground" onClick={() => setGuide(true)}>
                  Get set up
                </button>
              </li>
            </ul>
          </div>
        </div>
        <p className="border-t border-white/5 py-4 text-center text-xs text-muted-foreground">
          Lootseal · provably fair loot on Midnight ({config.networkId}) · Apache-2.0
        </p>
      </footer>
      <Guide open={guide} onClose={() => setGuide(false)} />
    </div>
  );
}
