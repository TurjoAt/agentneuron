# Docker

Build the image from this folder (or use your own base image with `npm i -g agentneuron`):

```sh
docker build -t agentneuron examples/deploy
```

Read-only monitoring of the current directory, reachable only from the host itself:

```sh
docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  -v "$PWD":/project \
  -p 127.0.0.1:4747:4747 \
  agentneuron --token "$(openssl rand -hex 24)"
```

The banner shows the URL with the token. Note the pieces:

- `-p 127.0.0.1:4747:4747` publishes on the host's loopback only. Using `-p 4747:4747` would expose it on every interface.
- Inside the container the server must bind `0.0.0.0` (the image entrypoint does). That forces a token; if you pass none, one is generated and printed in the container log.
- `-v "$PWD":/project` gives it read/write access to the project. For a strictly read-only view use `-v "$PWD":/project:ro`. AgentNeuron then cannot save history or logs and the `edit` level will not work, but monitoring, graph, lint and health still do.
- Sessions and cost read `~/.claude` and `~/.codex`; mount them (`-v ~/.claude:/home/node/.claude:ro`) if you want those views.
- File-watch events from bind mounts can be unreliable on macOS and Windows; see [troubleshooting](../../docs/troubleshooting.md#changes-are-not-detected-live).

One-off checks without a server:

```sh
docker run --rm -v "$PWD":/project:ro --entrypoint agentneuron agentneuron lint /project
```

Docker Compose:

```yaml
services:
  agentneuron:
    build: ./examples/deploy
    user: "1000:1000"
    volumes:
      - .:/project
    ports:
      - "127.0.0.1:4747:4747"
    command: ["--admin-token", "${AGENTNEURON_ADMIN_TOKEN}", "--token", "${AGENTNEURON_VIEWER_TOKEN}"]
    restart: unless-stopped
```
