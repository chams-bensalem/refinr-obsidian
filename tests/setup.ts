// SPDX-FileCopyrightText: 2026 Chams Bensalem
// SPDX-License-Identifier: MIT

// Obsidian runs the plugin in a browser window; the code uses `window.setTimeout` (popout-window friendly).
// Under Node, `window` is the global object, so that Vitest's fake timers also apply.
(globalThis as { window?: unknown }).window ??= globalThis;
