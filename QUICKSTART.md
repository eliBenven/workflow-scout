# Quickstart Guide

## Prerequisites

- Node.js >= 18
- Google Chrome or Chromium-based browser
- npm

## Part 1: Install the CLI

```bash
cd workflow-scout

# Install dependencies
npm install

# Build TypeScript
npm run build

# Verify it works
npx workflow-scout --help
```

You should see the list of available commands (import, timeline, analyze, export, sessions, search).

## Part 2: Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` directory inside this repository
5. The Workflow Scout icon should appear in your extensions toolbar

### Using the extension

1. Click the Workflow Scout icon in your toolbar
2. Enter a session name (or leave blank for auto-generated)
3. Click **Start Recording**
4. Browse normally -- navigations, clicks, and form submissions are captured
5. Click the extension icon again and press **Stop**
6. Click **Export JSON** to download the recorded events

## Part 3: Analyze and Export

```bash
# Import the exported JSON file
npx workflow-scout import ~/Downloads/workflow-scout-export-*.json

# View the event timeline
npx workflow-scout timeline

# Detect repeated patterns
npx workflow-scout analyze

# Export a detected pattern as an n8n workflow
npx workflow-scout export pat_1

# The output file (workflow-pat_1.json) can be imported directly into n8n
```

## Part 4: Import into n8n

1. Open your n8n instance (local or cloud)
2. Go to **Workflows**
3. Click the **...** menu and select **Import from File**
4. Choose the exported `workflow-pat_1.json` file
5. Review and adjust the generated nodes (URLs, credentials, etc.)
6. Activate the workflow

## Tips

- **Custom database path**: Use `--db /path/to/file.db` to store events in a specific location
- **Session filtering**: Use `-s <session-id>` with timeline/analyze to focus on one session
- **Pattern tuning**: Adjust `--min-length`, `--max-length`, and `--min-freq` when running analyze
- **Webhook trigger**: Use `--webhook` with export to generate a webhook-triggered workflow instead of a schedule

## Troubleshooting

**Extension not recording events**
- Make sure you clicked "Start Recording" in the popup
- Check that the extension has permissions for the sites you are visiting
- Look at `chrome://extensions/` for any error messages on the extension card

**No patterns detected**
- You need at least 2 repetitions of the same sequence
- Try lowering `--min-freq 2` (this is the default)
- Make sure you performed the same workflow multiple times during recording

**SQLite errors on install**
- `better-sqlite3` needs to compile a native module. Ensure you have build tools:
  - macOS: `xcode-select --install`
  - Ubuntu: `sudo apt install build-essential python3`
  - Windows: install Visual Studio Build Tools
