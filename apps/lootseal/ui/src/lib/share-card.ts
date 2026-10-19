// SPDX-License-Identifier: Apache-2.0
// Renders a 1200×675 share image for a pull or a rarity badge: the item's
// sigil (same procedural art as the app), its tier, the drop and Lootseal's
// guarantees, in the tier's colours. Drawn on a canvas, no server involved.
import { sigilFor, tierStyle } from "@/lib/art";

export interface ShareCard {
  dropAddress: string;
  dropTitle: string;
  itemType: number;
  tier: number;
  /** Item name; omit for a badge that only proves "tier or rarer". */
  name?: string;
  /** e.g. "#94 of 95 · Top 50%" */
  detail: string;
  /** Small line above the title, e.g. "PULLED FROM" or "PROVEN IN ZERO KNOWLEDGE". */
  kicker: string;
  /** Hide the item (badge mode): draws a sealed sigil instead. */
  sealed?: boolean;
}

const W = 1200;
const H = 675;

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load('800 64px "Unbounded"'),
      document.fonts.load('600 28px "Outfit"'),
      document.fonts.load('500 22px "Outfit"'),
    ]);
  } catch {
    // Fall back to system fonts.
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 3);
  ctx.quadraticCurveTo(x, y, x + r * 3, y);
  ctx.quadraticCurveTo(x, y, x, y + r * 3);
  ctx.quadraticCurveTo(x, y, x - r * 3, y);
  ctx.quadraticCurveTo(x, y, x, y - r * 3);
  ctx.fill();
  ctx.restore();
}

