# Live view

The **Live** page (`#/live`, second in the sidebar) shows which files your coding agents are editing right now. AgentNeuron tails the transcripts of active Claude Code and Codex sessions for this project as they are written, turns every file edit, shell command and prompt into a structured event, and checks each edit against what the file watcher sees on disk.

## What you see

- **Now editing**: one chip per file edited in the last minute, coloured by agent. A chip pulses for a few seconds after a fresh edit. Click a chip to open the file.
- **Heat strip**: the files touched in the last 5, 15 or 60 minutes. A cell's width follows its edit count and its colour follows the agent that edited it most. An amber underline means several agents touched the file. Click a cell to filter the lanes to that file.
- **Collision banners**: shown when two sessions edit the same file within 5 minutes, or when a session edits a path that another agent has [claimed](coordination.md). Cards for that file are outlined in amber, and a toast appears once.
- **Swimlanes**: one lane each for Claude, Codex, Cursor and other agents, and Human/unknown.
  - Each edit card shows the operation (`edit`, `write`, `create`, `delete`, `patch`), the path, `+added −removed` lines, the session and a status dot:
    - green: **confirmed**, seen on disk
    - amber: **pending**, announced in the transcript but not seen on disk yet
    - red: **failed**, the tool reported an error
    - grey: **unverified**, from before AgentNeuron started
  - Expand a card to see a small diff, masked and capped at 40 lines.
  - Commands appear as compact `$ cmd` rows with their exit code. Turn them off with **Commands**.
- **Side panel**: live sessions (state, model, edit count, and the latest prompt or intent when prompts are allowed), advisory claims (release them, or claim paths yourself), and the latest handoff notes.
- **Filters**: agent, session (or click a session in the side panel) and file. **Pause** freezes the lanes and counts the events that arrive in the meantime. **Auto-scroll** keeps each lane on its newest card.

Elsewhere in the app:

- The **Overview** shows a compact *Live agents* card with active sessions, the file each one is on, and the latest edits.
- Neuron-brain pulses and topbar radar blips take the editing agent's colour.
- Board cards show a lock when a task or its files are claimed, an agent-coloured avatar for agent assignees, and the number of handoff notes.

## How it works

- **Claude Code.** It reads `~/.claude/projects/<project dir>/*.jsonl`, using the same directory naming as the Agents page on every platform.
- **Codex.** It reads the rollout files in today's and yesterday's `~/.codex/sessions/YYYY/MM/DD/` folders. A rollout counts only when its `cwd` (from `session_meta` or `turn_context`) is inside this project. Nothing from other projects' sessions is emitted.
- **Discovery.** The transcript directories are watched with `fs.watch`, and re-listed every 3 seconds as a fallback. Only transcripts modified in the last 15 minutes are tailed.
- **Tailing.**
  - Each tailed file is `stat`ed every 750 ms and only the new bytes are read, at most 4 MB per poll. A half-written last line waits for the next poll.
  - Transcripts that already exist at startup seed the snapshot from their last 256 KB. These edits are marked `unverified` and are not broadcast.
- **Extraction.**
  - Claude: `Edit`, `MultiEdit`, `Write` and `NotebookEdit` become edits, `Bash` becomes a command, and tool results supply the exit status. A `Write` that creates a file becomes `create`.
  - Codex: `apply_patch` (custom tool, function call, or `shell` with `apply_patch`) is parsed per file (`Add`, `Update`, `Delete`, `Move to`), and `shell`, `exec_command` and `local_shell_call` become commands. Exit codes come from the call output or `exec_command_end`.
- **Confirmation.** A transcript edit is confirmed by a matching file-watcher event within 20 s. For files the watcher does not track (the watcher follows Markdown and context files, not your source code), it is confirmed by a `stat` 1.2 s later that shows the file modified (or gone, for a delete).
- **Human / unknown.** When the watcher sees a change and no transcript edit for that file arrives within 1.5 s, the change is shown as `human` (or as the agent the existing session attribution found). This only works for files the watcher tracks, so edits by tools without transcripts (Cursor, editors, scripts) to source files are not seen.
- **Session states.** `start` is the first activity seen, `active` follows new lines, `idle` comes after 90 s without activity, and `end` after 20 minutes.

Memory is bounded:

| Buffer | Cap |
|---|---|
| Edits | 500 |
| Commands | 200 |
| Prompt and intent notes | 60 |
| Collisions | 50 |
| Per-file editor map | 2,000 entries |

The browser applies events once per animation frame, applies nothing while the tab is hidden (the queue is capped), renders at most 60 cards per lane at a time ("Show more"), and drops animations under *reduced motion*. Timers are unref'd, and watchers close with the server.

## Privacy and security

- **Paths.** Every path is resolved with `realpath` and must lie inside the project. Edits outside it, through a symlink that leaves it, or into `.git/` or `.agentneuron/` are dropped.
- **Masking.** Diff lines, commands, prompts, titles and notes pass through the secret masker before they leave the process.
- **Size limits.**

  | Field | Limit |
  |---|---|
  | Diff | 40 lines, 200 characters per line, about 4 KB |
  | Command | 300 characters |
  | Prompt or intent | 200 characters |

- **Prompts.** `agent.prompt`, `agent.thinking` and the `lastPrompt`/`lastThinking` fields of sessions are sent only when prompts are allowed. They are allowed by default when the server is bound to a loopback address and off for any other bind (`live.showPrompts`). Viewers never get them unless `live.viewerPrompts` is `true`.
  The same rule covers session titles, prompt rows and quoted evidence in `/api/sessions`, `/api/agents/session`, `/api/agents/costs` and `/api/insights/*` (Replay, Lessons, cost by feature). On a non-loopback bind, set `"live": { "showPrompts": true }` to see them as admin.
- **Diffs.** Viewers get edit events without hunks (`hunk: []`, `hunkHidden: true`) unless `live.viewerDiffs` is `true`.

## Configuration

In `.agentneuron/config.json`:

```json
{
  "live": {
    "enabled": true,
    "showPrompts": true,
    "viewerPrompts": false,
    "viewerDiffs": false,
    "idleMs": 90000,
    "endMs": 1200000,
    "collisionWindowMs": 300000
  }
}
```

## Events and API

See [HTTP API](http-api.md#live-agents) for `GET /api/live` and the `agent.*` stream events, and [Coordination](coordination.md) for claims and handoffs.
