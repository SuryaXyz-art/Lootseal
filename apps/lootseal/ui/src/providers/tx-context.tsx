// SPDX-License-Identifier: Apache-2.0
// Runs wallet transactions with visible progress and readable errors.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { config } from "@/config";

export type ToastKind = "pending" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
  txId?: string;
}

interface TxContextValue {
  toasts: Toast[];
  /**
   * Runs `fn` (one or more wallet transactions) under a toast. Resolves to
   * the result, or null on failure (the toast shows why).
   */
  run: <T>(title: string, fn: () => Promise<T>, success?: (result: T) => string) => Promise<T | null>;
  /** Shows a short informational toast. */
  notify: (kind: ToastKind, title: string, detail?: string) => void;
  dismiss: (id: number) => void;
  busy: boolean;
}

const TxContext = createContext<TxContextValue | null>(null);

/** Turns SDK and assert failures into something a player understands. */
export function friendlyError(err: unknown): string {
  const raw = errorMessage(err, "Something went wrong");
  const assert = /failed assert: (.+)$/i.exec(raw);
  if (assert?.[1]) return assert[1];
  if (/reject|denied|cancel/i.test(raw)) return "You declined the request in your wallet.";
  if (/insufficient|not enough/i.test(raw) && /dust/i.test(raw)) {
    return "Your wallet has no DUST for fees yet. DUST accrues from NIGHT you hold — wait a few minutes after funding.";
  }
  if (/insufficient|not enough|balance/i.test(raw)) return "Your wallet doesn't hold enough NIGHT for this.";
  if (/passphrase/i.test(raw)) return raw;
  if (/fetch|network|websocket|ECONN/i.test(raw)) return "The Midnight network couldn't be reached. Check your connection and try again.";
  return raw;
}

export function TxProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState(0);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    return id;
  }, []);

  const update = useCallback((id: number, patch: Partial<Toast>) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      const id = push({ kind, title, detail });
      if (kind !== "pending") window.setTimeout(() => dismiss(id), 6000);
    },
    [push, dismiss],
  );

  const run = useCallback(
    async <T,>(title: string, fn: () => Promise<T>, success?: (result: T) => string): Promise<T | null> => {
      const id = push({ kind: "pending", title, detail: "Approve in your wallet, then the proof is generated…" });
      setPending((n) => n + 1);
      try {
        const result = await fn();
        const txId = (result as { txId?: string } | null)?.txId;
        update(id, { kind: "success", detail: success ? success(result) : "Confirmed on chain.", txId });
        window.setTimeout(() => dismiss(id), 8000);
        return result;
      } catch (err: unknown) {
        update(id, { kind: "error", detail: friendlyError(err) });
        return null;
      } finally {
        setPending((n) => n - 1);
      }
    },
    [push, update, dismiss],
  );

  const value = useMemo(() => ({ toasts, run, notify, dismiss, busy: pending > 0 }), [toasts, run, notify, dismiss, pending]);
  return <TxContext.Provider value={value}>{children}</TxContext.Provider>;
}

export function useTx(): TxContextValue {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error("useTx must be used within a TxProvider");
  return ctx;
}

export function Toaster() {
  const { toasts, dismiss } = useTx();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl p-3 shadow-2xl animate-[toast-in_200ms_ease-out]"
        >
          <span className="mt-0.5">
            {t.kind === "pending" && <Loader2 className="size-5 animate-spin sec-text" />}
            {t.kind === "success" && <CheckCircle2 className="size-5 text-emerald-400" />}
            {t.kind === "error" && <XCircle className="size-5 text-rose-400" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t.title}</p>
            {t.detail && <p className="mt-0.5 text-xs text-muted-foreground break-words">{t.detail}</p>}
            {t.txId && config.explorerTxUrl && (
              <a
                className="mt-1 inline-block text-xs sec-text underline-offset-2 hover:underline"
                href={config.explorerTxUrl.replace("{tx}", t.txId)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction
              </a>
            )}
          </div>
          {t.kind !== "pending" && (
            <button className="text-muted-foreground hover:text-foreground" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
