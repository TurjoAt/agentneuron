# Drifted project (demo)

A small project whose context files have drifted from the code and whose agent config is risky, to show
`agentneuron verify`, `agentneuron audit` and `agentneuron ci`. Nothing here is a real credential.

```sh
npx agentneuron verify examples/drifted-project --fix-preview
npx agentneuron audit examples/drifted-project
npx agentneuron ci examples/drifted-project --format markdown
```
