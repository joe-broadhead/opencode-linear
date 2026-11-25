# Changelog

## 0.0.0 (2026-11-25)

- Registers one Linear MCP server per alias with a typed OAuth config (`{ scope: "read write" }`); the 78 Linear MCP
  tools are reachable, one server per alias (`linear`, `linear-work`, `linear-personal`).
- Reads skill frontmatter with the `yaml` package: `>`, `|` and their chomping variants fold exactly as YAML says, and
  each `SKILL.md` description is one quoted line. A malformed skill fails setup with `SCHEMA_VIOLATION` instead of
  registering a marker.
- Redacts the conformance fixture: case labels use `case`, personal names and owner emails carry the kit's
  placeholders, and event hashes are recomputed, so `plugin-kit record --check` passes.
- Ships the yaml parser's ISC licence in `NOTICE` (in `files` and the pack check) and bundles the parser into
  `dist/index.js`.
