#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TOOL_DIR, "..");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const isValidDnrUrlFilter = (pattern) => (
  typeof pattern === "string" &&
  pattern.length > 0 &&
  pattern.length <= 2_000 &&
  !/[^\x20-\x7E]/.test(pattern) &&
  !pattern.startsWith("||*")
);

const manifest = readJson(join(ROOT, "manifest.json"));
const primary = readJson(join(ROOT, "rules", "network-primary.json"));
const secondary = readJson(join(ROOT, "rules", "network-secondary.json"));
const metadata = readJson(join(ROOT, "rules", "filter-metadata.json"));
const generic = readJson(join(ROOT, "rules", "cosmetic", "generic.json"));

assert(manifest.manifest_version === 3, "Simpl must remain a Manifest V3 extension.");
assert(Number(manifest.minimum_chrome_version) >= 121, "Chrome 121+ is required for the safe dynamic rule quota.");
assert(primary.length > 0 && primary.length <= 29_000, "Primary network rule count is invalid.");
assert(secondary.length > 0 && secondary.length <= 29_000, "Secondary network rule count is invalid.");
assert(generic.selectors.length > 0, "Generic cosmetic selectors are missing.");
assert(
  !generic.selectors.some((selector) => selector.startsWith("body *:not(a,br,button,canvas")),
  "A site-scoped cosmetic rule was incorrectly promoted to a generic rule."
);

const youtubePassThrough = primary.find((rule) => (
  rule.action?.type === "allow" &&
  rule.priority >= 100 &&
  rule.condition?.urlFilter === "*" &&
  rule.condition?.initiatorDomains?.includes("youtube.com")
));
assert(youtubePassThrough, "YouTube network pass-through rule is missing.");

const ids = new Set();
for (const rule of [...primary, ...secondary]) {
  assert(Number.isInteger(rule.id) && rule.id > 0, `Invalid rule ID: ${rule.id}`);
  assert(!ids.has(rule.id), `Duplicate rule ID: ${rule.id}`);
  ids.add(rule.id);
  assert(["allow", "block"].includes(rule.action?.type), `Unsafe rule action: ${rule.action?.type}`);
  assert(rule.condition && typeof rule.condition === "object", `Rule ${rule.id} has no condition.`);
  assert(isValidDnrUrlFilter(rule.condition.urlFilter), `Rule ${rule.id} has an invalid URL filter.`);
}

const cosmeticFiles = readdirSync(join(ROOT, "rules", "cosmetic"))
  .filter((name) => /^domains-\d{2}\.json$/.test(name));
assert(cosmeticFiles.length === 32, `Expected 32 cosmetic shards, found ${cosmeticFiles.length}.`);
for (const name of cosmeticFiles) {
  const shard = readJson(join(ROOT, "rules", "cosmetic", name));
  assert(shard.version === 1, `${name} has an unsupported format.`);
  assert(shard.rules && shard.exceptions, `${name} is incomplete.`);
}

for (const source of ["easylist", "adguard", "uassets"]) {
  const data = metadata.sources?.[source];
  assert(data?.commit?.length === 40, `${source} commit metadata is missing.`);
  assert(data?.selectedNetworkRules > 0, `${source} contributed no selected network rules.`);
  assert(data?.parsedCosmetic > 0, `${source} contributed no cosmetic selectors.`);
}

const content = readFileSync(join(ROOT, "content.js"), "utf8");
const background = readFileSync(join(ROOT, "background.js"), "utf8");
const options = readFileSync(join(ROOT, "options.js"), "utf8");
const popup = readFileSync(join(ROOT, "popup.html"), "utf8");
const youtubePreview = readFileSync(join(ROOT, "youtube-preview.js"), "utf8");
const youtubeMain = readFileSync(join(ROOT, "youtube-main.js"), "utf8");
assert(background.includes("isYoutubeHostname"), "YouTube cosmetic isolation is missing.");
assert(
  manifest.content_scripts.some((entry) => entry.js?.includes("youtube-preview.js")),
  "The YouTube preview content script is not registered."
);
assert(
  background.includes("simpl_youtube_ad_filters_enabled") &&
  options.includes("simpl_youtube_ad_filters_enabled"),
  "The YouTube-only ad-filter setting is incomplete."
);
assert(!manifest.commands?.["toggle-layout"], "The removed page-arranger command remains registered.");
assert(
  !manifest.content_scripts.some((entry) => (
    entry.js?.includes("layout.js") || entry.css?.includes("layout.css")
  )),
  "Removed page-arranger assets remain registered."
);
for (const removedLabel of ["Arrange Page", "Undo Move", "Reset Layout"]) {
  assert(!popup.includes(removedLabel), `Removed popup action remains: ${removedLabel}`);
}
for (const marker of [
  "simpl_youtube_preview_player_enabled",
  "ytd-video-preview-loader",
  "yt-lockup-view-model",
  "ytd-video-preview\"",
  "window.addEventListener(\"click\", onClick, true)",
  "simpl-youtube-preview-controls",
  "simpl-youtube-preview-speed",
  "simpl-youtube-preview-speed-button",
  "simpl-youtube-toggle-captions"
]) {
  assert(youtubePreview.includes(marker), `YouTube preview marker is missing: ${marker}`);
}
for (const removedControl of [
  "simpl-youtube-preview-quality",
  "simpl-youtube-preview-loop",
  "simpl-youtube-preview-title-text",
  "icon(\"settings\")"
]) {
  assert(!youtubePreview.includes(removedControl), `Removed preview control remains: ${removedControl}`);
}
assert(
  youtubeMain.includes("simpl-youtube-toggle-captions") &&
  youtubeMain.includes("simpl-youtube-captions-state"),
  "The main-world YouTube caption bridge is missing."
);
for (const marker of [
  "YOUTUBE_AD_SPEED",
  "accelerateYoutubeAd",
  "skipYoutubeShortsAd",
  "ytd-ad-slot-renderer",
  "compactYouTubeHomeRows"
]) {
  assert(content.includes(marker), `YouTube feature marker is missing: ${marker}`);
}

console.log(JSON.stringify({
  manifestVersion: manifest.version,
  networkRules: primary.length + secondary.length,
  genericCosmeticSelectors: generic.selectors.length,
  cosmeticShards: cosmeticFiles.length,
  sourceCommits: Object.fromEntries(
    Object.entries(metadata.sources).map(([name, data]) => [name, data.commit.slice(0, 12)])
  )
}, null, 2));
