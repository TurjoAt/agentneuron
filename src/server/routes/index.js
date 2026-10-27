// Feature route modules. Each exports: default async function register(router, ctx).
import system from './system.js';
import files from './files.js';
import tasks from './tasks.js';
import git from './git.js';
import reports from './reports.js';
import project from './project.js';
import agentcenter from './agentcenter.js';
import workspace from './workspace.js';
import live from './live.js';
import verify from './verify.js';
import insights from './insights.js';
import compiler from './compiler.js';
import usage from './usage.js';
import ship from './ship.js';
import changes from './changes.js';
import brief from './brief.js';

export async function registerAll(router, ctx) {
  for (const reg of [system, files, tasks, git, reports, project, agentcenter, workspace, live, verify, insights, compiler, usage, ship, changes, brief]) await reg(router, ctx);
}
