# workflow-scout

Record browser activity, detect repeated patterns, and export automation workflows for n8n, Playwright, and Zapier.

## What it does

Workflow Scout watches how you use your browser and finds the repetitive sequences you perform over and over -- navigating to a page, filling out a form, clicking through a flow. Once it spots a pattern, it exports a ready-to-run automation in your format of choice.

The tool has two parts:

1. **Chrome Extension** -- records navigation, click, form-submit, and input-change events in real time with sensitive data redaction.
2. **Node.js CLI** -- imports the recorded events into a local SQLite store, runs pattern detection, and exports automation workflows.

## Architecture

```
+---------------------+         JSON export         +------------------+
|  Chrome Extension   | --------------------------> |   CLI (Node.js)  |
|  (Manifest V3)      |                             |                  |
|                      |                             |  import          |
|  background.js       |                             |  timeline        |
|  content.js          |                             |  analyze         |
|  popup (html/js/css) |                             |  export          |
+---------------------+                             |  sessions / tag  |
                                                     |  search          |
                                                     +------------------+
                                                           |
                                                     SQLite (local)
                                                           |
                                               +-----------+-----------+
                                               |           |           |
                                            n8n JSON   Playwright   Zapier
                                                        script      config
```

## Features

- **Multi-format export** -- n8n workflow JSON, Playwright automation scripts, or Zapier-compatible configs
- **Smart pattern detection** -- DP-based optimal non-overlapping sequence matching with auto-tuning
- **Sensitive data redaction** -- passwords, credit cards, API keys, SSNs, and tokens are automatically redacted
- **Session tagging** -- organize recordings with tags for scoped analysis
- **Visual workflow preview** -- ASCII flow diagrams in the terminal before exporting
- **Dry-run mode** -- preview what will be exported without writing files
- **Form field propagation** -- captured form field names flow through to exported workflows

## v2 Success criteria

- [x] Chrome extension captures nav/click/form-submit/input-change events with sensitive data redaction
- [x] Local-first SQLite storage with searchable events and session tags
- [x] Pattern detector uses DP-based optimal matching with auto-tuning
- [x] Exports to n8n, Playwright, and Zapier formats
- [x] Form field metadata propagates through the full pipeline
- [x] Visual workflow preview and dry-run mode
- [x] CI runs on Ubuntu, macOS, and Windows with Node 18 and 20
- [x] 56 tests across 7 test suites including E2E integration tests

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
npx workflow-scout export pat_1 --format n8n
npx workflow-scout export pat_1 --format playwright
npx workflow-scout export pat_1 --format zapier
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `workflow-scout import <file>` | Import events from extension JSON export (with validation) |
| `workflow-scout timeline` | Show formatted event timeline |
| `workflow-scout analyze` | Detect repeated patterns (supports `--auto-tune`) |
| `workflow-scout export <id>` | Export pattern as n8n / Playwright / Zapier workflow |
| `workflow-scout sessions` | List recorded sessions with tags |
| `workflow-scout search <query>` | Search events by URL, selector, or value |
| `workflow-scout tag <session> <tag>` | Tag a session for organized analysis |
| `workflow-scout untag <session> <tag>` | Remove a tag from a session |
| `workflow-scout clean-cache` | Remove the patterns cache file |

### Global options

- `--db <path>` -- Use a custom SQLite database file (default: `~/.workflow-scout/events.db`)

### Export formats

```bash
# n8n workflow (default)
workflow-scout export pat_1 --format n8n

# Playwright automation script
workflow-scout export pat_1 --format playwright

# Playwright Test format
workflow-scout export pat_1 --format playwright-test

# Zapier-compatible config
workflow-scout export pat_1 --format zapier

# Preview without writing a file
workflow-scout export pat_1 --dry-run
```

### Analyze options

```bash
# Auto-tune detection parameters
workflow-scout analyze --auto-tune

# Analyze only tagged sessions
workflow-scout analyze --tag checkout-flow

# Manual parameter tuning
workflow-scout analyze --min-length 3 --max-length 10 --min-freq 2
```

## License

MIT
