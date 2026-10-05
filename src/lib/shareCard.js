import { SECTION_TAB, TABS } from "./tabs.js";
// Share cards: a 1080px-wide image (height fits the content) drawn on a canvas, shared through the phone's
// share sheet when available, otherwise downloaded. Drawn directly (not a
// page screenshot) so layout is predictable; only same-origin logos are drawn
// because cross-site images would block exporting the canvas.
const SIZE = 1080;
const MIN_HEIGHT = 600;
const MAX_HEIGHT = 1350;
const COLORS = { page: "#10110f", card: "#171a15", border: "#3b4134", accent: "#b8c69b", ink: "#f7f7f2", muted: "#999c94", faint: "#686b63", alert: "#d96b67" };
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

function loadImage(src) {
  return new Promise(resolve => {
    if (!src || !src.startsWith("/")) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// spec: { kicker, title, teams?: [{ name, score, note, logo, highlight }], lines?: [{ text, size, color, weight }], footer }
export async function renderShareCard(spec) {
  // Content is drawn onto a tall scratch canvas first, then copied onto a
  // card sized to fit it.
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = MAX_HEIGHT;
  const ctx = canvas.getContext("2d");
  const pad = 72;
  const width = SIZE - pad * 2;

  let y = pad + 40;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLORS.accent;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText(String(spec.kicker || "").toUpperCase(), pad + 20, y);
  y += 30;

  if (spec.title) {
    ctx.fillStyle = COLORS.ink;
    ctx.font = `800 70px ${FONT}`;
    for (const line of wrap(ctx, spec.title, width - 40).slice(0, 3)) {
      y += 80;
      ctx.fillText(line, pad + 20, y);
    }
    y += 20;
  }

  for (const team of spec.teams || []) {
    y += 30;
    const logo = await loadImage(team.logo);
    let x = pad + 20;
    if (logo) {
      ctx.drawImage(logo, x, y, 72, 72);
      x += 92;
    }
    ctx.fillStyle = team.highlight ? COLORS.ink : COLORS.muted;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText(wrap(ctx, team.name, 560)[0], x, y + 38);
    if (team.note) {
      ctx.fillStyle = COLORS.faint;
      ctx.font = `700 24px ${FONT}`;
      ctx.fillText(team.note, x, y + 70);
    }
    ctx.fillStyle = team.highlight ? COLORS.accent : COLORS.muted;
    ctx.font = `800 76px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(team.score ?? "", SIZE - pad - 20, y + 62);
    ctx.textAlign = "left";
    y += 100;
  }

  const bottomLimit = MAX_HEIGHT - pad - 80;
  for (const item of spec.lines || []) {
    const size = item.size || 32;
    ctx.fillStyle = COLORS[item.color] || item.color || COLORS.muted;
    ctx.font = `${item.weight || 600} ${size}px ${FONT}`;
    y += item.gap ?? 24;
    for (const line of wrap(ctx, item.text, width - 40)) {
      if (y + size > bottomLimit) {
        ctx.fillText("…", pad + 20, y + size);
        y = bottomLimit;
        break;
      }
      y += size * 1.35;
      ctx.fillText(line, pad + 20, y);
    }
  }

  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, y + 150));
  const card = document.createElement("canvas");
  card.width = SIZE;
  card.height = height;
  const out = card.getContext("2d");
  out.fillStyle = COLORS.page;
  out.fillRect(0, 0, SIZE, height);
  out.fillStyle = COLORS.card;
  out.strokeStyle = COLORS.border;
  out.lineWidth = 3;
  out.beginPath();
  out.roundRect(36, 36, SIZE - 72, height - 72, 40);
  out.fill();
  out.stroke();
  out.drawImage(canvas, 0, 0, SIZE, height - 110, 0, 0, SIZE, height - 110);
  out.fillStyle = COLORS.faint;
  out.font = `700 24px ${FONT}`;
  out.fillText(spec.footer || "On Thursdays We Fantasy · boerkoel.github.io/OnThursdaysWeFantasy.io", pad + 20, height - pad - 10);
  return card;
}

// Shared along with the image: a link to the card's section. /s/<tab>/ is a
// tiny page (made by vite.config.js) whose link preview carries the tab's
// name, and which forwards to /#<section> on the site.
export const sectionLink = section => {
  const tab = !section ? "live" : TABS.some(t => t.id === section) ? section : SECTION_TAB[section] || "live";
  const hash = section && section !== tab ? `#${section}` : "";
  return new URL(`s/${tab}/${hash}`, window.location.origin + import.meta.env.BASE_URL).href;
};

export async function shareCard(spec, filename, section) {
  const canvas = await renderShareCard(spec);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const file = new File([blob], filename + ".png", { type: "image/png" });
  // Text with the image: the card's headline and its context line, then the
  // link (sent as a link where the browser allows, otherwise in the text).
  const link = sectionLink(section);
  const title = [spec.title, spec.kicker].filter(Boolean).join(" · ") || "On Thursdays We Fantasy";
  if (navigator.canShare?.({ files: [file] })) {
    for (const data of [{ files: [file], text: title, url: link }, { files: [file], text: `${title}\n${link}` }, { files: [file] }]) {
      try {
        await navigator.share(data);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return; // closed the share sheet
        // Some browsers refuse a link (or text) alongside files: try less.
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
