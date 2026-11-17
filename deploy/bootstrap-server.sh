#!/usr/bin/env bash
# One-time server setup, run as root from this folder on the server, with the CI public key on stdin:
#   scp -r deploy vps:/tmp/traffic-deploy
#   ssh vps 'bash /tmp/traffic-deploy/bootstrap-server.sh' < traffic_ci_key.pub
# Safe to re-run. Leaves the portfolio's deploy key alone.
set -euo pipefail
cd "$(dirname "$0")"

pubkey="$(head -n 1)"
[[ "$pubkey" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] || { echo "expected an ssh-ed25519 public key on stdin" >&2; exit 2; }

# Node (official build, checksum pinned) and ffmpeg
NODE=v24.21.0
NODE_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
if [ "$(/usr/local/bin/node --version 2>/dev/null)" != "$NODE" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/node.tar.xz" "https://nodejs.org/dist/$NODE/node-$NODE-linux-x64.tar.xz"
  echo "$NODE_SHA256  $tmp/node.tar.xz" | sha256sum -c -
  tar -xJf "$tmp/node.tar.xz" -C /opt
  ln -sfn "/opt/node-$NODE-linux-x64/bin/node" /usr/local/bin/node
  rm -rf "$tmp"
fi
command -v ffmpeg >/dev/null || { apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q ffmpeg; }

# Service user: owns only its database
id traffic &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin traffic
install -d -o traffic -g traffic -m 750 /var/lib/traffic

# Releases are written by the existing `deploy` user (created by the portfolio bootstrap)
id deploy &>/dev/null || { echo "user deploy is missing; run the portfolio bootstrap first" >&2; exit 1; }
install -d -o deploy -g deploy -m 755 /opt/traffic /opt/traffic/releases
install -m 755 traffic-deploy /usr/local/bin/traffic-deploy

# deploy may restart the collector and nothing else
printf 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart traffic-collector\n' > /tmp/traffic-sudoers
visudo -cf /tmp/traffic-sudoers
install -m 440 /tmp/traffic-sudoers /etc/sudoers.d/traffic-deploy && rm /tmp/traffic-sudoers

# CI key for this repo: replace our own line, keep every other key (the portfolio's)
ak=/var/lib/deploy/.ssh/authorized_keys
touch "$ak"
{ grep -v 'command="/usr/local/bin/traffic-deploy"' "$ak" || true
  printf 'restrict,command="/usr/local/bin/traffic-deploy" %s\n' "$pubkey"; } > "$ak.new"
chown deploy:deploy "$ak.new" && chmod 600 "$ak.new" && mv "$ak.new" "$ak"

install -m 644 traffic-collector.service /etc/systemd/system/traffic-collector.service
systemctl daemon-reload
systemctl enable traffic-collector  # starts on the first deploy, once /opt/traffic/current exists

echo "bootstrap ok; node $(/usr/local/bin/node --version), $(ffmpeg -version | head -1 | cut -d' ' -f1-3)"
