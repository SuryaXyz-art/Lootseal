// SPDX-License-Identifier: Apache-2.0
// Share a pull or a rarity badge: a rendered image card, a decorated post for
// X, native sharing with the image attached where the device supports it, and
// a plain link copy.
import { useEffect, useState } from "react";
import { Check, Download, Link2, Loader2, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { tierStyle } from "@/lib/art";
import { renderShareCard, type ShareCard } from "@/lib/share-card";

/** An absolute link to a hash route of this app (for sharing outside it). */
export function absoluteHref(hash: string): string {
  if (typeof window === "undefined") return hash;
  return `${window.location.origin}${window.location.pathname}${hash}`;
}

const TIER_EMOJI = ["🐉", "💜", "💎", "🍀", "🪨"];

/** The post for a box pull, louder the rarer it is. */
export function pullPost({ name, tier, dropTitle, top, demo = false }: { name: string; tier: number; dropTitle: string; top: string; demo?: boolean }) {
  const t = tierStyle(tier);
  const headline =
    tier === 0
      ? `🚨 LEGENDARY PULL 🚨\n\n${TIER_EMOJI[0]} ${name} ✨`
      : tier === 1
        ? `${TIER_EMOJI[1]} Epic pull: ${name} ✨`
        : `${TIER_EMOJI[tier] ?? "🎁"} Pulled ${name} (${t.name})`;
  return [
    headline,
    `📦 ${dropTitle}${demo ? " · demo box" : ""} · ${top}`,
    "",
    "🎲 Odds proven in zero knowledge",
    "🔒 A draw nobody can rig",
    "🫣 Remaining supply hidden, nothing to snipe",
    "",
    `${demo ? "Open one yourself 👇" : "Your turn 👇"}`,
    "#Lootseal #Midnight #ZK",
  ].join("\n");
}

/** The post for a rarity badge. */
export function badgePost({ tier, dropTitle }: { tier: number; dropTitle: string }) {
  const t = tierStyle(tier);
  const claim = tier === 0 ? "Legendary" : tier === 4 ? "a genuine item" : `${t.name} or rarer`;
  return [
    `🛡️ My ${dropTitle} item is ${claim}, proven in zero knowledge.`,
    "",
    "Which item exactly? That stays private 🤫",
    "✅ Verify the proof yourself, no wallet needed 👇",
    "",
    "#Lootseal #Midnight #ZK",
  ].join("\n");
}

/** Touch-first devices get the native share sheet (it hands the image to the X app). */
const isTouchDevice = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

export function xIntent(text: string, url: string) {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export function ShareButtons({ text, url, card, className }: { text: string; url: string; card?: ShareCard; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [image, setImage] = useState<{ blob: Blob; src: string } | null>(null);
  const intent = xIntent(text, url);

  useEffect(() => {
    if (!card) return;
    let alive = true;
    let src = "";
    renderShareCard(card)
      .then((blob) => {
        if (!alive) return;
        src = URL.createObjectURL(blob);
        setImage({ blob, src });
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (src) URL.revokeObjectURL(src);
    };
    // The card is fully described by these fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.dropAddress, card?.itemType, card?.tier, card?.name, card?.detail]);

  const file = image ? new File([image.blob], "lootseal-pull.png", { type: "image/png" }) : null;
  const nativeShare = !!file && isTouchDevice() && !!navigator.canShare?.({ files: [file] });

  // The X link opens in a new tab on its own (a real <a>, never blocked as a
  // popup). On desktop the card is put on the clipboard at the same moment, so
  // Ctrl+V in the X composer attaches it.
  const onPostX = () => {
    if (!image || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return;
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": image.blob })])
      .then(() => setNote("Image copied: press Ctrl+V (⌘V on Mac) in your X post to attach it."))
      .catch(() => setNote("Tip: save the image and attach it to your post."));
  };

  const shareNative = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], text: `${text}
${url}` });
    } catch {
      // Cancelled.
    }
  };

  const save = () => {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image.src;
    a.download = `lootseal-${(card?.name ?? "badge").toLowerCase().replace(/\s+/g, "-")}.png`;
    a.click();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {card && (
        <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-white/10 shadow-[0_18px_50px_-20px_var(--sec-a)]">
          {image ? (
            <img src={image.src} alt="Share card preview" className="block h-auto w-full animate-[fade-up_0.5s_ease-out]" />
          ) : (
            <div className="grid aspect-[16/9] place-items-center bg-white/[0.03] text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href={intent}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onPostX}
          className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black shadow-[0_8px_24px_-8px_rgba(255,255,255,0.45)] transition-transform hover:-translate-y-0.5"
        >
          <XLogo className="size-4" /> Post on X
        </a>
        {nativeShare && (
          <button onClick={shareNative} className="btn-glow inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold">
            <Share2 className="size-4" /> Share image
          </button>
        )}
        {card && (
          <button onClick={save} disabled={!image} className="btn-ghost-glow inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            <Download className="size-4" /> Save image
          </button>
        )}
        <button onClick={copy} className="btn-ghost-glow inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold">
          {copied ? <Check className="size-4 text-emerald-300" /> : <Link2 className="size-4" />} {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      {card && (
        <p className="text-center text-[11px] text-muted-foreground" aria-live="polite">
          {note ?? (nativeShare ? "Share image sends the card straight to the X app." : "Post on X also copies the image, so you can paste it into your post.")}
        </p>
      )}
    </div>
  );
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
