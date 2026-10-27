// Action modules. Each exports: default function register(registry, ctx).
import files from './files.js';
import git from './git.js';
import packages from './packages.js';
import agents from './agents.js';
import tasks from './tasks.js';
import agentneuron from './agentneuron.js';
import ship from './ship.js';
import changes from './changes.js';
import brief from './brief.js';

export async function registerActions(registry, ctx) {
  for (const reg of [files, git, packages, agents, tasks, agentneuron, ship, changes, brief]) await reg(registry, ctx);
}
