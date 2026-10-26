# Minimal image for AgentNeuron. The project is mounted at /project.
FROM node:20-alpine

# git powers the Git page, doc drift and the changelog generator
RUN apk add --no-cache git

# Pin the version you have tested
RUN npm install -g agentneuron@1.0.0 && npm cache clean --force

# Run as an unprivileged user; override with --user "$(id -u):$(id -g)" so files
# in the mounted project keep your ownership.
USER node
WORKDIR /project
EXPOSE 4747

# Listening on 0.0.0.0 INSIDE the container is required for published ports; a token is then
# mandatory (set one in /project/.agentneuron/config.json or pass --token / --admin-token).
ENTRYPOINT ["agentneuron", "--host", "0.0.0.0", "--port", "4747", "/project"]
