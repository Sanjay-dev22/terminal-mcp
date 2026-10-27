# visible-terminal-mcp

An [MCP](https://modelcontextprotocol.io) server that gives an AI agent control of a **genuinely visible** Windows terminal window — the agent spawns it, types into it, reads back exactly what's rendered on screen, and closes it, while a human watches the real window the whole time.

## The problem this solves

Most ways an AI agent can drive a terminal are **headless**: the agent spawns a process behind a pseudo-terminal (ConPTY / `node-pty`), types into it, and reports back what happened. That's fast and works well for scripted automation — but it gives a human nothing to look at. You're asked to trust that the agent did what it says it did, with no independent way to verify it in real time.

This project exists because that trust gap caused a real problem: an agent was asked to drive a second interactive CLI session on behalf of a user. Using a headless approach, the agent reported success — but the session had silently failed to persist its work, and there was no way for the user to have caught this while it was happening, because there was nothing to watch. See [`docs/motivation.md`](docs/motivation.md) for the full incident this project was built to prevent from recurring.

**The fix**: don't hide the terminal. Spawn a real, classic Windows console window — the same kind you'd open yourself — and drive it with the same two things a human uses: a keyboard and a pair of eyes.

## What it actually gives you

| Capability | Mechanism | Why it's different from a headless approach |
|---|---|---|
| **Spawn** a real terminal window | `Start-Process` | It's an actual OS window, not a virtual buffer — the user can see it exists |
| **Type** into it | Windows `SendKeys` | Real keystrokes, including special keys (arrows, Enter, Esc, Tab) for navigating interactive menus/pickers |
| **Read** what's on screen | Win32 Console API (`AttachConsole` + `CONOUT$` + `ReadConsoleOutputCharacter`) | Reads the actual character buffer the window is displaying — not a screenshot, not a guess, the same content the human sees |
| **Close** it | `Stop-Process` | Clean teardown when done |

Because reading goes through the real console buffer, the agent and the human are looking at **the same ground truth** — there's no second, hidden copy of "what happened" that only the agent has access to.

## Use cases

- **Supervised automation of interactive CLIs** — anything that only shows its full behavior when it detects a real terminal (confirmation prompts, TUI pickers, tools that disable prompts when piped), with a human able to watch it happen.
- **Driving a second instance of an interactive agent/CLI session** on behalf of a user, transparently — the motivating case for this project.
- **Reproducing and debugging terminal-dependent bugs** that don't manifest the same way under a headless PTY, with a human verifying each step as the agent takes it.
- **Teaching or demoing** what an agent is doing step by step, rather than presenting only a final summary.

## Requirements

- Windows (uses Win32 Console API and PowerShell `SendKeys` — this is not cross-platform)
- Node.js >= 18
- PowerShell available on `PATH`

## Installation

```bash
git clone https://github.com/Sanjay-dev22/visible-terminal-mcp.git
cd visible-terminal-mcp
npm install
```

## Using it as an MCP server

Register it with your MCP-compatible client. For Claude Code, add this to your `mcpServers` config (e.g. `~/.claude.json`):

```json
{
  "mcpServers": {
    "visible-terminal-control": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/visible-terminal-mcp/src/server.js"],
      "env": {}
    }
  }
}
```

Restart your MCP client, and four tools become available:

### `vterm_spawn`

Opens a new, visible PowerShell window.

| Param | Type | Required | Description |
|---|---|---|---|
| `cwd` | string | no | Working directory to start in |

Returns `{ pid }` — the process id used by every other tool.

### `vterm_send`

Sends keystrokes to a window, exactly as if typed on a keyboard.

| Param | Type | Required | Description |
|---|---|---|---|
| `pid` | string | yes | From `vterm_spawn` |
| `text` | string | no | Literal text to type |
| `enter` | boolean | no | Press Enter after the text |
| `special` | array | no | Named keys sent in order: `UP`, `DOWN`, `LEFT`, `RIGHT`, `ESC`, `TAB` |

> **Why each key is its own process call internally:** sending multiple `SendKeys` calls within a single PowerShell invocation is not reliably delivered — confirmed empirically, only the first of several queued keys would land, even with delays in between. `vterm_send` issues one PowerShell process invocation per discrete key/text/enter action, which is reliable 100% of the time in testing. This makes each call slightly slower than a naive batched version, but correct — see [`docs/motivation.md`](docs/motivation.md) for how this was diagnosed.

### `vterm_read`

Reads exactly what's currently rendered in the window.

| Param | Type | Required | Description |
|---|---|---|---|
| `pid` | string | yes | From `vterm_spawn` |

Returns the visible screen content as text.

### `vterm_close`

Terminates the window's process.

| Param | Type | Required | Description |
|---|---|---|---|
| `pid` | string | yes | From `vterm_spawn` |

## Example

See [`examples/basic-spawn-type-read.js`](examples/basic-spawn-type-read.js) for a minimal spawn → type → read → close cycle, and [`examples/menu-navigation.js`](examples/menu-navigation.js) for using `special` keys to navigate a TUI/history menu (PowerShell command-history recall, as a stand-in for any arrow-key-driven picker).

```bash
npm run example:basic
npm run example:menu-navigation
```

## Relying on focus, not stealing it

`vterm_send` does **not** forcibly steal window focus (no `SetForegroundWindow` call). It relies on the target window already having focus — true immediately after `vterm_spawn` creates it, or after a human last interacted with it. This is a deliberate choice: combining forced focus-stealing with synthetic keystroke injection is a recognized pattern for malicious input automation, and this project avoids it even though it means the caller is responsible for not clicking elsewhere mid-sequence.

## Known limitations

- **Windows only.** The console-reading mechanism and `SendKeys` are both Win32-specific.
- **Reads text, not pixels.** `vterm_read` returns the character buffer, not colors, fonts, or a literal screenshot.
- **Can't reach an IDE's own integrated terminal panel** (e.g. VS Code's) directly — that would require an IDE-extension-based tool, which this is not. It controls independent OS-level console windows.
- **One key per process call.** See the note under `vterm_send` above — this is intentional, not a missing optimization.
- Relies on the target window keeping focus between calls — if something else is clicked in between, keystrokes go to the wrong place, same as a real human would need to refocus.

## License

[MIT](LICENSE)
