<script>
  // Sessions: list of agent sessions and the replay of one (?id=).
  let { params = {} } = $props();
</script>

<div class="page">
  <div class="page-h"><div><h1>Sessions</h1><p>Every Claude Code and Codex session: replay prompts, tool calls, edits and subagents.</p></div></div>
  <p class="muted">{params.id ? `Session ${params.id}` : 'Coming in this round.'}</p>
</div>