/** Draws the item sigil (the same geometry as <ItemArt>) into a square. */
function drawSigil(ctx: CanvasRenderingContext2D, card: ShareCard, x: number, y: number, size: number) {
  const style = tierStyle(card.tier);
  const sigil = sigilFor(card.dropAddress, card.itemType, card.tier);
  const s = size / 100;
  const color = card.sealed ? "#9aa0c0" : style.color;
  ctx.save();
  ctx.translate(x, y);

  const bg = ctx.createRadialGradient(50 * s, 45 * s, 0, 50 * s, 45 * s, 65 * s);
  bg.addColorStop(0, card.sealed ? "#1e2033" : style.from);
  bg.addColorStop(1, card.sealed ? "#0a0b12" : style.to);
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = 60;
  roundRect(ctx, 0, 0, size, size, 14 * s);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `${style.color}66`;
  ctx.lineWidth = 2;
  ctx.stroke();

  for (let i = 0; i < sigil.rings; i++) {
    ctx.beginPath();
    ctx.arc(50 * s, 50 * s, (42 - i * 4) * s, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.12 + i * 0.05;
    ctx.lineWidth = 0.6 * s;
    ctx.setLineDash(i % 2 ? [2 * s, 3 * s] : []);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(50 * s, 50 * s);
  ctx.rotate((sigil.rotation * Math.PI) / 180);
  ctx.translate(-50 * s, -50 * s);
  if (card.sealed) {
    ctx.restore();
    ctx.fillStyle = color;
    ctx.font = `700 ${30 * s}px Unbounded, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 50 * s, 52 * s);
  } else {
    const gem = ctx.createLinearGradient(20 * s, 20 * s, 80 * s, 80 * s);
    gem.addColorStop(0, "rgba(255,255,255,0.9)");
    gem.addColorStop(0.35, color);
    gem.addColorStop(1, `${color}59`);
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    sigil.gem.forEach(([gx, gy], i) => (i ? ctx.lineTo(gx * s, gy * s) : ctx.moveTo(gx * s, gy * s)));
    ctx.closePath();
    ctx.fillStyle = gem;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8 * s;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 0.4 * s;
    for (const [fx, fy] of sigil.facets) {
      ctx.beginPath();
      ctx.moveTo(50 * s, 50 * s);
      ctx.lineTo(fx * s, fy * s);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(50 * s, 50 * s, 4 * s, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    for (const r of sigil.runes) {
      ctx.beginPath();
      ctx.arc(r.x * s, r.y * s, r.r * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, weight: string, family: string) {
  let size = start;
  do {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 24);
  return size;
}

export async function renderShareCard(card: ShareCard): Promise<Blob> {
  await fontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const style = tierStyle(card.tier);

  // Background: midnight base, tier-coloured aurora, brand glow, vignette.
  ctx.fillStyle = "#06051a";
  ctx.fillRect(0, 0, W, H);
  const glowA = ctx.createRadialGradient(900, 300, 0, 900, 300, 520);
  glowA.addColorStop(0, `${style.color}55`);
  glowA.addColorStop(1, "transparent");
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, W, H);
  const glowB = ctx.createRadialGradient(120, 620, 0, 120, 620, 520);
  glowB.addColorStop(0, "rgba(167,139,250,0.35)");
  glowB.addColorStop(1, "transparent");
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, W, H);

  // Seal rings behind the item.
  ctx.save();
  ctx.translate(900, 337);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 250 + i * 46, 0, Math.PI * 2);
    ctx.strokeStyle = style.color;
    ctx.globalAlpha = 0.18 - i * 0.05;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(i === 1 ? [6, 10] : []);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (let i = 0; i < 48; i++) {
    ctx.rotate((Math.PI * 2) / 48);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = style.color;
    ctx.fillRect(-1, -296, 2, i % 4 === 0 ? 14 : 7);
  }
  ctx.restore();

  // Deterministic sparkles.
  let seed = card.itemType * 9301 + card.tier * 49297 + 1;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 36; i++) {
    sparkle(ctx, rnd() * W, rnd() * H, 0.8 + rnd() * 2.4, i % 3 ? style.color : "#f6c453", 0.25 + rnd() * 0.6);
  }

  drawSigil(ctx, card, 720, 157, 360);

  // Frame.
  roundRect(ctx, 18, 18, W - 36, H - 36, 28);
  ctx.strokeStyle = `${style.color}55`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Brand.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#f1efff";
  ctx.font = '800 30px Unbounded, "Outfit", sans-serif';
  ctx.fillText("Loot", 72, 96);
  const lootW = ctx.measureText("Loot").width;
  const brand = ctx.createLinearGradient(72 + lootW, 0, 72 + lootW + 90, 0);
  brand.addColorStop(0, "#a78bfa");
  brand.addColorStop(1, "#f6c453");
  ctx.fillStyle = brand;
  ctx.fillText("seal", 72 + lootW, 96);

  // Tier pill.
  ctx.font = '700 22px "Outfit", sans-serif';
  const pill = `✦ ${style.name.toUpperCase()}`;
  const pw = ctx.measureText(pill).width + 40;
  roundRect(ctx, 72, 168, pw, 44, 22);
  ctx.fillStyle = `${style.color}22`;
  ctx.fill();
  ctx.strokeStyle = `${style.color}99`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = style.color;
  ctx.fillText(pill, 92, 198);

  // Kicker + title + detail.
  ctx.fillStyle = "#aaa6cc";
  ctx.font = '600 20px "Outfit", sans-serif';
  ctx.fillText(card.kicker.toUpperCase(), 72, 262);
  const title = card.name ?? `${style.name}${card.tier === 0 ? "" : " or rarer"}`;
  const size = fitText(ctx, title, 580, 64, "800", 'Unbounded, "Outfit", sans-serif');
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = 30;
  ctx.fillStyle = style.color;
  ctx.fillText(title, 72, 262 + size + 14);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#f1efff";
  ctx.font = '600 28px "Outfit", sans-serif';
  ctx.fillText(card.dropTitle, 72, 262 + size + 66);
  ctx.fillStyle = "#aaa6cc";
  ctx.font = '500 22px "Outfit", sans-serif';
  ctx.fillText(card.detail, 72, 262 + size + 104);

  // Guarantees.
  const checks = ["Odds proven in zero knowledge", "Draw nobody can rig", "Delivered sealed to its owner"];
  ctx.font = '500 20px "Outfit", sans-serif';
  checks.forEach((c, i) => {
    const y = 530 + i * 34;
    ctx.fillStyle = "#34d399";
    ctx.fillText("✓", 72, y);
    ctx.fillStyle = "#d9d6f5";
    ctx.fillText(c, 100, y);
  });

  ctx.textAlign = "right";
  ctx.fillStyle = "#8f8bb3";
  ctx.font = '500 18px "Outfit", sans-serif';
  ctx.fillText("Built on Midnight", W - 72, H - 56);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render the card"))), "image/png"));
}
