# workflow-scout

Record browser activity, detect repeated patterns, and export n8n-compatible automation workflows.

## What it does

Workflow Scout watches how you use your browser and finds the repetitive sequences you perform over and over -- navigating to a page, filling out a form, clicking through a flow. Once it spots a pattern, it exports a ready-to-run n8n workflow so you can automate it.

The tool has two parts:

1. **Chrome Extension** -- records navigation, click, and form-submit events in real time.
2. **Node.js CLI** -- imports the recorded events into a local SQLite store, runs pattern detection, and exports n8n workflow JSON.

## Architecture

```
+---------------------+         JSON export         +------------------+
|  Chrome Extension   | --------------------------> |   CLI (Node.js)  |
|  (Manifest V3)      |                             |                  |
|                      |                             |  import          |
|  background.js       |                             |  timeline        |
|  content.js          |                             |  analyze         |
|  popup (html/js/css) |                             |  export          |
+---------------------+                             +------------------+
                                                           |
                                                     SQLite (local)
                                                           |
                                                     n8n workflow JSON
```

## v1 Success criteria (definition of done)

- [x] Chrome extension captures nav/click/form-submit events with minimal network metadata
- [x] Local-first SQLite storage with searchable events
- [x] 30-minute session produces a timeline of searchable events
- [x] Pattern detector finds repeated sequences (>= 2 repeats)
- [x] Exports runnable n8n workflow with trigger, HTTP request nodes, and success check
- [x] End-to-end flow: record -> import -> analyze -> export

## Quickstart

See [QUICKSTART.md](./QUICKSTART.md) for detailed setup instructions.

### TL;DR

```bash
# Install CLI
npm install
npm run build

# Load extension in Chrome
# chrome://extensions -> Developer mode -> Load unpacked -> select extension/

# After recording, export JSON from extension popup, then:
npx workflow-scout import ./exported-events.json
npx workflow-scout analyze
npx workflow-scout export pat_1
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `workflow-scout import <file>` | Import events from extension JSON export |
| `workflow-scout timeline` | Show formatted event timeline |
| `workflow-scout analyze` | Detect repeated patterns |
| `workflow-scout export <id>` | Export pattern as n8n workflow JSON |
| `workflow-scout sessions` | List recorded sessions |
| `workflow-scout search <query>` | Search events by URL, selector, or value |

### Global options

- `--db <path>` -- Use a custom SQLite database file (default: `~/.workflow-scout/events.db`)

## License

MIT
