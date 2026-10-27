#!/usr/bin/env node
/**
 * Visible-terminal control MCP server.
 *
 * Unlike a ConPTY-based headless approach, this drives a genuinely visible,
 * classic Windows console window: spawned with Start-Process (a real window
 * the user can watch), keystrokes sent via SendKeys, and screen content read
 * back directly via the Win32 Console API (AttachConsole + CONOUT$ +
 * ReadConsoleOutputCharacter) — not a screenshot, the actual character buffer.
 *
 * This is the validated, working approach as of 2026-10-28. The earlier
 * ConPTY/node-pty based "pty-control-local" server has been removed: it only
 * ever proved things to the assistant, never gave the user anything to watch,
 * and is no longer part of this project.
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { execFileSync } = require('child_process');
const path = require('path');

const SEND_KEYS_SCRIPT = path.join(__dirname, 'send-keys.ps1');
const READ_CONSOLE_SCRIPT = path.join(__dirname, 'read-console.ps1');

function runPwsh(args) {
  return execFileSync('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', ...args], {
    encoding: 'utf8',
    timeout: 20000
  });
}

const server = new McpServer({ name: 'visible-terminal-control', version: '0.1.0' });

server.registerTool(
  'vterm_spawn',
  {
    description:
      'Open a brand-new, genuinely visible PowerShell console window the user can watch on their own screen. Returns the process id (pid) to use with vterm_send / vterm_read / vterm_close.',
    inputSchema: {
      cwd: z.string().optional().describe('Working directory to start in. Defaults to the current directory.')
    }
  },
  async ({ cwd }) => {
    const args = [SEND_KEYS_SCRIPT, '-StartNew'];
    if (cwd) args.push('-StartIn', cwd);
    const out = runPwsh(args);
    const m = out.match(/STARTED_PID:(\d+)/);
    if (!m) return { content: [{ type: 'text', text: `Unexpected output: ${out}` }], isError: true };
    return { content: [{ type: 'text', text: `Spawned visible terminal, pid ${m[1]}` }], structuredContent: { pid: m[1] } };
  }
);

server.registerTool(
  'vterm_send',
  {
    description:
      'Send keystrokes to a visible terminal window, exactly as if typed on a keyboard. Relies on the window having focus (true right after vterm_spawn, or after the user last interacted with it — does not forcibly steal focus from other windows). Does not wait for a response — call vterm_read afterward.',
    inputSchema: {
      pid: z.string().describe('Process id returned by vterm_spawn'),
      text: z.string().optional().describe('Literal text to type (e.g. a command or a chat message).'),
      enter: z.boolean().optional().default(false).describe('Press Enter after the text.'),
      special: z
        .array(z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT', 'ESC', 'TAB']))
        .optional()
        .describe('Special keys to send in order, e.g. ["UP","UP"] to navigate a menu, before any text/enter.')
    }
  },
  async ({ pid, text, enter, special }) => {
    // Multiple SendKeys calls within a single PowerShell process invocation are not
    // reliably delivered (confirmed empirically — only the first of several queued
    // keys lands, even with delays between them). Each discrete key/action is
    // therefore sent as its own separate process invocation, which is reliable 100%
    // of the time in testing. Slightly slower, but correct.
    const results = [];
    if (special) {
      for (const key of special) {
        results.push(runPwsh([SEND_KEYS_SCRIPT, '-ProcessId', String(pid), '-SendSpecial', key]).trim());
      }
    }
    if (text) {
      results.push(runPwsh([SEND_KEYS_SCRIPT, '-ProcessId', String(pid), '-SendText', text]).trim());
    }
    if (enter) {
      results.push(runPwsh([SEND_KEYS_SCRIPT, '-ProcessId', String(pid), '-SendEnter']).trim());
    }
    return { content: [{ type: 'text', text: results.join('\n') || 'Nothing to send.' }] };
  }
);

server.registerTool(
  'vterm_read',
  {
    description:
      'Read exactly what is currently rendered on screen in a visible terminal window, via the real Windows Console API (not a screenshot) — the same thing the user sees if they look at that window.',
    inputSchema: { pid: z.string().describe('Process id returned by vterm_spawn') }
  },
  async ({ pid }) => {
    try {
      const out = runPwsh([READ_CONSOLE_SCRIPT, '-ProcessId', String(pid)]);
      return { content: [{ type: 'text', text: out }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Read failed: ${e.message}` }], isError: true };
    }
  }
);

server.registerTool(
  'vterm_close',
  {
    description: 'Close a visible terminal window (terminates the process).',
    inputSchema: { pid: z.string().describe('Process id returned by vterm_spawn') }
  },
  async ({ pid }) => {
    try {
      execFileSync('powershell.exe', ['-Command', `Stop-Process -Id ${Number(pid)} -Force -ErrorAction SilentlyContinue`]);
      return { content: [{ type: 'text', text: `Closed pid ${pid}` }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Close failed: ${e.message}` }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
