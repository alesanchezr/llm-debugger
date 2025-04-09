# LLM Debugger

Capture frontend console logs, network requests (fetch), and **check the status of script/stylesheet links** and stream them to a local server. The server saves these logs to a file (`llm-debugger-logs.txt` by default) for easy inclusion as context in LLMs (like Cursor, Copilot, etc.) or for general debugging.

- **Console Logging**: Capture all console output with file and line numbers
- **Network Monitoring**: Track fetch requests and responses
- **Resource Checking**: Automatically detect failed script and stylesheet loads
- **Error Tracking**: Capture uncaught errors and unhandled promise rejections with stack traces
- **LLM-Friendly Format**: Logs are saved in a clean, human-readable text format
- **Zero Configuration**: Works out of the box with sensible defaults

## Quick Usage (2 steps)

1. Run the server that will create and sync the `llm-debugger-logs.txt` file:

```bash
npx @alesanchezr/llm-debugger start
```

2. Add these two script tags to your HTML `<head>` opening and closing tags:

```html
<!-- Configure LLM Debugger -->
<script>
    window.LLM_DEBUGGER_CONFIG = {
        sniffers: ['console', 'fetch', 'resourceCheck'],
        endpoint: 'http://localhost:3006/logs'
    };
</script>

<!-- Initialize LLM Debugger -->
<script src="https://cdn.jsdelivr.net/npm/@alesanchezr/llm-debugger@latest/dist/llm-debugger.bundle.js"></script>
```

That's it! The debugger will start automatically and begin collecting:
- Console logs (log, warn, error)
- Network requests and responses
- Failed script and stylesheet loads
- JavaScript errors with stack traces
- Unhandled promise rejections


## Advanced Configuration

Customize the debugger's behavior using these options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sniffers` | Array/String | `['console', 'fetch', 'resourceCheck']` | What to monitor |
| `logLevel` | String | `'info'` | Minimum log level to capture |
| `autoStart` | Boolean | `true` | Start automatically |
| `endpoint` | String | `'http://localhost:3006/logs'` | Where to send logs |
| `bufferSize` | Number | `150 * 1024` | Max log buffer size (150KB) |
| `sendInterval` | Number | `5000` | How often to send logs (ms) |

## Examples

### Basic Usage
```html
<script>
    window.LLM_DEBUGGER_CONFIG = {
        sniffers: ['console', 'fetch']
    };
</script>
<script src="https://cdn.jsdelivr.net/npm/@alesanchezr/llm-debugger@latest/dist/llm-debugger.bundle.js"></script>
```

### Advanced Configuration
```html
<script>
    window.LLM_DEBUGGER_CONFIG = {
        sniffers: ['console', 'resourceCheck'],
        logLevel: 'error',
        endpoint: 'https://your-log-server.com/logs',
        bufferSize: 300 * 1024,
        sendInterval: 10000
    };
</script>
<script src="https://cdn.jsdelivr.net/npm/@alesanchezr/llm-debugger@latest/dist/llm-debugger.bundle.js"></script>
```

## Log Format

Logs are saved in a clean, human-readable text format:

```
[2024-03-14T12:34:56.789Z] CONSOLE DEBUG: This is a debug message in app.js:42
[2024-03-14T12:34:57.123Z] NETWORK: GET https://api.example.com/data (200 OK)
[2024-03-14T12:34:58.456Z] RESOURCE: Failed to load script https://example.com/missing.js (404 Not Found)
[2024-03-14T12:34:59.789Z] UNCAUGHT ERROR: Cannot read property 'x' of undefined in app.js:15:10
Stack trace:
TypeError: Cannot read property 'x' of undefined
    at foo (app.js:15:10)
    at bar (app.js:10:5)
    at app.js:5:3
[2024-03-14T12:35:00.123Z] UNHANDLED PROMISE REJECTION: Promise was rejected
Stack trace:
Error: Operation failed
    at asyncFunction (app.js:25:10)
    at app.js:20:5
```

## Development and contributions

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

## Demo

Try the demo in the `demo` directory:
1. Build the debugger: `npm run build`
2. Serve the demo directory
3. Open the browser console to see the debugger in action

## License

MIT 
