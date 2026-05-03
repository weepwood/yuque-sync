# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

An Obsidian plugin (`yuque-sync`) that syncs markdown files between Obsidian and [Yuque](https://www.yuque.com) (语雀). Users can upload the current file to a Yuque knowledge base or download a Yuque document into the current file.

## Build & Dev Commands

```bash
npm install          # install dependencies
npm run dev          # watch mode (esbuild dev build)
npm run build        # production build: tsc typecheck + esbuild bundle + minify
npm run version      # bump version (reads pkg version, updates manifest.json & versions.json)
```

The CI workflow (`.github/workflows/webpack.yml`) runs `npm run build` on push/PR to master.

## Project Structure

- **`main.ts`** — Entire plugin lives in this single file (~520 lines). Three classes:
  - `MyPlugin` (extends `Plugin`) — Main plugin class with three ribbon icon actions (upload to Yuque, download from Yuque, image upload placeholder), YAML frontmatter parser, Yuque API client methods.
  - `ConfirmModal` (extends `Modal`) — Async confirmation dialog used before upload/download.
  - `SampleSettingTab` (extends `PluginSettingTab`) — Settings tab for configuring the Yuque API token.
- **`esbuild.config.mjs`** — Build config (entry: `main.ts` → output: `dist/main.js`, CJS format, ES2018 target, tree shaking).
- **`styles.css`** — Minimal plugin CSS (mostly empty, some scaffolding for button containers).
- **`manifest.json`** — Obsidian plugin manifest (`id: yuque-sync`, `minAppVersion: 0.15.0`).
- **`versions.json`** — Plugin version → min Obsidian version mapping for backward compatibility.
- **`version-bump.mjs`** — Script that updates `manifest.json` and `versions.json` when releasing.

## Key Architecture Notes

- **Single-file plugin**: All logic is in `main.ts` — no `src/` directory or module splitting.
- **Yuque API**: Uses Obsidian's `requestUrl` (not `fetch`) to call `https://www.yuque.com/api/v2/repos/{book_id}/docs/{slug}` with `X-Auth-Token` header.
- **YAML frontmatter**: Uses a custom regex-based parser in `parseYaml()` (not `js-yaml`). The plugin reads `yuque_link` from frontmatter to identify the Yuque document target.
- **Sync workflow**: Each file's Yuque target is stored in its own YAML frontmatter (`yuque_link: https://www.yuque.com/{namespace}/{book_id}/{slug}`), not in a central mapping.
- **Download creates a backup**: Before overwriting, the current file is copied to `{filename}_{timestamp}.md`.

## Dev Branches

- `master` — stable/release branch
- `dev` — active development
- Other feature branches as needed
