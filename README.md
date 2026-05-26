# Workflow

A local Markdown reading workspace with:

- directory-based Markdown browsing
- recent updates and tree navigation
- HTML preview for raw Markdown
- document outline and reading controls
- optional AI reading mode powered by local `codex exec`

## Files

- `index.html`: frontend UI for browsing and reading Markdown files
- `server.mjs`: local Node server for static hosting and AI reading API
- `ai-reading-schema.json`: JSON schema for structured AI reading output
- `package.json`: local start script

## Run

```bash
npm run start
```

Open:

```text
http://localhost:4173/
```

## Features

- Select a local directory and scan `.md` / `.markdown` files
- Show recently updated files and original tree structure
- Keep the sidebar fixed while reading
- Provide top/bottom reading shortcuts
- Generate an AI reading version in the background
- Auto-refresh directory contents on an interval and when the window regains focus

## AI Reading Mode

The AI reading view is generated through the local Codex CLI instead of a browser API key.

Flow:

1. Frontend sends the current file path and Markdown content to `/api/ai-read`
2. `server.mjs` calls `codex exec`
3. Codex returns structured JSON that matches `ai-reading-schema.json`
4. The frontend renders the result with a fixed HTML template

## Notes

- Directory access depends on the File System Access API, so Chrome or Edge is recommended.
- The AI reading feature depends on a working local `codex exec` environment.
- If Codex generation fails, the UI keeps the raw view available and surfaces a retryable error state.
