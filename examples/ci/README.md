# CI example

`agentneuron-lint.yml` is a GitHub Actions workflow that fails a pull request when your AI-context files have **error**-level problems:

- `broken-link`: a Markdown link, wiki link or `@import` points to a missing file
- `large-context`: a `CLAUDE.md`/`AGENTS.md`/rules file is over about 10,000 tokens
- `secret`: a credential-looking value is committed in a tracked Markdown file

Warnings (`missing-path`, `stale-plan`, mid-size context files...) and info (`orphan`, `duplicate-rule`) are reported but do not fail the job.

## Use it

```sh
mkdir -p .github/workflows
cp examples/ci/agentneuron-lint.yml .github/workflows/agentneuron-lint.yml
```

It runs `npx agentneuron lint --json .`, which exits `1` if any error exists. A step summary lists the errors and the full JSON report is uploaded as an artifact.

Run the same check locally before pushing:

```sh
npx agentneuron lint            # human readable
npx agentneuron lint --json     # what CI sees
echo $?                         # 0 = ok, 1 = errors
```

## Other CI systems

Any system works: install Node 18+, run `npx agentneuron lint`, and fail on a non-zero exit code. GitLab CI:

```yaml
agentneuron:
  image: node:20
  script:
    - npx --yes agentneuron lint
```

## Gate on the score

To require a minimum health score as well as zero errors:

```sh
npx agentneuron lint --json . > report.json || exit 1
node -e 'const r=require("./report.json"); if (r.health.score < 80) { console.error("health score " + r.health.score); process.exit(1); }'
```

Try it on the sample projects: `examples/multi-tool-project` fails (one broken import), `examples/claude-code-project` passes with warnings.
