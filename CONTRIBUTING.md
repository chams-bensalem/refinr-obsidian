# Contributing to Refinr for Obsidian

Thank you for your interest. This plugin is a thin client of the [Refinr](https://github.com/chams-bensalem/refinr)
REST API: it holds no AI and no tracker logic. A change of Refinr's behavior or REST contract belongs in the `refinr`
repository, not here.

## Set up

- Node.js **22.12** or later (`.nvmrc`), then `npm ci`.
- Versioned git hooks (gitleaks, license headers, no AI attribution in commit messages), once per clone:
  `git config core.hooksPath .githooks`.
- A Refinr **1.4.0** server you control, to try the plugin for real (Refinr 1.3.0 for the features of 0.1.0).

## Commands

| What | Command |
| --- | --- |
| Build (type check + bundle `main.js`) | `npm run build` (development: `npm run dev`) |
| Lint (Obsidian's rules, `no-unsafe-*` as errors) | `npm run lint` |
| Tests (Vitest, `tests/`) | `npm test` |
| Secrets scan | `gitleaks detect --source . --no-banner` (staged: `gitleaks protect --staged`) |
| License headers | `scripts/check-spdx.sh` (staged: `--staged`) |

CI runs lint, build and tests on Node 22 and 24, the license headers, gitleaks, the AI attribution check and
actionlint. All must pass.

## Rules

- **No secret** in the code, the tests, the examples or the logs. The Refinr API key lives only in Obsidian's secret
  storage; `data.json` holds the secret's name. Never put a key in a message, a notice or a log.
- **No new runtime dependency** without the maintainer's agreement (today there is none: everything is a dev
  dependency).
- Every source file starts with `SPDX-FileCopyrightText: 2026 Chams Bensalem` and `SPDX-License-Identifier: MIT`.
- Modules covered by tests do not import `obsidian` (at most `import type`): the `obsidian` package has no runtime
  code outside the app.
- Obsidian community catalog rules: no telemetry, no obfuscation, network use declared in the README, `this.app`
  (never the global `app`), no `innerHTML`, no default hotkey, no inline style, sentence case in the UI, frontmatter
  written only through `processFrontMatter`, no Node or Electron API.
- Text from the AI model or from a note is always displayed as plain text (`createEl({ text })`).
- Try changes for real only in a dedicated test vault, never in a vault holding your own notes.

## Commits and pull requests

- One branch per change, merged into `main` through a pull request only (no direct push to `main`, no force-push).
- [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `build:`, `ci:`…).
- No AI attribution in commits, pull requests, tags or releases (no `Co-Authored-By` of an AI, no "Generated with").
- Show the real output of the tests and the build in the pull request, and update `CHANGELOG.md` (`[Unreleased]`)
  and the README when the behavior changes.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE).
