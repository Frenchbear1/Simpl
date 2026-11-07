#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(TOOL_DIR, "..");
const RULES_DIR = join(EXTENSION_ROOT, "rules");
const COSMETIC_DIR = join(RULES_DIR, "cosmetic");
const LICENSES_DIR = join(EXTENSION_ROOT, "licenses");

const PRIMARY_RULE_LIMIT = 29_000;
const SECONDARY_RULE_LIMIT = 29_000;
const COSMETIC_SHARD_COUNT = 32;
const DYNAMIC_RULE_ID_START = 100_001;
const YOUTUBE_NETWORK_PASS_THROUGH_RULE = {
  priority: 100,
  action: { type: "allow" },
  condition: {
    urlFilter: "*",
    initiatorDomains: ["youtube.com"]
  }
};

const REPOSITORIES = {
  easylist: {
    label: "EasyList",
    url: "https://github.com/easylist/easylist.git"
  },
  adguard: {
    label: "AdGuard Filters",
    url: "https://github.com/AdguardTeam/AdguardFilters.git"
  },
  uassets: {
    label: "uBlock Origin uAssets",
    url: "https://github.com/uBlockOrigin/uAssets.git"
  }
};

const CAPABILITIES = {
  adguard: false,
  cap_html_filtering: false,
  cap_ipaddress: false,
  cap_responseheader: false,
  env_chromium: true,
  env_firefox: false,
  env_mobile: false,
  env_mv3: true,
  env_safari: false,
  ext_abp: false,
  ext_ubol: true
};

const RESOURCE_TYPE_ALIASES = new Map([
  ["css", "stylesheet"],
  ["doc", "main_frame"],
  ["document", "main_frame"],
  ["font", "font"],
  ["frame", "sub_frame"],
  ["image", "image"],
  ["media", "media"],
  ["object", "object"],
  ["object-subrequest", "object"],
  ["other", "other"],
  ["ping", "ping"],
  ["script", "script"],
  ["stylesheet", "stylesheet"],
  ["subdocument", "sub_frame"],
  ["websocket", "websocket"],
  ["xhr", "xmlhttprequest"],
  ["xmlhttprequest", "xmlhttprequest"]
]);

const UNSUPPORTED_NETWORK_OPTIONS = new Set([
  "badfilter",
  "cname",
  "cookie",
  "csp",
  "denyallow",
  "ehide",
  "elemhide",
  "empty",
  "generichide",
  "genericblock",
  "ghide",
  "header",
  "ipaddress",
  "jsonprune",
  "method",
  "mp4",
  "permissions",
  "popunder",
  "popup",
  "queryprune",
  "redirect",
  "redirect-rule",
  "removeparam",
  "replace",
  "responseheader",
  "shide",
  "sitekey",
  "specifichide",
  "to",
  "urlskip",
  "urltransform",
  "webrtc"
]);

