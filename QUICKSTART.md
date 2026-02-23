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

You should see the list of available commands (import, timeline, analyze, export, sessions, search, tag, untag, clean-cache).

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
5. The popup shows live stats: event count, navigation/click/form breakdowns, and recording duration
6. Click the extension icon again and press **Stop**
7. Click **Export JSON** to download the recorded events

### Privacy

Workflow Scout automatically redacts sensitive data:
- Password fields
- Credit card numbers
- Social security numbers
- API keys and tokens (Stripe, GitHub, JWT)

## Part 3: Analyze and Export

```bash
# Import the exported JSON file
npx workflow-scout import ~/Downloads/workflow-scout-export-*.json

# Tag the session for organization
npx workflow-scout tag sess_1234567890 checkout-flow

# View the event timeline
npx workflow-scout timeline

# Detect repeated patterns (auto-tune finds the best parameters)
npx workflow-scout analyze --auto-tune

# Or analyze only tagged sessions
npx workflow-scout analyze --tag checkout-flow

# Preview a workflow before exporting
npx workflow-scout export pat_1 --dry-run

# Export in your preferred format
npx workflow-scout export pat_1 --format n8n
npx workflow-scout export pat_1 --format playwright
npx workflow-scout export pat_1 --format zapier
```

## Part 4: Use the Exported Workflow

### n8n
1. Open your n8n instance (local or cloud)
2. Go to **Workflows**
3. Click the **...** menu and select **Import from File**
4. Choose the exported `workflow-pat_1.json` file
5. Review and adjust the generated nodes (URLs, credentials, etc.)
6. Activate the workflow

### Playwright
1. Install Playwright: `npm install playwright`
2. Run the generated script: `npx tsx workflow-pat_1.ts`
3. Or use the test format: `npx playwright test workflow-pat_1.spec.ts`

### Zapier
1. Open the exported `.zapier.json` file as a reference
2. Create a new Zap in Zapier following the trigger/action structure
3. Map the webhook URLs and form fields as specified

## Tips

- **Custom database path**: Use `--db /path/to/file.db` to store events in a specific location
- **Session filtering**: Use `-s <session-id>` or `-t <tag>` with timeline/analyze to focus on specific sessions
- **Pattern tuning**: Use `--auto-tune` for automatic parameter selection, or manually set `--min-length`, `--max-length`, and `--min-freq`
- **Webhook trigger**: Use `--webhook` with n8n export to generate a webhook-triggered workflow
- **Search limit**: Use `--limit` with search to control result count (default: 200)
- **Clean up**: Use `clean-cache` to remove stale pattern analysis data

## Troubleshooting

**Extension not recording events**
- Make sure you clicked "Start Recording" in the popup
- Check that the extension has permissions for the sites you are visiting
- Look at `chrome://extensions/` for any error messages on the extension card

**No patterns detected**
- You need at least 2 repetitions of the same sequence
- Try using `--auto-tune` to find optimal parameters
- Try lowering `--min-freq 2` (this is the default)
- Make sure you performed the same workflow multiple times during recording

**Import validation warnings**
- Events with unrecognized types or missing URLs are skipped with a warning
- Check that your JSON export is a valid array of event objects

**SQLite errors on install**
- `better-sqlite3` needs to compile a native module. Ensure you have build tools:
  - macOS: `xcode-select --install`
  - Ubuntu: `sudo apt install build-essential python3`
  - Windows: install Visual Studio Build Tools
