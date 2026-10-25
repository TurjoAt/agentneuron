// Feature route modules. Each exports: default async function register(router, ctx).
import system from './system.js';
import files from './files.js';
import tasks from './tasks.js';
import git from './git.js';
import reports from './reports.js';
import project from './project.js';
import agentcenter from './agentcenter.js';
import workspace from './workspace.js';
import verify from './verify.js';

export async function registerAll(router, ctx) {
  for (const reg of [system, files, tasks, git, reports, project, agentcenter, workspace, verify]) await reg(router, ctx);
}
