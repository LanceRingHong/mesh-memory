# Changelog

## 0.4.5 — 2026-10-31

- Native manifest adds `description` and `updatedAt` for the Go memory page.
- `memory_write` and `digest` refresh the native manifest.
- README rewritten with install, upstream, Syncthing and troubleshooting sections.
- Added docs: Syncthing, upstream, troubleshooting, contributing, security.
- Installer no longer copies `.git` into `node_modules`.

## 0.4.4 — 2026-10-31

- Native manifest filters to `AGENTS.shared.md`, `skills/`, `memory/`, `sessions/`.
- Excludes `index/`, `.mesh/`, `.stversions/` from the human-facing manifest.
- AGENTS title becomes「共享规则」in the manifest.

## 0.4.3 — 2026-10-31

- Added `$DSH_HOME/dsh-go/dsh-mesh.json` native manifest.
- Manifest is written on plugin start and after memory writes.
- Companion DSH Go native memory page can read it over `workspaceFiles/read`.

## 0.4.2 — 2026-10-31

- Automatic recall on `system-prompt/assemble`.
- BM25 over memory and session summaries, 6000-char budget, per-session dedupe.
- Frontmatter: `memoryType`, `description`, `aliases`, `baseline`, `validAt`, `invalidAt`, `supersededBy`.
- Validity filtering: expired/superseded entries are skipped.

## 0.4.1 — 2026-10-31

- Chinese category labels in the desktop tree.
- Markdown preview/source toggle with headings, lists, code, tables, links, quotes.

## 0.4.0 — 2026-10-31

- `/dsh-mesh/api/tree` full tree.
- Desktop sidebar footer / header utilities / conversation view entries.
- DSH Go native panel lists all files.
- Tablet profile support.

## 0.3.1 — 2026-10-31

- Composer strip「记忆」capsule for DSH Go.

## 0.3.0 — 2026-10-31

- Desktop `client.js` (conversation view).
- DSH Go native panel via `dshGo`.

## 0.2.x — 2026-10-31

- Dashboard route `/dsh-mesh/`.
- Standalone read-only page on 8765/8766.
- AGENTS/skills sync.
- Tablet install.

## 0.1.0 — 2026-10-31

- Initial MVP: shared memory, 13 `mesh_*` tools, Remote delegation, file transfer.
