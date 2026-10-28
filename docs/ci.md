# Context CI (`ci`)

`agentneuron ci` runs everything a pull request should be checked for in one pass: lint, the [truth check](verify.md), the [security audit](audit.md) and a context-size budget.

```sh
agentneuron ci [dir] [--format github|markdown|json] [--fail-on error|warn|never] [--base <ref>] [--budget <tokens>]
```

| Flag | Meaning |
|---|---|
| `--format github` | `::error` / `::warning` / `::notice` workflow commands (shown inline on the PR diff) plus a Markdown summary appended to `$GITHUB_STEP_SUMMARY` (printed instead when unset). Default inside GitHub Actions. |
| `--format markdown` | The summary table on stdout. Default elsewhere. |
| `--format json` | `{ schema: "agentneuron.ci/v1", root, files, issues, health, verify, audit, budget, base, failOn, failed }` |
| `--fail-on` | `error` (default): exit 1 on any error. `warn`: on errors or warnings. `never`: always exit 0. |
| `--base <ref>` | Only report issues introduced since `ref` (branch, tag or SHA). |
| `--budget <n>` | Warn when a tool loads more than `n` tokens of context at the project root (default 20000). |

Levels: lint `error`/`warn`/`info` map to error/warning/notice (info lint notices are not annotated, only counted); false claims are warnings; audit `high`/`medium`/`low` are error/warning/notice; budget overruns are warnings. Exit code `2` means bad usage or an unusable `--base`.

## Only what this PR introduced

With `--base origin/main` the base revision is checked out into a temporary directory through a private git index (your index, HEAD and worktree are never touched; symlinks are written as plain files) and analysed the same way. Issues are compared by a line-independent fingerprint, so moving text around does not create "new" issues. Typical catch: a PR renames the `test:unit` script while CLAUDE.md still says `npm run test:unit`; the unchanged CLAUDE.md line is reported because the claim became false in this PR.

The base ref must exist locally: use `actions/checkout` with `fetch-depth: 0` (or `git fetch origin main`).

## GitHub Action

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- uses: TurjoAt/agentneuron@v1.1.0
  with:
    path: .
    fail-on: error
    base: origin/${{ github.base_ref }}
```

Inputs: `path` (default `.`), `fail-on` (`error`|`warn`|`never`), `base`, `budget`, `version` (defaults to the agentneuron version the action was released with; must be an exact version). The action is a composite step that runs `npx agentneuron@<version> ci --format github`; inputs are passed through environment variables, never interpolated into the script. Node must be available on the runner (it is on GitHub-hosted runners).

A complete workflow is in [`examples/ci/agentneuron-ci.yml`](../examples/ci/agentneuron-ci.yml).

Example summary for [`examples/drifted-project`](../examples/drifted-project/):

```
## AgentNeuron context CI: FAILED

Fails on: **error**. 4 tracked files. Health 45/100 (F); truth check 8 false of 14 claims; agent-config risk 81/100 (high).

| Check | Errors | Warnings | Notices |
|---|---:|---:|---:|
| Lint | 0 | 1 | 0 |
| Truth check | 0 | 7 | 0 |
| Security audit | 4 | 2 | 0 |
| Context budget | 0 | 0 | 0 |
...
```

And one annotation:

```
::warning file=examples/drifted-project/CLAUDE.md,line=7,title=agentneuron verify%3A false-claim::`yarn install`: project uses pnpm (pnpm-lock.yaml)%0Areplace `yarn install` with `pnpm install`
```
