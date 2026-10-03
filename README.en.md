# steering-queue

[한국어](README.md) | **English**

A Claude Code plugin that holds the messages you type while Claude is working. Each time a turn ends, the first one in the queue is sent. To put a message into the running turn instead (steering), open it and pick **Steer now**.

```
Steering
↪ check the session bug                                  pending
Queue 2 · sends when this turn ends · shift+↑ to manage
› fix provider switching
· workspace switch loses the session
  Steer now  Move  Edit  Delete  Cancel
```

## Using it

Press Enter during a turn and the message lands in the list above the prompt. When the turn ends, the first item goes out with a `Queue: sending next message` toast.

`shift+↑` moves you into the list. Pick an item with `↑` `↓` and press `enter` to open its action row, choose with `←` `→` (or `↑` `↓`), and press `enter` again. `shift+↓` takes you back to the prompt.

| Action | What it does |
|---|---|
| Steer now | Adds it to the running turn. When nothing is running it reads Send now and starts a new turn |
| Move | Move it with `↑` `↓`, drop it with `enter` |
| Edit | Puts it back in the prompt, after anything you were typing |
| Delete | Removes it |
| Cancel | Closes the action row |

With a mouse, drag a row to reorder it or click it to open its actions.

Steered messages appear in a cyan `Steering` section as `pending` and switch to `applied` once Claude has read them. If sending, steering or editing fails, the item returns to the front of the queue, so nothing is lost.

## Keys

Claude Code plugins can't register key bindings. The manifest has no field for them, and a plugin's `settings.json` only applies `agent` and `subagentStatusLine` ([docs](https://code.claude.com/docs/en/plugins/components.md)). So on session start this plugin writes the bindings into `~/.claude/keybindings.json` (or the one under `CLAUDE_CONFIG_DIR`):

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "shift+up": "abovePrompt:focus", "ctrl+x tab": null } },
    { "context": "AbovePrompt", "bindings": { "shift+down": "abovePrompt:leave", "escape": null } }
  ]
}
```

This turns off the defaults `ctrl+x tab` and `esc`. Your other bindings stay as they are; a key you already use for something else is left alone and you get a toast. A file that isn't valid JSON is not touched. Claude Code reads key bindings at startup, so restart once after the first install.

### `/steering-key-install`

Manages the bindings by hand. It runs right away, even mid-turn.

| Command | What it does |
|---|---|
| `/steering-key-install` | Installs the keys and turns auto-install on |
| `/steering-key-install remove` | Removes only this plugin's keys and turns auto-install off. `ctrl+x tab` and `esc` come back |
| `/steering-key-install status` | Shows the keys in use and the file path |

When the keys are already there:

```
> /steering-key-install
  ⎿  steering-queue: Queue keys already installed: shift+↑ to open, shift+↓ to leave.
```

If your terminal doesn't send `shift+↑` / `shift+↓` as distinct keys, run `/steering-key-install remove`. To turn off only the auto-install, set `installKeybindings` to `false` with `/plugin configure steering-queue@steering-queue`, or add this to `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "steering-queue@steering-queue": { "options": { "installKeybindings": false } } } }
```

## Install

You need a Claude Code build with function-hook plugins. This one was built and tested on 2.1.288; the API is in early access and may change.

```
/plugin marketplace add j-token/steering-queue
/plugin install steering-queue@steering-queue
```

From a shell, run `claude plugin marketplace add j-token/steering-queue` and then `claude plugin install steering-queue@steering-queue`. To run it straight from a clone:

```sh
git clone https://github.com/j-token/steering-queue.git steering-queue
claude --plugin-dir ./steering-queue
```

Don't enable the installed copy and a `--plugin-dir` copy together, or every message gets queued twice.

## Rules and limits

Only plain messages sent from the prompt or Remote Control during a turn are queued. Messages with attachments, `/` commands, notifications and messages from other sessions go through as usual.

After an interrupted or failed turn the queue waits. Open an item and pick Send now to continue.

If you steer while Claude is writing its final answer and the turn ends before Claude reads it, the plugin asks Claude to pick it up.

Queued messages are re-sent as plain text, so `@file` mentions aren't expanded. Mouse drag needs a terminal that reports mouse events, usually the fullscreen layout. The test kit can't reproduce a successful steer or an open question/plan-approval dialog, so those paths have had less checking.

## Development

```
.claude-plugin/plugin.json       manifest
.claude-plugin/marketplace.json  marketplace entry (the repo is its own marketplace)
hooks/hooks.json                 hooks module list
hooks/register.tsx               queue, steering, list UI, keyboard, command
hooks/queue-list.tsx             drag-and-drop list (Client module)
hooks/keybindings.ts             keybindings.json merge and removal
types/index.d.ts                 plugin state types
tests/                           tests
```

```sh
claude plugin validate .
claude plugin test .
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code writes when it loads the plugin from a folder; git ignores it. Load the plugin once with `--plugin-dir`, then run `tsc -p .`.
