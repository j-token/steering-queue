# steering-queue

[한국어](README.md) | **English**

A Claude Code plugin. Messages you type while Claude is working wait in a **queue** and are sent one by one when each turn ends. You **steer** one into the current turn only when you choose.

```
Steering
↪ check the session bug                                  pending
Queue 2 · sends when this turn ends · shift+↑ to manage
› fix provider switching
· workspace switch loses the session
  Steer now  Move  Edit  Delete  Cancel
```

## How it works

- **Queue by default.** A message typed during a turn goes to the queue above the prompt. When the turn ends, the first one is sent and a toast says so.
- **Steer when you want.** Open an item and pick **Steer now** to put it into the running turn. Steered messages show in their own colored section as `pending`, then `applied` once Claude has read them.
- **Reorder, edit, delete.** Drag items with the mouse, or use the keyboard. **Edit** moves the item back to the prompt.
- **Nothing gets lost.** If sending, steering or editing fails, the item goes back to the front of the queue.

## Keys

| Key | Action |
|---|---|
| `shift+↑` | From the prompt: open the queue |
| `shift+↓` | Back to the prompt |
| `↑` `↓` | Select an item |
| `enter` | Open the item's actions: Steer now (Send now when idle), Move, Edit, Delete, Cancel |
| `←` `→` / `↑` `↓` | Choose an action |
| After **Move**: `↑` `↓`, then `enter` | Move the item, then drop it |

With the mouse: drag a row to reorder it, or click a row to open its actions.

### Key install

On session start the plugin merges these bindings into `~/.claude/keybindings.json` (or `$CLAUDE_CONFIG_DIR/keybindings.json`). They replace the defaults `ctrl+x tab` and `esc`:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "shift+up": "abovePrompt:focus", "ctrl+x tab": null } },
    { "context": "AbovePrompt", "bindings": { "shift+down": "abovePrompt:leave", "escape": null } }
  ]
}
```

- Your other bindings are kept. If a key is already bound to something else, it is left alone and a toast tells you.
- If the file is not valid JSON, it is not touched.
- Claude Code reads key bindings at startup, so restart once after the first install.
- If your terminal does not send `shift+↑` / `shift+↓` as separate keys, run `/queue-keys remove`.

Claude Code plugins cannot ship key bindings themselves: the manifest has no such field, and a plugin `settings.json` only applies `agent` and `subagentStatusLine` ([docs](https://code.claude.com/docs/en/plugins/components.md)). That is why this plugin merges into `keybindings.json` instead.

### `/queue-keys` command

| Command | Action |
|---|---|
| `/queue-keys` or `/queue-keys install` | Install the keys and turn auto-install on |
| `/queue-keys remove` | Remove only this plugin's keys (back to `ctrl+x tab` and `esc`) and turn auto-install off |
| `/queue-keys status` | Show the keys in use and the file path |

It runs right away, even during a turn. Restart Claude Code to apply key changes.

To turn only the auto-install off, set the plugin option `installKeybindings` to `false` with `/plugin configure steering-queue@steering-queue`, or in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "steering-queue@steering-queue": { "options": { "installKeybindings": false } } } }
```

## Install

Requires Claude Code with function-hook plugins (built and tested on 2.1.288). This API is in early access and may change.

### From GitHub

```
/plugin marketplace add j-token/steering-queue
/plugin install steering-queue@steering-queue
```

or from a shell:

```sh
claude plugin marketplace add j-token/steering-queue
claude plugin install steering-queue@steering-queue
```

### From a local folder

```sh
git clone https://github.com/j-token/steering-queue.git steering-queue
claude --plugin-dir ./steering-queue
```

Do not load the same plugin twice (for example installed and `--plugin-dir` at the same time): both copies would queue every message.

## Rules

- Only plain messages typed in the prompt (or sent from Remote Control) during a turn are queued. Messages with attachments, `/` commands, notifications and messages from other sessions behave as usual.
- After an interrupted or failed turn the queue waits. Open an item and pick **Send now**.
- If you steer while Claude is writing its final answer and the turn ends before Claude reads it, the plugin asks Claude to continue with it.
- Queued messages are re-sent as plain text, so `@file` mentions are not expanded.

## Known limits

- Mouse drag needs a terminal that reports mouse events (usually the fullscreen layout).
- The success path of steering and the behavior while a question or plan-approval dialog is open are not covered by the test kit and have been checked less.

## Development

```
.claude-plugin/plugin.json       manifest
.claude-plugin/marketplace.json  marketplace entry (this repo is its own marketplace)
hooks/hooks.json                 hooks module list
hooks/register.tsx               queue, steering, band UI, keyboard
hooks/queue-list.tsx             drag-and-drop list (Client module)
hooks/keybindings.ts             keybindings.json merge and removal
types/index.d.ts                 plugin state types
tests/                           tests
```

```sh
claude plugin validate .
claude plugin test .
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code writes when it loads the plugin from a folder (ignored by git). Load it once with `--plugin-dir`, then run `tsc -p .`.
