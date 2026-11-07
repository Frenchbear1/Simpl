# Simpl filter lists

Simpl bundles compatible ad-blocking rules generated from:

- EasyList: https://github.com/easylist/easylist
- AdGuard Filters: https://github.com/AdguardTeam/AdguardFilters
- uBlock Origin uAssets: https://github.com/uBlockOrigin/uAssets

The generated output contains standard network rules that can be represented by
Chrome Manifest V3 Declarative Net Request and standard CSS cosmetic selectors.
Scriptlets, HTML filtering, response rewriting, redirect resources, procedural
selectors, and other engine-specific instructions are intentionally excluded.

## Update the bundled lists

From the extension directory, run:

```powershell
node tools/build-filter-lists.mjs
node tools/verify-extension.mjs
```

`rules/filter-metadata.json` records the exact source commits and generated rule
counts. `rules/network-primary.json` uses Chrome's guaranteed static-rule quota;
`rules/network-secondary.json` is installed as safe dynamic rules. Site-specific
cosmetic rules are split across `rules/cosmetic/` shards and loaded on demand.

## Licensing

EasyList is dual-licensed under GPL-3.0-or-later or CC BY-SA 3.0-or-later.
AdGuard Filters and uBlock Origin uAssets are GPL-3.0. See
`THIRD_PARTY_NOTICES.md` and `licenses/GPL-3.0.txt`.
