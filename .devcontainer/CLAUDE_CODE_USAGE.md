# Using Claude Code in this DevContainer

Claude Code runs inside the container, following the personal devcontainer standard (see the `devcontainer` skill in dotfiles — the source of truth for versions and conventions).

## Setup

1. **Ensure Docker is running**, and that `ssh-agent` has your key on the host (`ssh-add --apple-use-keychain`, or `AddKeysToAgent yes` in `~/.ssh/config`) — git auth inside the container comes from agent forwarding, not mounted keys.
2. **Open in VS Code** → `Dev Containers: Reopen in Container` (first build takes a few minutes).
3. **Authenticate Claude** once, inside the container:

```bash
claude auth login
```

Config persists in the `claude-config` volume across rebuilds. Volumes are namespaced per project, so each project logs in separately.

## Using Claude Code

```bash
claude       # interactive
clauded      # claude --dangerously-skip-permissions (alias)
```

## Isolation model — what's actually true

`clauded` is acceptable here because of what this container can and cannot reach:

- ✅ **No host filesystem** beyond this project's workspace.
- ✅ **No SSH keys in the container** — agent forwarding only; keys can be used for git, never read.
- ✅ **No docker socket** — the host Docker daemon is unreachable.
- ⚠️ **Full network egress.** A prompt-injected agent could exfiltrate anything readable inside the container: this project's source and whatever is in `.devcontainer/.env`. Accepted risk — keep only low-value dev credentials in `.env`. If this project ever holds credentials whose theft would hurt, add the egress firewall (see the skill's optional blocks).
- ⚠️ Claude runs as **root inside the container** — full access within it, by design.

## Project specifics

- **Browser tests**: the e2e suite and the story validator run on Playwright's own Chromium, baked into the image at `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` (version pinned in the Dockerfile to match `@playwright/test`). Chromium's sandbox is off (`chromiumSandbox: false` in `playwright.config.ts`) because the container runs as root. `bun run test` (Vitest units) and `bun run test:e2e` work out of the box.
- **Port 3098** is forwarded for statically serving `index.html` / `examples/` (e.g. `bunx serve -l 3098 .` or `python3 -m http.server 3098`).
- No database, no docker-in-docker.

## Volumes and persistence

- `claude-config` → `/root/.claude` — auth/settings, survives rebuilds
- `scrolly-node-modules` → `/workspace/node_modules` — container-private so Linux and macOS native binaries don't collide

## Departures from standard

None.
<!-- If this project deviates from the skill's conventions, list each departure
     and its reason here — visible drift, not silent drift. -->

## Troubleshooting

Rebuild from the Command Palette: `Dev Containers: Rebuild Container`.