const parseArgs = () => {
  const args = process.argv.slice(2);
  let sourceRoot = "";

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--source-root") {
      sourceRoot = resolve(args[index + 1] || "");
      index += 1;
      continue;
    }

    if (args[index] === "--help") {
      console.log("Usage: node tools/build-filter-lists.mjs [--source-root <folder>]");
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${args[index]}`);
  }

  return { sourceRoot };
};

const cloneRepositories = (root) => {
  for (const [name, repository] of Object.entries(REPOSITORIES)) {
    const destination = join(root, name);
    execFileSync("git", ["clone", "--depth", "1", repository.url, destination], {
      stdio: "inherit"
    });
  }
};

const getCommit = (repositoryPath) =>
  execFileSync("git", ["-C", repositoryPath, "rev-parse", "HEAD"], {
    encoding: "utf8"
  }).trim();

const readText = (path) => readFileSync(path, "utf8").replace(/^\uFEFF/, "");

const listTextFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));

const filesFromTemplate = (repositoryPath, templatePath, repositoryToken) => {
  const template = readText(join(repositoryPath, templatePath));
  const expression = new RegExp(`^%include\\s+${repositoryToken}:([^%]+)%`, "gmi");
  return Array.from(template.matchAll(expression), (match) =>
    join(repositoryPath, match[1].trim().replaceAll("/", "\\"))
  ).filter((path) => existsSync(path));
};

const getSourceFiles = (sourcePaths) => ({
  easylist: filesFromTemplate(sourcePaths.easylist, "easylist.template", "easylist"),
  adguard: listTextFiles(join(sourcePaths.adguard, "BaseFilter", "sections")),
  uassets: [
    ...filesFromTemplate(sourcePaths.uassets, join("templates", "ublock-filters.template"), "uAssets"),
    join(sourcePaths.uassets, "filters", "quick-fixes.txt"),
    join(sourcePaths.uassets, "filters", "unbreak.txt")
  ].filter((path, index, files) => existsSync(path) && files.indexOf(path) === index)
});

const evaluateCondition = (expression) => {
  const normalized = expression
    .replace(/[()]/g, " ")
    .trim();

  if (!normalized) {
    return false;
  }

  return normalized.split(/\s*\|\|\s*/).some((orClause) =>
    orClause.split(/\s*&&\s*/).every((rawToken) => {
      const token = rawToken.trim();
      const negated = token.startsWith("!");
      const name = token.replace(/^!+/, "");
      const value = CAPABILITIES[name] === true;
      return negated ? !value : value;
    })
  );
};

const activeLines = (text) => {
  const output = [];
  const stack = [];
  let active = true;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const ifMatch = line.match(/^!#if\s+(.+)$/i);
    if (ifMatch) {
      const condition = evaluateCondition(ifMatch[1]);
      stack.push({ parentActive: active, condition });
      active = active && condition;
      continue;
    }

    if (/^!#else\b/i.test(line)) {
      const frame = stack.at(-1);
      if (frame) {
        active = frame.parentActive && !frame.condition;
      }
      continue;
    }

    if (/^!#endif\b/i.test(line)) {
      const frame = stack.pop();
      active = frame ? frame.parentActive : true;
      continue;
    }

    if (active) {
      output.push(rawLine);
    }
  }

  return output;
};

const normalizeDomain = (value) => {
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");

  if (
    !domain ||
    domain.includes("*") ||
    domain.includes("/") ||
    domain.includes(":") ||
    !/^[a-z0-9_][a-z0-9._-]*[a-z0-9_]$|^[a-z0-9_]$/i.test(domain)
  ) {
    return "";
  }

  return domain;
};

const isValidDnrUrlFilter = (pattern) => (
  typeof pattern === "string" &&
  pattern.length > 0 &&
  pattern.length <= 2_000 &&
  !/[^\x20-\x7E]/.test(pattern) &&
  !pattern.startsWith("||*")
);

const splitDomains = (value) => {
  const included = [];
  const excluded = [];
  let valid = true;

  for (const rawDomain of value.split("|")) {
    const isExcluded = rawDomain.startsWith("~");
    const domain = normalizeDomain(rawDomain.replace(/^~/, ""));
    if (!domain) {
      valid = false;
      continue;
    }
    (isExcluded ? excluded : included).push(domain);
  }

  return {
    valid,
    included: [...new Set(included)].sort(),
    excluded: [...new Set(excluded)].sort()
  };
};

const findOptionDelimiter = (line) => {
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (character === "$" && !escaped) {
      return index;
    }
    escaped = false;
  }
  return -1;
};

const stableCondition = (condition) => {
  const output = {};
  const keys = [
    "urlFilter",
    "isUrlFilterCaseSensitive",
    "domainType",
    "resourceTypes",
    "excludedResourceTypes",
    "initiatorDomains",
    "excludedInitiatorDomains",
    "requestDomains",
    "excludedRequestDomains"
  ];
  for (const key of keys) {
    if (condition[key] !== undefined) {
      output[key] = condition[key];
    }
  }
  return output;
};

const parseNetworkRule = (rawLine) => {
  let line = rawLine.trim();
  if (
    !line ||
    line.startsWith("!") ||
    line.startsWith("[") ||
    line.includes("##") ||
    line.includes("#@#") ||
    line.includes("#?#") ||
    line.includes("#$#") ||
    line.includes("#%#") ||
    line.includes("#^#")
  ) {
    return null;
  }

  const isException = line.startsWith("@@");
  if (isException) {
    line = line.slice(2);
  }

  const optionDelimiter = findOptionDelimiter(line);
  const pattern = (optionDelimiter >= 0 ? line.slice(0, optionDelimiter) : line).trim();
  const optionText = optionDelimiter >= 0 ? line.slice(optionDelimiter + 1) : "";

  if (
    !isValidDnrUrlFilter(pattern) ||
    (pattern.startsWith("/") && pattern.endsWith("/"))
  ) {
    return null;
  }

  const condition = { urlFilter: pattern };
  const resourceTypes = new Set();
  const excludedResourceTypes = new Set();
  let priority = isException ? 2 : 1;

  for (const rawOption of optionText.split(",")) {
    if (!rawOption) {
      continue;
    }

    const excluded = rawOption.startsWith("~");
    const option = rawOption.replace(/^~/, "");
    const separator = option.indexOf("=");
    const name = (separator >= 0 ? option.slice(0, separator) : option).toLowerCase();
    const value = separator >= 0 ? option.slice(separator + 1) : "";

    if (RESOURCE_TYPE_ALIASES.has(name)) {
      (excluded ? excludedResourceTypes : resourceTypes).add(RESOURCE_TYPE_ALIASES.get(name));
      continue;
    }

    if (["1p", "first-party", "strict1p"].includes(name)) {
      if (excluded) {
        condition.domainType = "thirdParty";
      } else {
        condition.domainType = "firstParty";
      }
      continue;
    }

    if (["3p", "third-party", "strict3p"].includes(name)) {
      if (excluded) {
        condition.domainType = "firstParty";
      } else {
        condition.domainType = "thirdParty";
      }
      continue;
    }

    if (name === "domain" || name === "from") {
      const domains = splitDomains(value);
      if (!domains.valid) {
        return null;
      }
      if (domains.included.length) {
        condition.initiatorDomains = domains.included;
      }
      if (domains.excluded.length) {
        condition.excludedInitiatorDomains = domains.excluded;
      }
      continue;
    }

    if (name === "match-case") {
      condition.isUrlFilterCaseSensitive = !excluded;
      continue;
    }

    if (name === "important") {
      priority = isException ? 4 : 3;
      continue;
    }

    if (["all", "network"].includes(name)) {
      continue;
    }

    if (UNSUPPORTED_NETWORK_OPTIONS.has(name) || separator >= 0 || name) {
      return null;
    }
  }

  if (resourceTypes.size) {
    condition.resourceTypes = [...resourceTypes].sort();
  }
  if (excludedResourceTypes.size) {
    condition.excludedResourceTypes = [...excludedResourceTypes].sort();
  }

  return {
    priority,
    action: { type: isException ? "allow" : "block" },
    condition: stableCondition(condition)
  };
};

const cosmeticParts = (rawLine) => {
  const line = rawLine.trim();
  if (!line || line.startsWith("!") || line.startsWith("[")) {
    return null;
  }

  const exceptionIndex = line.indexOf("#@#");
  const standardIndex = line.indexOf("##");
  const isException = exceptionIndex >= 0;
  const separatorIndex = isException ? exceptionIndex : standardIndex;
  const separatorLength = isException ? 3 : 2;

  if (separatorIndex < 0) {
    return null;
  }

  const domainsText = line.slice(0, separatorIndex).trim();
  const selector = line.slice(separatorIndex + separatorLength).trim();
  if (
    !selector ||
    selector.length > 2_000 ||
    selector.startsWith("+") ||
    selector.startsWith("^") ||
    /[{}\r\n]/.test(selector) ||
    /(?:^|:)(?:-abp-|contains\(|has-text\(|matches-(?:attr|css|path)\(|min-text-length\(|others\(|remove(?:-attr|-class)?\(|style\(|upward\(|watch-attr\(|xpath\()/i.test(selector) ||
    /\[-(?:abp|ext)-/i.test(selector)
  ) {
    return null;
  }

  const included = [];
  const excluded = [];
  let domainsValid = true;
  for (const rawDomain of domainsText.split(",")) {
    if (!rawDomain) {
      continue;
    }
    const isExcludedDomain = rawDomain.startsWith("~");
    const domain = normalizeDomain(rawDomain.replace(/^~/, ""));
    if (!domain) {
      domainsValid = false;
      continue;
    }
    (isExcludedDomain ? excluded : included).push(domain);
  }

  if (!domainsValid) {
    return null;
  }

  return {
    isException,
    selector,
    included: [...new Set(included)],
    excluded: [...new Set(excluded)]
  };
};

const addToDomainMap = (map, domain, selector) => {
  if (!map.has(domain)) {
    map.set(domain, new Set());
  }
  map.get(domain).add(selector);
};

const scoreNetworkEntry = (entry) => {
  const { rule, sources } = entry;
  let score = sources.size * 1_000;
  if (rule.action.type === "allow") {
    score += 240;
  }
  if (/^\|\|[a-z0-9.-]+\^?$/i.test(rule.condition.urlFilter || "")) {
    score += 180;
  }
  if (rule.condition.initiatorDomains?.length) {
    score += 120;
  }
  if (sources.has("uassets")) {
    score += 90;
  }
  if (sources.has("easylist")) {
    score += 70;
  }
  if (sources.has("adguard")) {
    score += 60;
  }
  score -= Math.min((rule.condition.urlFilter || "").length / 20, 80);
  return score;
};

const shardForDomain = (domain) => {
  let hash = 2166136261;
  for (let index = 0; index < domain.length; index += 1) {
    hash ^= domain.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % COSMETIC_SHARD_COUNT;
};

const sortedObjectFromMap = (map) =>
  Object.fromEntries(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([domain, selectors]) => [domain, [...selectors].sort()])
  );

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
};

const main = () => {
  const { sourceRoot } = parseArgs();
  const ownsSourceRoot = !sourceRoot;
  const workingRoot = sourceRoot || mkdtempSync(join(tmpdir(), "simpl-filter-sources-"));

  try {
    if (ownsSourceRoot) {
      cloneRepositories(workingRoot);
    }

    const sourcePaths = Object.fromEntries(
      Object.keys(REPOSITORIES).map((name) => [name, join(workingRoot, name)])
    );
    for (const [name, path] of Object.entries(sourcePaths)) {
      if (!existsSync(path)) {
        throw new Error(`Missing ${name} source repository at ${path}`);
      }
    }

    const sourceFiles = getSourceFiles(sourcePaths);
    const networkEntries = new Map();
    const genericSelectors = new Set();
    const globalCosmeticExceptions = new Set();
    const domainSelectors = new Map();
    const domainExceptions = new Map();
    const stats = Object.fromEntries(
      Object.keys(REPOSITORIES).map((name) => [name, {
        files: sourceFiles[name].length,
        inputLines: 0,
        parsedNetwork: 0,
        parsedCosmetic: 0
      }])
    );

    for (const [source, files] of Object.entries(sourceFiles)) {
      for (const path of files) {
        for (const rawLine of activeLines(readText(path))) {
          stats[source].inputLines += 1;

          const cosmetic = cosmeticParts(rawLine);
          if (cosmetic) {
            stats[source].parsedCosmetic += 1;
            if (cosmetic.isException) {
              if (!cosmetic.included.length) {
                globalCosmeticExceptions.add(cosmetic.selector);
              } else {
                for (const domain of cosmetic.included) {
                  addToDomainMap(domainExceptions, domain, cosmetic.selector);
                }
              }
              continue;
            }

            if (!cosmetic.included.length) {
              genericSelectors.add(cosmetic.selector);
            } else {
              for (const domain of cosmetic.included) {
                addToDomainMap(domainSelectors, domain, cosmetic.selector);
              }
            }
            for (const domain of cosmetic.excluded) {
              addToDomainMap(domainExceptions, domain, cosmetic.selector);
            }
            continue;
          }

          const rule = parseNetworkRule(rawLine);
          if (!rule) {
            continue;
          }

          stats[source].parsedNetwork += 1;
          const key = JSON.stringify(rule);
          if (!networkEntries.has(key)) {
            networkEntries.set(key, { key, rule, sources: new Set() });
          }
          networkEntries.get(key).sources.add(source);
        }
      }
    }

    for (const selector of globalCosmeticExceptions) {
      genericSelectors.delete(selector);
      for (const selectors of domainSelectors.values()) {
        selectors.delete(selector);
      }
    }

    const candidates = [...networkEntries.values()].sort((left, right) => {
      const scoreDifference = scoreNetworkEntry(right) - scoreNetworkEntry(left);
      return scoreDifference || left.key.localeCompare(right.key);
    });
    const selected = candidates.slice(
      0,
      PRIMARY_RULE_LIMIT + SECONDARY_RULE_LIMIT - 1
    );
    const primary = [
      {
        id: 1,
        ...YOUTUBE_NETWORK_PASS_THROUGH_RULE
      },
      ...selected.slice(0, PRIMARY_RULE_LIMIT - 1).map((entry, index) => ({
        id: index + 2,
        ...entry.rule
      }))
    ];
    const secondary = selected.slice(PRIMARY_RULE_LIMIT - 1).map((entry, index) => ({
      id: DYNAMIC_RULE_ID_START + index,
      ...entry.rule
    }));

    mkdirSync(RULES_DIR, { recursive: true });
    rmSync(COSMETIC_DIR, { recursive: true, force: true });
    mkdirSync(COSMETIC_DIR, { recursive: true });
    mkdirSync(LICENSES_DIR, { recursive: true });

    writeJson(join(RULES_DIR, "network-primary.json"), primary);
    writeJson(join(RULES_DIR, "network-secondary.json"), secondary);
    writeJson(join(COSMETIC_DIR, "generic.json"), {
      version: 1,
      selectors: [...genericSelectors].sort()
    });

    const shards = Array.from({ length: COSMETIC_SHARD_COUNT }, () => ({
      rules: new Map(),
      exceptions: new Map()
    }));
    for (const [domain, selectors] of domainSelectors) {
      shards[shardForDomain(domain)].rules.set(domain, selectors);
    }
    for (const [domain, selectors] of domainExceptions) {
      shards[shardForDomain(domain)].exceptions.set(domain, selectors);
    }
    shards.forEach((shard, index) => {
      writeJson(join(COSMETIC_DIR, `domains-${String(index).padStart(2, "0")}.json`), {
        version: 1,
        rules: sortedObjectFromMap(shard.rules),
        exceptions: sortedObjectFromMap(shard.exceptions)
      });
    });

    const selectedBySource = Object.fromEntries(
      Object.keys(REPOSITORIES).map((source) => [
        source,
        selected.filter((entry) => entry.sources.has(source)).length
      ])
    );
    const metadata = {
      generatedAt: new Date().toISOString(),
      formatVersion: 1,
      limits: {
        primary: PRIMARY_RULE_LIMIT,
        secondary: SECONDARY_RULE_LIMIT,
        cosmeticShards: COSMETIC_SHARD_COUNT
      },
      totals: {
        candidateNetworkRules: candidates.length,
        selectedNetworkRules: primary.length + secondary.length,
        protectedNetworkRules: 1,
        primaryNetworkRules: primary.length,
        secondaryNetworkRules: secondary.length,
        genericCosmeticSelectors: genericSelectors.size,
        domainCosmeticSelectors: [...domainSelectors.values()].reduce((sum, value) => sum + value.size, 0),
        cosmeticDomains: domainSelectors.size,
        cosmeticExceptionDomains: domainExceptions.size
      },
      sources: Object.fromEntries(
        Object.entries(REPOSITORIES).map(([name, repository]) => [name, {
          name: repository.label,
          repository: repository.url.replace(/\.git$/, ""),
          commit: getCommit(sourcePaths[name]),
          selectedNetworkRules: selectedBySource[name],
          ...stats[name]
        }])
      )
    };
    writeJson(join(RULES_DIR, "filter-metadata.json"), metadata);

    cpSync(join(sourcePaths.adguard, "LICENSE"), join(LICENSES_DIR, "GPL-3.0.txt"));

    console.log(JSON.stringify(metadata, null, 2));
  } finally {
    if (ownsSourceRoot) {
      rmSync(workingRoot, { recursive: true, force: true });
    }
  }
};

main();
