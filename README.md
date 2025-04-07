# LLM Debugger

A tool to debug console logs by sending them to a local server and saving them to a file. This package is particularly useful for debugging LLM (Large Language Model) applications and other JavaScript applications where you need to capture and analyze console output.

## Usage

### 1. Start the Debug Server

First, start the debug server in your terminal:

```bash
npx @alesanchezr/llm-debugger start
```

### 2. Include the Debugger in Your Web Application

Add the following script tag inside your HTML `<head>` file:

```html
<script src="llm-debugger.js?auto_start=true&buffer_size=200&level=ERROR,WARNING,DEBUG"></script>
```

You can configure the debugger using URL parameters::

- `auto_start`: Set to `true` to automatically send logs every 5 seconds (default: `false`)
- `buffer_size`: Buffer size in KB (default: `150`)
- `level`: Comma-separated list of log levels to capture (default: `ERROR,WARNING,DEBUG`)

### 4. Using the Debugger

Once included, the debugger will automatically intercept console logs. You can use the console as normal:

```javascript
console.log("This is a debug message");
console.warn("This is a warning");
console.error("This is an error");
```

To manually flush the log buffer:

```javascript
window.LLMDebugger.flush();
```

## Log Format

Logs are saved in the following format:

```
[timestamp] LEVEL: message
```

Example:

```
[2024-04-07T19:50:00.000Z] DEBUG: This is a debug message
[2024-04-07T19:50:01.000Z] WARNING: This is a warning
[2024-04-07T19:50:02.000Z] ERROR: This is an error
```

## Custom Log File Path

By default, logs will be saved to `llm-debugger-logs.txt` in your current directory. You can specify a custom log file path:

```bash
npx @alesanchezr/llm-debugger start --log-file /path/to/your/logs.txt
```

## Features

- Automatic log buffering to prevent overwhelming the server
- Configurable log levels (DEBUG, WARNING, ERROR)
- Customizable buffer size
- Automatic or manual log flushing
- Persistent log storage to file
- CORS support for cross-origin requests

## License

MIT 
