# Refinr for Obsidian

Turn the active note into an agent-ready backlog (Epics, Stories, Sub-tasks) in Jira or OpenProject, via
[Refinr](https://github.com/chams-bensalem/refinr).

> Work in progress (0.1.0, not yet in the community directory). This version only checks the connection to Refinr;
> analysis and issue creation come next.

## Requirements
- Obsidian 1.13.0 or later.
- A running Refinr server that you control (self-hosted). The plugin does not work without it.

## Network use
The plugin sends requests **only to the Refinr server whose URL you set** in the plugin settings, and only when you run
one of its commands. It is needed because Refinr does the analysis and creates the issues in your tracker. Notes are
sent to that server when you analyse them (next versions). No telemetry, no other service.

## API key storage
If your Refinr server requires an API key (`X-API-Key`), select or create a secret in the plugin settings. The key is
not saved in the plugin's `data.json` (only the name of the secret is). Stored by Obsidian on this device, outside your
vault files (so it is not synced with your notes). How it is protected depends on Obsidian and your operating system.

## Refinr server configuration
- By default Refinr only accepts the host names `localhost`, `127.0.0.1` and `[::1]`. To reach it through another
  address (other machine, phone), add that host name to `REFINR_ALLOWED_HOSTS` on the server.
- If **Test connection** reports `HTTP 403 "Invalid CORS request"`, add `app://obsidian.md` to `CORS_ALLOWED_ORIGINS`
  on the server.

## Manual installation (development)
```sh
npm ci
npm run build
```
Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/refinr/`, then enable **Refinr** in
**Settings → Community plugins** and run **Refinr: Test connection** from the command palette.

## License
[MIT](LICENSE)
