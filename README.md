# Refinr for Obsidian

Turn the active note into an agent-ready backlog (Epics, Stories, Sub-tasks) in Jira or OpenProject, via
[Refinr](https://github.com/chams-bensalem/refinr).

The plugin sends the note to your Refinr server, shows the backlog Refinr proposes, creates the issues in the tracker
configured on that server, and records what was created in the note's frontmatter. Each story gets a readiness verdict:
`ai-ready` (clear enough for a coding agent) or `validation-necessaire` (needs a human decision first). A story awaiting
validation can be reassessed from the note once you have added the missing precision, or validated by you directly.

> Status: 0.2.0, in the [Obsidian community catalog](https://community.obsidian.md/plugins/refinr). Desktop only for
> now (Windows, macOS, Linux): mobile has not been tested yet.

## Requirements

- Obsidian **1.13.0** or later.
- A running **Refinr 1.3.0 or later** server that you control (self-hosted), configured with its AI provider and its
  tracker (Jira or OpenProject). Version 1.3.0 is required because the plugin sends notes as text (`content`), which
  older versions do not accept. **Refinr 1.4.0** is needed for the features of 0.2.0: the output language, the verdict
  source (`aiReadySource`), **Validate a story** and the messages for an AI provider quota or overload (`503`); with
  Refinr 1.3 the plugin works as 0.1.0 did. The plugin does nothing without Refinr: all the analysis and all tracker
  calls are done by the server.
- **Accounts**: the plugin itself needs no account, but the Refinr server needs an account on your tracker (Jira or
  OpenProject) and, unless it uses a local model, an account with its AI provider. No payment is required by the
  plugin.

## Network use

The plugin sends requests **only to the Refinr server whose URL you set**, and only when you run one of its commands:

| Command | Requests | What is sent |
| --- | --- | --- |
| Test connection | `GET /api/v1/health`, `/source`, `/tracker` | nothing from your vault |
| Analyze note | `GET /source`, `/tracker`, `POST /api/v1/analyze-preview` | the note's text (frontmatter removed, embeds expanded), its name and the output language, if any |
| Create in {tracker} | `POST /api/v1/create-jira` | the backlog shown in the preview, and the output language, if any |
| Reassess a story | `GET /tracker`, `POST /api/v1/reassess-story` | the issue key, the precision you typed and the output language, if any |
| Validate a story | `GET /tracker`, `POST /api/v1/validate-story` | the issue key |

What happens next, on the Refinr server:

- **Your note goes to an AI provider.** The text of the note, embeds included, is sent by Refinr to the AI provider
  configured on the server: a cloud service (e.g. Anthropic, Google, OpenAI-compatible) or a local model, depending on
  how the server is set up. Check that configuration before analyzing notes with sensitive content.
- **Creation, reassessment and validation write to your tracker.** *Create in {tracker}* creates issues; *Reassess a
  story* adds your precision to the issue and changes its verdict; *Validate a story* marks the issue `ai-ready`
  (no AI call).
- **The API key is sent with every request** in the `X-API-Key` header, when you have set one. Prefer `https://` when
  Refinr is not on your own machine.

No telemetry, no other service, no request in the background.

## Clipboard

The plugin only **writes** to the clipboard, and only when you click **Copy YAML** (in the preview, or when the result
could not be written in the note): it copies the YAML of the backlog or of the `refinr` property. It never reads the
clipboard.

## Installation

### From the community catalog (recommended)

In Obsidian, open **Settings → Community plugins**, turn on community plugins if needed, choose **Browse**, search for
**Refinr**, then **Install** and **Enable**. The catalog page:
[community.obsidian.md/plugins/refinr](https://community.obsidian.md/plugins/refinr). Obsidian then offers the
updates.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the
   [latest release](https://github.com/chams-bensalem/refinr-obsidian/releases/latest).
2. Copy them into `<your vault>/.obsidian/plugins/refinr/` (create the folder).
3. Restart Obsidian (or reload the plugins), then enable **Refinr** in **Settings → Community plugins**.

To update a manual install, replace the three files, then turn **Refinr** off and on again in
**Settings → Community plugins**: a forced reload of Obsidian is not enough to load the new version.

Alternatively, build the plugin from the sources (Node.js 22.12 or later):

```sh
npm ci
npm run build
```

then copy the same three files from the repository root.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Refinr URL | `http://localhost:8080` | Base URL of your Refinr server, `http://` or `https://`, without `/api/v1` and without a trailing slash (the plugin adds the API paths). |
| API key | *(none)* | Secret holding the Refinr API key, sent as `X-API-Key`. Leave empty if your server has no key. |
| Default project key | *(empty)* | Project used when creating issues (editable before each creation). Empty = Refinr's default project. |
| Maximum embed depth | `3` | Levels of `![[embeds]]` expanded before sending a note (0 = embeds sent as written). |
| Maximum embedded characters | `100000` | Characters added by expanded embeds, all levels together. |
| Default language | *(empty)* | Language of the backlog and of the verdict reasons, as a two-letter ISO 639-1 code (`en`, `fr`…), sent as `language`. A `lang` property in the note replaces it. Empty = nothing sent: Refinr applies its own setting, then detects the language of the note. Needs Refinr 1.4.0 (ignored by older servers). |
| Analysis timeout (seconds) | `1560` | How long the plugin waits for an analysis, a creation or a reassessment. The default covers the worst case of a Refinr server with default settings. Refinr may keep working after the plugin stops waiting. |

The size limit of a note is read from Refinr (`maxContentChars`, 200,000 characters by default, title included): a
note above it is not sent.

### Refinr server reachable from Obsidian

- Refinr only accepts the host names `localhost`, `127.0.0.1` and `[::1]` by default. To reach it through another
  address (another machine, a phone), add that host name to `REFINR_ALLOWED_HOSTS` on the server.
- On desktop the plugin sends no `Origin` header, so Refinr's CORS settings do not apply. If **Test connection**
  reports `HTTP 403 "Invalid CORS request"` (possible on mobile, not tested), add `app://obsidian.md` to
  `CORS_ALLOWED_ORIGINS` on the server.

## API key security

- The key is stored with Obsidian's **secret storage** (`SecretStorage`), not in the plugin's `data.json`: the plugin
  settings only keep the **name** of the secret you selected.
- Stored by Obsidian on this device, outside your vault files (so it is not synced with your notes). How it is
  protected depends on Obsidian and your operating system.
- Consequences: on each device you use, select or create the secret again; the key is never written into a note, a
  notice or a log by the plugin; anyone who can use your Obsidian profile on this device can use the key.

## Usage

### Analyze a note

Open a note and run **Refinr: Analyze note** from the command palette, or click the Refinr button (magic wand) in
the left ribbon: both start the same analysis of the active note. Without an active Markdown note, the button shows
a notice; one analysis at a time runs per note. Like any ribbon icon, the button can be hidden with Obsidian's own
ribbon options; the plugin has no setting for it.

- The frontmatter is not sent. `![[embeds]]` are expanded: whole notes, `![[note#Heading]]` sections,
  `![[note#^block]]` blocks (a list item comes with all its sub-items), `![[#Heading]]` of the same note. Plain
  `[[links]]` stay as written.
- Embeds that cannot be expanded (missing note or section, image, PDF, loop, depth or size limit, note not indexed
  yet) are sent as written, and listed in a warning box at the top of the preview, with the characters left out.
- The preview lists epics, stories (verdict, story points, user story, acceptance criteria) and sub-tasks. Text from
  the AI model is always displayed as plain text.
- An analysis can take several minutes. You can close the window: a notice offers to reopen the preview when it is
  ready.

### Output language

The backlog and the verdict reasons are written in the language sent to Refinr: the note's `lang` property when it
has one (for example `lang: en`), otherwise the **Default language** setting, otherwise nothing is sent and Refinr
decides (its `refinr.llm.output-language` setting, then the language of the note). The same language is used for the
preview, the creation from it and the reassessments. An invalid code is refused by Refinr with
`language must be an ISO 639-1 code (e.g. fr, en)`, shown as is.

### Create the issues

From the preview, choose **Create in {tracker}**, check the project and the counts, then confirm.

- Refinr computes the verdicts again before creating: they may differ from the preview (the result shows both).
- The result lists the issues created (with links) and the items not created, with Refinr's reason.
- If the note already has a Refinr backlog, you are warned first; creating again creates new issues in the tracker.

### What is written in the note

The result is written in a `refinr` property of the note's frontmatter (your other properties are not changed):

```yaml
refinr:
  created: 2026-11-13T22:10:50+01:00
  tracker: OpenProject
  project: demo            # null = Refinr's default project
  status: complete         # complete | partial | unknown
  epics:
    - title: Order Export
      key: "151"
      url: https://openproject.example.com/work_packages/151
  stories:
    - title: Export paid orders to CSV file
      key: "152"
      url: https://openproject.example.com/work_packages/152
      verdict: ai-ready
      reassessed: 2026-11-13T23:50:05+01:00   # set by "Reassess a story"
    - title: Email the export to accounting
      key: "153"
      url: https://openproject.example.com/work_packages/153
      verdict: ai-ready
      verdictSource: human                    # set by "Validate a story"
      validated: 2026-11-14T09:12:40+01:00
  failed: []
  history:                 # earlier creations from this note, oldest first
    - created: 2026-11-13T22:01:30+01:00
      tracker: OpenProject
      project: demo
      status: complete
      epics:
        - title: Order export (CSV)
          key: "146"
          url: https://openproject.example.com/work_packages/146
      stories:
        - title: Generate and download the CSV export of orders
          key: "147"
          url: https://openproject.example.com/work_packages/147
          verdict: ai-ready
      failed: []
```

A block written during the real-world trial, after a second creation and a successful reassessment of story `"152"`
(OpenProject keys are numbers, written as text): host and project anonymized, titles translated; story `"153"` and
its validation were added to show the fields written by **Validate a story**.

- `status: partial`: some items were not created (listed in `failed`). `status: unknown`: the plugin could not know
  the outcome (timeout, connection lost after sending): **check the tracker before trying again**.
- `verdictSource: fallback` on a story (next to `verdict: validation-necessaire`): Refinr could not get a verdict
  (e.g. AI provider unavailable) and applied `validation-necessaire` by default. A successful reassessment of the
  story removes it. `verdictSource: human`: you validated the story yourself (**Validate a story**).
- A new creation moves the current entry to `history`; nothing is overwritten.
- If the note was deleted or its frontmatter is invalid, nothing is written and the result can be copied as YAML.

### Reassess a story

When a story of the note is `validation-necessaire`, run **Refinr: Reassess a story**, choose the story and type the
precision that answers its open questions. Refinr adds the precision to the issue (a comment in OpenProject, the end
of the description in Jira), computes a new verdict, and the plugin updates `verdict` and `reassessed` in the note.

- "no longer awaiting validation": the story is no longer `validation-necessaire` in the tracker (for example, it was
  reassessed from Refinr's web UI); the note is not changed.
- A timeout does not mean failure: check the issue before trying again, a new attempt adds another comment.

### Validate a story

When you know a `validation-necessaire` story is ready (the open questions are settled elsewhere), run **Refinr:
Validate a story**, choose the story and confirm. Refinr marks the issue `ai-ready` **without calling the AI** (it adds
the verdict line to the issue and replaces the label), and the plugin sets `verdict: ai-ready`, `verdictSource: human`
and `validated` in the note. Needs Refinr 1.4.0: an older server answers that it cannot validate a story.

## Limits

- **One instance per tracker name**: before a reassessment the plugin checks that Refinr still uses the tracker
  recorded in the note, by its name only. Two Jira (or two OpenProject) instances are not told apart.
- **Fallback verdicts**: read from `aiReadySource` with Refinr 1.4.0. With Refinr 1.3 they are detected from Refinr's
  wording; if it changed, such a story would be shown as an ordinary `validation-necessaire` (never as `ai-ready`).
- **AI provider quota and rate limits**: with Refinr 1.4.0, an analysis or a reassessment ends with a message saying
  the AI provider is out of quota, rate limited or overloaded, and when to try again if Refinr knows it. Refinr 1.3
  answers `502 "The AI provider is unavailable"`. At creation, Refinr applies the fallback verdict instead.
- **Long operations cannot be cancelled**: when the plugin stops waiting, Refinr may still finish the work.
- **Desktop only for now (Windows, macOS, Linux): mobile has not been tested yet.** Network calls, the secret storage
  and the layout of the windows have only been checked on desktop, and a phone cannot reach a Refinr server on
  `localhost`. The plugin is therefore not offered on iOS and Android.

## Releasing

For the maintainer. Obsidian installs the files attached to the GitHub release whose tag is **exactly** the
`version` of `manifest.json` (`x.y.z`, no `v` prefix).

In this order:

1. **Prepare the version on a branch.** Update `minAppVersion` in `manifest.json` by hand if the release needs a
   newer Obsidian, then run `npm version <x.y.z>`. It sets the version in `package.json`, `package-lock.json` and
   `manifest.json` and adds `"<x.y.z>": "<minAppVersion>"` to `versions.json`. It creates no commit and no tag
   (`.npmrc`). Commit (`chore: release <x.y.z>`) and open a pull request.
2. **Merge the pull request into `main`.**
3. **Make the repository public** (first release only, done by the maintainer in the repository settings). The build
   provenance attestation **fails as long as the repository is private** (it would need GitHub Enterprise Cloud),
   and then no release is created.
4. **Tag `x.y.z` on `main`** and push the tag:
   `git switch main && git pull && git tag -a <x.y.z> -m <x.y.z> && git push origin <x.y.z>`.
   The `release` workflow refuses a tag whose commit is not in the history of `main`, or that does not match
   `manifest.json`, `package.json` and `versions.json` (with a message saying what to fix). It then runs lint, tests
   and build, attests `main.js`, `manifest.json` and `styles.css`, and creates a **draft** release with these three
   files attached and generated release notes.
5. **Review the draft, then publish it** on GitHub (edit the release notes first if needed).

Anyone can check a downloaded file with `gh attestation verify main.js --repo chams-bensalem/refinr-obsidian`.

**Starting again** after a failed run (private repository, wrong version…), or to redo a draft:

1. Delete the draft release, if one was created, and the remote tag:
   `gh release delete <x.y.z> --cleanup-tag --yes`. Without a draft, delete the remote tag alone:
   `git push origin :refs/tags/<x.y.z>`.
2. Delete the local tag: `git tag -d <x.y.z>`.
3. Fix the cause (make the repository public, or fix the files through a new pull request merged into `main`).
4. Tag again on `main` (step 4).

## License

[MIT](LICENSE)
