// SPDX-License-Identifier: Apache-2.0
// A free, off-chain taste of the box opening for visitors without a wallet.
// The draw uses the Genesis Relics table (1% / 4% / 15% / 30% / 50%) with the
// browser's randomness; nothing touches the chain.
import { useState } from "react";
import { Dices, RotateCcw } from "lucide-react";
import { Modal } from "@/components/modal";
import { BoxOpener } from "@/components/box-opener";
import { absoluteHref, pullPost } from "@/components/share";

const DEMO_ADDRESS = "demo-genesis-relics";

// [name, tier, count] — the same catalog the Genesis Relics deploy launches.
const CATALOG: [string, number, number][] = [
  ["Dragon Sigil", 0, 4],
  ["Phoenix Crown", 0, 6],
  ["Void Lantern", 1, 18],
  ["Starforged Blade", 1, 22],
  ["Moonlit Aegis", 2, 45],
  ["Tidecaller Horn", 2, 55],
  ["Ember Charm", 2, 50],
  ["Frost Rune", 3, 110],
  ["Thorn Bracer", 3, 95],
  ["Storm Feather", 3, 95],
  ["Copper Key", 4, 90],
  ["Oak Totem", 4, 85],
  ["River Pebble", 4, 80],
  ["Ash Token", 4, 85],
  ["Moss Ring", 4, 80],
  ["Clay Idol", 4, 80],
];
const TOTAL = CATALOG.reduce((n, [, , c]) => n + c, 0);
const TOP = ["Top 1%", "Top 5%", "Top 20%", "Top 50%", "Base tier"];

function draw() {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  let ticket = r[0]! % TOTAL;
  for (let i = 0; i < CATALOG.length; i++) {
    const [name, tier, count] = CATALOG[i]!;
    if (ticket < count) return { itemType: i, tier, name, serial: BigInt(1 + Math.floor(Math.random() * count)), of: BigInt(count), top: TOP[tier]! };
    ticket -= count;
  }
  return { itemType: 15, tier: 4, name: "Clay Idol", serial: 1n, of: 80n, top: "Common" };
}

export function DemoBox({ className, label = "Try a demo box" }: { className?: string; label?: string }) {
  const [pull, setPull] = useState<ReturnType<typeof draw> | null>(null);
  const [round, setRound] = useState(0);
  const open = () => {
    setPull(draw());
    setRound((n) => n + 1);
  };
  return (
    <>
      <button onClick={open} className={className}>
        <Dices className="size-4" /> {label}
      </button>
      <Modal open={pull !== null} onClose={() => setPull(null)} title="Demo box · Genesis Relics" wide>
        {pull && (
          <div>
            <p className="mb-2 text-center text-xs text-muted-foreground">
              Off-chain demo with the real Genesis Relics odds. On Lootseal the same draw is proven in zero knowledge.
            </p>
            <BoxOpener
              key={round}
              dropAddress={DEMO_ADDRESS}
              item={pull}
              share={{
                text: pullPost({ name: pull.name, tier: pull.tier, dropTitle: "Genesis Relics", top: pull.top, demo: true }),
                url: absoluteHref("#/"),
                card: {
                  dropAddress: DEMO_ADDRESS,
                  dropTitle: "Genesis Relics · demo box",
                  itemType: pull.itemType,
                  tier: pull.tier,
                  name: pull.name,
                  detail: `#${pull.serial.toString()} of ${pull.of.toString()} · ${pull.top}`,
                  kicker: "Pulled from a Lootseal box",
                },
              }}
            />
            <div className="mt-2 flex justify-center">
              <button onClick={open} className="inline-flex items-center gap-2 text-sm sec-text hover:underline">
                <RotateCcw className="size-4" /> Open another
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
