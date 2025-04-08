# LLM Debugger

Capture frontend console logs, network requests (fetch), and **check the status of script/stylesheet links** and stream them to a local server. The server saves these logs to a file (`llm-debugger-logs.txt` by default) for easy inclusion as context in LLMs (like Cursor, Copilot, etc.) or for general debugging.

This tool helps bridge the gap between frontend runtime behavior and backend/LLM analysis.

## Quick Usage

### 1. Start the Debug Server

In your project's terminal, run the server using `npx`. This command downloads and runs the server package without needing a local installation.

```bash
# Start the server, logs saved to ./llm-debugger-logs.txt
npx @alesanchezr/llm-debugger start

# Or specify a custom log file path:
npx @alesanchezr/llm-debugger start --log-file ./path/to/your-logs.txt
```

- The server will start on `http://localhost:3006`.
- It will print the location of the log file.
- It will begin tailing the log file to the terminal.
- Keep this terminal running while you debug your application.

### 2. Include the Debugger Script via CDN

Add the following script tag to your HTML file (ideally within the `<head>` or near the end of `<body>`).

```html
<!-- Replace LATEST_VERSION with the desired version number, e.g., 1.0.0 -->
<script src="https://cdn.jsdelivr.net/npm/@alesanchezr/llm-debugger@LATEST_VERSION/dist/llm-debugger.bundle.js?auto_start=true&level=DEBUG,WARNING,ERROR&sniffers=console,fetch,resourceCheck"></script>
```

*(You can also use unpkg: `https://unpkg.com/@alesanchezr/llm-debugger@LATEST_VERSION/dist/llm-debugger.bundle.js`)*

### 3. Configure via URL Parameters

Append query parameters to the script's `src` URL in the HTML tag:

- `auto_start` (default: `true`): Automatically start logging and sending periodically when the script loads.
- `buffer_size` (default: `150`): Max buffer size in KB before logs are sent.
- `level` (default: `ERROR,WARNING,DEBUG`): Comma-separated console log levels to capture.
- `sniffers` (default: `console,fetch,resourceCheck`): Comma-separated list of sniffers to enable (`console`, `fetch`, `resourceCheck`).
- `endpoint` (default: `http://localhost:3006/logs`): The URL of the local debug server endpoint.
- `send_interval` (default: `5000`): Interval in milliseconds to send logs if `auto_start` is true.

Example:

```html
<script src="https://cdn.jsdelivr.net/npm/@alesanchezr/llm-debugger@latest/dist/llm-debugger.bundle.js?buffer_size=50&level=ERROR&sniffers=console,resourceCheck&send_interval=10000"></script>
```

### 4. Use Your Application

As you use your application:
- Console logs, fetch requests, and failed script/stylesheet loads matching the configuration will be captured.
- Shortly after load, `HEAD` requests will check script/stylesheet links, logging any failures (4xx, 5xx, Network/CORS errors).
- Logs will be sent to the local server and appear in the terminal running the server and in the specified log file.

### 5. Manual Control

You can manually control the debugger via the global `window.LLMDebugger` object (especially if `auto_start=false`):

```javascript
// Start capturing and sending logs
window.LLMDebugger.start();

// Manually send any logs currently in the buffer
window.LLMDebugger.flush();

// Stop capturing and sending logs
window.LLMDebugger.stop();
```

## Log Format

Logs are saved to the file as **newline-delimited JSON objects**. Each object represents a single log event.

Example log file content:

```json
{"message":"This is a debug message.","level":"DEBUG","timestamp":"2024-05-17T10:00:01.123Z","type":"console","file":"/app.js","line":45}
{"timestamp":"2024-05-17T10:00:05.456Z","type":"network","subType":"fetch_request","method":"GET","url":"https://api.example.com/data","requestBody":null}
{"timestamp":"2024-05-17T10:00:05.789Z","type":"network","subType":"fetch_response","method":"GET","url":"https://api.example.com/data","responseStatus":200,"responseBody":{"status":"ok"}}
{"timestamp":"2024-05-17T10:00:00.600Z","type":"resourceCheck","subType":"failed","tagName":"LINK","url":"https://your-app.com/assets/missing.css","status":404}
{"timestamp":"2024-05-17T10:00:00.605Z","type":"resourceCheck","subType":"error","tagName":"SCRIPT","url":"https://cors-blocked.com/script.js","status":"Network/CORS Error","error":"Failed to fetch"}
```

## Features

- **Console Interception:** Captures `console.log`, `console.warn`, `console.error` with timestamps, levels, messages, and source file/line numbers (best effort).
- **Fetch Interception:** Logs outgoing `fetch` requests and their corresponding responses (status, body snippets based on content type).
- **Resource Link Checking:** Performs `HEAD` requests on `<script src="...">` and `<link rel="stylesheet" href="...">` URLs shortly after load to check their HTTP status (logs 4xx/5xx errors or network/CORS failures).
- **Local Log Server:** A simple Node.js server (run via `npx`) receives logs from the frontend.
- **File Logging:** Saves received logs as newline-delimited JSON objects to a local file.
- **Live Log Tailing:** The server automatically tails the log file to the console it's running in (cross-platform).
- **Configurable:** Control log levels, buffer size, enabled sniffers, send interval, and server endpoint via URL parameters in the script tag.
- **Buffering:** Logs are buffered on the frontend and sent periodically or when the buffer fills.
- **CORS Handling:** Server is configured to handle requests from different frontend origins.

## License

MIT 
