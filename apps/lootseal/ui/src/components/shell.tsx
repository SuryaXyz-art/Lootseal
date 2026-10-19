// SPDX-License-Identifier: Apache-2.0
// App chrome: header, navigation, wallet button, network guard, onboarding
// and the "connect / unlock" gate actions sit behind.
import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2, LogOut, Settings, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/modal";
import { PassphraseCard } from "@/components/passphrase-card";
import { ProvingSettings } from "@/components/proving-settings";
import { useWallet } from "@/hooks/use-wallet";
import { useDustBalance } from "@/hooks/use-dust-balance";
import { useWalletBalances } from "@/hooks/use-wallet-balances";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { config } from "@/config";
import { formatNight, shortHex } from "@/lib/format";
import { Link, type Route } from "@/router";
import { cn } from "@/lib/utils";

const NAV: { label: string; to: Route }[] = [
  { label: "Drops", to: { name: "home" } },
  { label: "Vault", to: { name: "vault" } },
  { label: "Bazaar", to: { name: "bazaar" } },
  { label: "Studio", to: { name: "studio" } },
  { label: "Field test", to: { name: "fieldTest" } },
];

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8 drop-shadow-[0_0_10px_rgba(167,139,250,0.55)]", className)} aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#f6c453">
            <animate attributeName="stop-color" values="#f6c453;#f472b6;#f6c453" dur="6s" repeatCount="indefinite" />
          </stop>
        </linearGradient>
      </defs>
      <rect x="3" y="11" width="26" height="17" rx="4" fill="#1c1640" stroke="url(#logo-g)" strokeWidth="1.5" />
      <rect x="1.5" y="7" width="29" height="6" rx="2.5" fill="#2a2160" stroke="url(#logo-g)" strokeWidth="1.5" />
      <circle cx="16" cy="19" r="3.4" fill="none" stroke="url(#logo-g)" strokeWidth="1.6" />
      <path d="M16 15.6v-2.6" stroke="url(#logo-g)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Header({ route, onOpenGuide }: { route: Route; onOpenGuide: () => void }) {
  const [settings, setSettings] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-[#06051a]/70 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
        <div className="h-px w-1/4 animate-[beam_6s_linear_infinite] bg-gradient-to-r from-transparent via-[var(--sec-a)] to-transparent" />
      </div>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to={{ name: "home" }} className="group flex items-center gap-2 font-bold tracking-tight">
          <Logo className="transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-110" />
          <span className="font-[family-name:var(--font-display)] text-lg">
            Loot<span className="text-gradient">seal</span>
          </span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.label}
              to={n.to}
              className={cn(
                "relative rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground",
                route.name === n.to.name &&
                  "bg-[color-mix(in_oklab,var(--sec-a)_14%,transparent)] text-foreground after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-gradient-to-r after:from-[var(--sec-a)] after:to-[var(--sec-b)]",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onOpenGuide}
            className="hidden rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground sm:block"
          >
            Get set up
          </button>
          <Button variant="ghost" size="icon" aria-label="Proving settings" onClick={() => setSettings(true)}>
            <Settings />
          </Button>
          <WalletButton />
        </div>
      </div>
      <nav className="flex items-center justify-around border-t border-white/5 px-2 py-1 md:hidden" aria-label="Main mobile">
        {NAV.map((n) => (
          <Link
            key={n.label}
            to={n.to}
            className={cn("rounded-md px-3 py-1.5 text-sm text-muted-foreground", route.name === n.to.name && "sec-text font-medium")}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <Modal open={settings} onClose={() => setSettings(false)} title="Proving">
        <p className="mb-4 text-sm text-muted-foreground">
          Where zero-knowledge proofs are generated. Your wallet can prove for you, or you can run a local proof server.
        </p>
        <ProvingSettings />
      </Modal>
    </header>
  );
}

function WalletButton() {
  const { status, shieldedAddress, connect, disconnect, error, setRequestedNetworkId, requestedNetworkId } = useWallet();
  const balances = useWalletBalances();
  const night = balances?.unshielded?.["00".repeat(32)] ?? null;

  if (status === "connecting") {
    return (
      <Button variant="outline" disabled>
        <Loader2 className="animate-spin" /> Connecting
      </Button>
    );
  }
  if (status === "connected" && shieldedAddress) {
    return (
      <div className="flex items-center gap-1 rounded-xl border border-[color-mix(in_oklab,var(--sec-a)_30%,transparent)] bg-white/5 py-1 pl-3 pr-1">
        <span className="mr-1 size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
        <div className="text-right leading-tight">
          <p className="font-mono text-xs" title={shieldedAddress}>
            {shortHex(shieldedAddress, 8, 6)}
          </p>
          {night !== null && <p className="text-[11px] text-muted-foreground">{formatNight(night)}</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={disconnect} aria-label="Disconnect wallet">
          <LogOut />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end">
      <Button
        className="btn-glow"
        onClick={() => {
          if (requestedNetworkId !== config.networkId) setRequestedNetworkId(config.networkId as never);
          void connect();
        }}
      >
        <Wallet /> Connect wallet
      </Button>
      {status === "error" && error && <p className="absolute top-14 max-w-72 text-right text-xs text-rose-400">{error}</p>}
    </div>
  );
}

/** Warns when the wallet is on another network than the app. */
export function NetworkGuard() {
  const { status, networkId, disconnect } = useWallet();
  if (status !== "connected" || !networkId || networkId === config.networkId) return null;
  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2 text-sm text-amber-200">
        <AlertTriangle className="size-4" />
        Your wallet is on <b>{networkId}</b>, but Lootseal runs on <b>{config.networkId}</b>. Switch networks in your wallet, then reconnect.
        <Button size="sm" variant="outline" className="ml-auto" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}

/**
 * Renders `children` once a wallet is connected (on the right network) and
 * the private-state store is unlocked; otherwise the step that is missing.
 */
export function WalletGate({ children, reason }: { children: ReactNode; reason: string }) {
  const { status, networkId, connect, setRequestedNetworkId } = useWallet();
  const { locked, isReady, error } = useMidnightProviders();
  if (status !== "connected") {
    return (
      <div className="glass glow-border rounded-2xl p-8 text-center">
        <div className="relative mx-auto mb-4 grid size-16 place-items-center">
          <span className="absolute inset-0 animate-[pulse-ring_2.4s_ease-out_infinite] rounded-full border-2 border-[var(--sec-a)]" />
          <span className="grid size-14 place-items-center rounded-full bg-[color-mix(in_oklab,var(--sec-a)_18%,transparent)]">
            <Wallet className="size-7 sec-text" />
          </span>
        </div>
        <p className="font-medium">Connect a Midnight wallet {reason}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Lootseal uses Lace with Midnight on the {config.networkId} network. Your keys and item secrets stay in this browser.
        </p>
        <Button
          className="mt-4 btn-glow"
          onClick={() => {
            setRequestedNetworkId(config.networkId as never);
            void connect();
          }}
        >
          Connect wallet
        </Button>
      </div>
    );
  }
  if (networkId !== config.networkId) {
    return <p className="glass rounded-2xl p-6 text-center text-sm text-amber-200">Switch your wallet to {config.networkId} to continue.</p>;
  }
  if (locked) return <PassphraseCard />;
  if (error) return <p className="glass rounded-2xl p-6 text-center text-sm text-rose-300">{error}</p>;
  if (!isReady) {
    return (
      <p className="glass flex items-center justify-center gap-2 rounded-2xl p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Preparing your vault…
      </p>
    );
  }
  return <>{children}</>;
}

export function Guide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status, networkId } = useWallet();
  const dust = useDustBalance();
  const balances = useWalletBalances();
  const night = balances?.unshielded?.["00".repeat(32)] ?? 0n;
  const hasWallet = typeof window !== "undefined" && !!window.midnight && Object.keys(window.midnight).length > 0;
  const steps: { done: boolean; title: string; body: ReactNode }[] = [
    {
      done: hasWallet,
      title: "Install Lace with Midnight",
      body: (
        <>
          Get the Lace browser extension and enable Midnight.{" "}
          <a className="sec-text hover:underline" href="https://www.lace.io" target="_blank" rel="noreferrer">
            lace.io <ExternalLink className="inline size-3" />
          </a>
        </>
      ),
    },
    {
      done: status === "connected" && networkId === config.networkId,
      title: `Switch Lace to ${config.networkId} and connect`,
      body: "Use the Connect wallet button in the top bar and approve Lootseal in Lace.",
    },
    {
      done: night > 0n,
      title: "Get test NIGHT",
      body: (
        <>
          Paste your unshielded address into the faucet.{" "}
          <a className="sec-text hover:underline" href={config.faucetUrl} target="_blank" rel="noreferrer">
            Open faucet <ExternalLink className="inline size-3" />
          </a>
        </>
      ),
    },
    {
      done: (dust?.balance ?? 0n) > 0n,
      title: "Let DUST accrue",
      body: "Fees are paid in DUST, which your NIGHT generates. In Lace, designate your NIGHT for DUST, then wait a few minutes.",
    },
  ];
  return (
    <Modal open={open} onClose={onClose} title="Get set up in four steps">
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                s.done ? "bg-emerald-500/20 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.4)]" : "bg-[color-mix(in_oklab,var(--sec-a)_14%,transparent)] sec-text",
              )}
            >
              {s.done ? <Check className="size-4" /> : i + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-xs text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="relative mb-8 flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        <h1 className="text-gradient text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
      <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden bg-white/5">
        <div className="h-px w-1/3 animate-[beam_5s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-[var(--sec-a)] to-transparent" />
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center rounded-2xl px-6 py-14 text-center">
      <div className="relative mb-4 grid size-16 place-items-center">
        <span className="absolute inset-0 animate-[spin-slow_14s_linear_infinite] rounded-full border border-dashed border-[color-mix(in_oklab,var(--sec-a)_55%,transparent)]" />
        <span className="sec-text animate-[float_4s_ease-in-out_infinite]">{icon}</span>
      </div>
      <p className="font-[family-name:var(--font-display)] font-semibold">{title}</p>
      {children && <div className="mt-2 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin sec-text" /> {label}
    </p>
  );
}
