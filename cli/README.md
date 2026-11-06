# cudic-cli

The Cudic CLI and MCP server. Make, push and publish Cudic projects from a
terminal — or let an agent do it.

```sh
npm i -g cudic-cli    # adds the `cudic` and `cudic-mcp` commands
```

Node 18+. No dependencies, nothing to audit.

The package is `cudic-cli` because npm reserves the bare name `cudic` (too
close to an existing package). The command you run is still `cudic`.

## Use

```sh
cudic login --email you@example.com   # once, keeps a refreshable token in ~/.cudic
cudic new my-game                    # scaffold index.html / style.css / game.js
cudic push my-game                   # save (creates on first push)
cudic publish my-game --tags puzzle  # put it in the gallery
cudic open                           # play link; --studio for the editor
```

Try it without installing: `npx cudic-cli games`.

Read-only commands work signed out: `cudic games`, `cudic get <id>`,
`cudic search "<text>"`, `cudic forums`, `cudic thread <id>`, `cudic docs`.

Everything is reachable over the same HTTP API the website uses:
`cudic --help` lists the commands.

## Agents

Two ways in, both without a browser:

```sh
# durable, scoped key (create one at cudic.vercel.app/keys or `cudic key create`)
export CUDIC_API_KEY=cudic_...
cudic list
```

MCP server over stdio:

```sh
npx -y --package cudic-cli cudic-mcp
```

MCP client config:

```json
{ "mcpServers": { "cudic": {
    "command": "npx",
    "args": ["-y", "--package", "cudic-cli", "cudic-mcp"],
    "env": { "CUDIC_API_KEY": "cudic_..." } } } }
```

## Configuration

| Variable | Meaning |
| --- | --- |
| `CUDIC_API_KEY` | `cudic_...` scoped key — best for agents |
| `CUDIC_TOKEN` | one-shot Supabase access token instead of `login` |
| `CUDIC_API` | API host (default `https://glox-o7rr.onrender.com`) |
| `CUDIC_WEB` | website host (default `https://cudic.vercel.app`) |
| `CUDIC_HOME` | config/backup dir (default `~/.cudic`) |

## Licence

MIT. Docs: <https://cudic.vercel.app/docs.html#cli>
