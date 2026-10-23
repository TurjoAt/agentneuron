# Install with systemd

```sh
# 1. a dedicated user and a copy of the single-file bundle
sudo useradd --system --home /srv/myapp --shell /usr/sbin/nologin agentneuron
sudo mkdir -p /opt/agentneuron
sudo cp .agentneuron/agentneuron.mjs /opt/agentneuron/        # from `npx agentneuron init`

# 2. data folder and config with tokens
sudo mkdir -p /srv/myapp/.agentneuron
sudo tee /srv/myapp/.agentneuron/config.json >/dev/null <<JSON
{ "host": "127.0.0.1", "port": 4747,
  "adminToken": "$(openssl rand -hex 24)",
  "token": "$(openssl rand -hex 24)" }
JSON
sudo chown -R agentneuron:agentneuron /srv/myapp/.agentneuron
sudo chmod 600 /srv/myapp/.agentneuron/config.json

# 3. the service (the user also needs read access to the project files)
sudo cp examples/deploy/agentneuron.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agentneuron
journalctl -u agentneuron -f
```

Then add the reverse proxy from `Caddyfile` or `nginx.conf`, or connect through an SSH tunnel.
