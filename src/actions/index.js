// Action modules. Each exports: default function register(registry, ctx).
import files from './files.js';
import git from './git.js';
import packages from './packages.js';
import agents from './agents.js';
import tasks from './tasks.js';
import agentneuron from './agentneuron.js';

export async function registerActions(registry, ctx) {
  for (const reg of [files, git, packages, agents, tasks, agentneuron]) await reg(registry, ctx);
}
