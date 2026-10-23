<script>
  import { api } from '../lib/api.js';
  import { navigate } from '../lib/store.svelte.js';
  import { resource } from '../lib/resource.svelte.js';
  import Tabs from '../lib/Tabs.svelte';
  import Permissions from './settings/Permissions.svelte';
  import Role from './settings/Role.svelte';
  import Audit from './settings/Audit.svelte';
  import Notifications from './settings/Notifications.svelte';
  import Trash from './settings/Trash.svelte';
  import Jobs from './settings/Jobs.svelte';
  import Appearance from './settings/Appearance.svelte';
  import About from './settings/About.svelte';

  let { params = {} } = $props();
  const settings = resource(() => api('/api/settings'), { live: false });

  const TABS = [
    { id: 'permissions', label: 'Permissions' },
    { id: 'role', label: 'Role & auth' },
    { id: 'audit', label: 'Audit log' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'trash', label: 'Trash' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'about', label: 'About' },
  ];
  const VALID = new Set(TABS.map((t) => t.id));
  let tab = $state(VALID.has(params.tab) ? params.tab : 'permissions');
  $effect(() => {
    const t = VALID.has(params.tab) ? params.tab : 'permissions';
    if (t !== tab) tab = t;
  });
  const go = (id) => navigate('settings', { tab: id });
</script>

<div class="page">
  <div class="page-h">
    <div>
      <h1>Settings</h1>
      <p>Permissions, access, audit trail and housekeeping. Changes to what agentneuron may do are made on the server.</p>
    </div>
  </div>
  <div class="tabs"><Tabs tabs={TABS} bind:active={tab} onchange={go} /></div>
  <div class="body">
    {#if tab === 'permissions'}<Permissions settings={settings.data} />
    {:else if tab === 'role'}<Role settings={settings.data} />
    {:else if tab === 'audit'}<Audit />
    {:else if tab === 'notifications'}<Notifications settings={settings.data} />
    {:else if tab === 'trash'}<Trash />
    {:else if tab === 'jobs'}<Jobs />
    {:else if tab === 'appearance'}<Appearance />
    {:else if tab === 'about'}<About settings={settings.data} />
    {/if}
  </div>
</div>

<style>
  .tabs { margin-bottom: 16px; max-width: 100%; }
  .body { display: flex; flex-direction: column; gap: 14px; max-width: 980px; }
</style>
