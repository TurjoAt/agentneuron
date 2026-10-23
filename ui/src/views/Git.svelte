<script>
  import { api } from '../lib/api.js';
  import { navigate, onStream } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Empty from '../lib/Empty.svelte';
  import { gx, bump } from '../lib/git/gx.svelte.js';
  import '../lib/git/git.css';
  import Overview from '../lib/git/Overview.svelte';
  import Changes from '../lib/git/Changes.svelte';
  import History from '../lib/git/History.svelte';
  import Branches from '../lib/git/Branches.svelte';
  import Tags from '../lib/git/Tags.svelte';
  import Stash from '../lib/git/Stash.svelte';
  import Remotes from '../lib/git/Remotes.svelte';
  import Blame from '../lib/git/Blame.svelte';
  import Stats from '../lib/git/Stats.svelte';
  import Changelog from '../lib/git/Changelog.svelte';

  let { params = {} } = $props();
  const IDS = ['overview', 'changes', 'history', 'branches', 'tags', 'stash', 'remotes', 'blame', 'stats', 'changelog'];
  let active = $state('overview');
  $effect(() => { active = IDS.includes(params?.tab) ? params.tab : 'overview'; });

  const branches = resource(() => api('/api/git/branches'), { key: () => gx.tick });
  const changes = resource(() => api('/api/git/changes'), { key: () => gx.tick });
  const unavailable = $derived(branches.data?.available === false ? branches.data : changes.data?.available === false ? changes.data : null);
  const ready = $derived(branches.data !== undefined && changes.data !== undefined);
  const nChanges = $derived(changes.data ? (changes.data.staged?.length || 0) + (changes.data.unstaged?.length || 0) + (changes.data.untracked?.length || 0) + (changes.data.conflicted?.length || 0) : null);
  const tabs = $derived([
    { id: 'overview', label: 'Overview' }, { id: 'changes', label: 'Changes', count: nChanges || null }, { id: 'history', label: 'History' },
    { id: 'branches', label: 'Branches' }, { id: 'tags', label: 'Tags' }, { id: 'stash', label: 'Stash' }, { id: 'remotes', label: 'Remotes' },
    { id: 'blame', label: 'Blame' }, { id: 'stats', label: 'Stats' }, { id: 'changelog', label: 'Changelog' },
  ]);

  $effect(() => {
    let t;
    const off = onStream('job', (j) => { if (j && j.status && j.status !== 'running' && j.status !== 'queued') { clearTimeout(t); t = setTimeout(bump, 250); } });
    return () => { clearTimeout(t); off(); };
  });
</script>

<div class="page git">
  <div class="page-h">
    <div><h1>Git</h1><p>Status, history and everything in between.</p></div>
  </div>

  {#if branches.error}
    <Empty icon="alert" title="Could not load git info">{branches.error.message}</Empty>
  {:else if !ready && !unavailable}
    <div class="skel" style="height:200px"></div>
  {:else if unavailable}
    <div class="card"><Empty icon="git" title="Git not available">{unavailable.reason || 'This project is not a git repository, or git is not installed.'} mdctl's local history still tracks every change.</Empty></div>
  {:else}
    <div class="tabbar"><Tabs {tabs} bind:active onchange={(t) => navigate('git', { tab: t })} /></div>
    {#key active}
      {#if active === 'overview'}<Overview branches={branches.data} changes={changes.data} />
      {:else if active === 'changes'}<Changes changes={changes.data} {params} />
      {:else if active === 'history'}<History {params} />
      {:else if active === 'branches'}<Branches branches={branches.data} />
      {:else if active === 'tags'}<Tags />
      {:else if active === 'stash'}<Stash />
      {:else if active === 'remotes'}<Remotes />
      {:else if active === 'blame'}<Blame {params} />
      {:else if active === 'stats'}<Stats />
      {:else if active === 'changelog'}<Changelog />
      {/if}
    {/key}
  {/if}
</div>
