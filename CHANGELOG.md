# Changelog

All notable changes to Refinr for Obsidian are recorded here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning: [SemVer](https://semver.org/).
The plugin is a client of the [Refinr](https://github.com/chams-bensalem/refinr) REST API: the Refinr version each
release needs is given below.

## [Unreleased]

## [0.2.0] - 2026-11-23

Needs **Refinr 1.3.0** or later; the new features need **Refinr 1.4.0** (with Refinr 1.3 the plugin works as 0.1.0).

### Added
- **Output language**: a *Default language* setting (two-letter ISO 639-1 code), replaced by the note's `lang`
  property, sent as `language` to `analyze-preview`, `create-jira` and `reassess-story`. Nothing is sent when both
  are empty (Refinr decides). Refinr's `400` for an invalid code is shown as is.
- **Validate a story** command: marks a story of the note awaiting validation `ai-ready` on your decision, without
  any AI call (`POST /api/v1/validate-story`). The note records `verdictSource: human` and `validated`.
- Messages for a `503` of Refinr 1.4.0 (AI provider out of quota, rate limited or overloaded), with the delay before
  trying again when Refinr gives one (`retryAfterSeconds`).
- `CONTRIBUTING.md` and this changelog.

### Changed
- Fallback verdicts are read from `aiReadySource` when Refinr sends it (1.4.0 or later); the exact wording of the
  reason is still recognized for Refinr 1.3 and older.
- README: installation from the community catalog first, then manual; clipboard use declared; Refinr version needed
  per feature.
- Lint: the `no-unsafe-*` rules (untyped `any` in calls, member accesses, assignments, arguments, returns) are set to
  error explicitly, so that CI blocks them.

## [0.1.0] - 2026-11-14

First release. Needs **Refinr 1.3.0** or later (notes sent as text, `content`). Desktop only.

### Added
- **Analyze note** (command and ribbon button): the active note is sent as text (frontmatter removed, `![[embeds]]`
  expanded within depth and size limits, warnings for what could not be expanded) to `analyze-preview`, after a size
  check against Refinr's `maxContentChars`.
- Preview window: epics, stories (verdict, story points, user story, acceptance criteria) and sub-tasks, as plain
  text; copy as YAML.
- **Create in {tracker}** (Jira or OpenProject, as configured on Refinr): `create-jira` with the preview, result with
  links and items not created; the outcome is written in the note's `refinr` property (with `history`), or offered as
  YAML when it cannot be written; an unknown outcome is recorded so that a new creation warns first.
- **Reassess a story**: precision sent to `reassess-story`, new verdict written in the note.
- **Test connection**: health, source and tracker of Refinr, with actionable messages (401, host not allowed, CORS,
  413, timeouts).
- Settings: Refinr URL, API key in Obsidian's secret storage (only the secret's name in `data.json`), default project,
  embed limits, analysis timeout.

[Unreleased]: https://github.com/chams-bensalem/refinr-obsidian/compare/0.2.0...HEAD
[0.2.0]: https://github.com/chams-bensalem/refinr-obsidian/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/chams-bensalem/refinr-obsidian/releases/tag/0.1.0
