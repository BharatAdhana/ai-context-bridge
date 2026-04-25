# aibridge-context

`aibridge-context` is a zero-config CLI and Node.js library that turns a project into an AI-readable workspace. It maintains a live `.ai-context/` folder, serves it locally, and can optionally sync context updates through git.

Think of it as Git for AI context.

## Features

- Zero-config startup for Node.js projects
- Debounced file watching powered by `chokidar`
- Atomic writes to avoid corrupted JSON files
- Local Express server for AI-friendly endpoints
- Optional git auto-sync for `.ai-context/*`
- Library exports for embedding in other tooling

## Install

```bash
npm install
```

To use the local CLI in this repository:

```bash
npx aibridge init
npx aibridge start
```

If published to npm, the package exposes the `aibridge` binary.

`ai-context` is supported as a legacy alias.

## Commands

### `aibridge init`

Creates `.ai-context/` and writes:

- `state.json`
- `brain.txt`
- `context.md`
- `changelog.json`
- `config.json`

### `aibridge start`

Starts:

- A debounced file watcher
- A local Express server
- Automatic state updates on add/change/delete events

Default server port: `3333`

### `aibridge update`

Triggers a manual context refresh and optional git sync.

## Generated files

### `.ai-context/state.json`

Tracks:

- project name
- version
- last update time
- change statistics
- recent updates
- project features
- next steps

### `.ai-context/brain.txt`

Provides instructions any AI assistant should follow before responding.

### `.ai-context/context.md`

Stores a human-readable summary including:

- project purpose
- detected stack
- AI usage guidance

### `.ai-context/changelog.json`

Stores historical change entries captured by the watcher.

### `.ai-context/config.json`

Default configuration:

```json
{
  "port": 3333,
  "debounceMs": 600,
  "gitSync": {
    "enabled": false,
    "push": true,
    "commitMessage": "auto: update AI context"
  }
}
```

## HTTP endpoints

When `aibridge start` is running:

- `GET /state.json`
- `GET /brain.txt`
- `GET /context.md`
- `GET /changelog.json`

## Example usage

```bash
npx aibridge init
npx aibridge start
```

Then point your AI tool to:

- `http://localhost:3333/state.json`
- `http://localhost:3333/context.md`
- `http://localhost:3333/changelog.json`
- `http://localhost:3333/brain.txt`

## Git sync

Git sync is optional and controlled by `.ai-context/config.json`.

Enable it like this:

```json
{
  "gitSync": {
    "enabled": true,
    "push": true,
    "commitMessage": "auto: update AI context"
  }
}
```

On every successful update, the tool will attempt to:

```bash
git add .ai-context
git commit -m "auto: update AI context"
git push
```

Failures are handled gracefully and will not stop the watcher or server.

## Library usage

```js
const {
  initProject,
  startWatcher,
  updateProjectState,
  startServer,
  syncContextToGit
} = require('aibridge-context');
```

## Development notes

- CommonJS is used for simplicity and broad compatibility.
- The watcher ignores `node_modules`, `.git`, and `.ai-context`.
- Writes are atomic via temporary-file rename.
- Updates are debounced to reduce noisy file churn.
