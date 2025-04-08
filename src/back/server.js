#!/usr/bin/env node
// src/backend/server.js
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Needed for __dirname equivalent if required

// Replicate __dirname if needed later (not strictly necessary for current code)
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

const app = express();
const port = 3006;
app.use(express.json());

// Configure CORS to allow specific origin and credentials
app.use(cors({
  origin: true, // Reflect the request origin
  credentials: true
}));

// Parse command-line arguments (process.argv works fine in ES modules)
const args = process.argv.slice(2);
const command = args[0];
let logFilePath = path.join(process.cwd(), 'llm-debugger-logs.txt');
const logFileIndex = args.indexOf('--log-file');
if (logFileIndex !== -1 && logFileIndex + 1 < args.length) {
  logFilePath = path.resolve(args[logFileIndex + 1]);
}

// Ensure log directory and file exist before creating stream/watcher
try {
    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    // Touch the file to ensure it exists
    if (!fs.existsSync(logFilePath)) {
      fs.closeSync(fs.openSync(logFilePath, 'w'));
    }
} catch (err) {
    console.error(`Error ensuring log file exists: ${err.message}`);
    process.exit(1); // Exit if we can't ensure log file creation
}

const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
logStream.on('error', err => console.error('Log stream error:', err));

// --- Node.js File Tailing Logic ---
let watchingFile = false;
let lastReadSize = 0;
let fileWatcher = null; // To store the watcher instance

const startFileTailing = () => {
    if (watchingFile) return;
    try {
        // Get initial size
        const stats = fs.statSync(logFilePath);
        lastReadSize = stats.size;
        watchingFile = true;
        console.log('--- Tailing log file (using Node.js fs.watchFile) ---');

        // Define the listener function separately to unwatch later
        const watchListener = (curr, prev) => {
            if (curr.size > lastReadSize) {
                // File grew, read the new part
                const stream = fs.createReadStream(logFilePath, {
                    start: lastReadSize,
                    end: curr.size -1 // end is inclusive
                });
                stream.pipe(process.stdout);
                lastReadSize = curr.size;
            } else if (curr.size < lastReadSize) {
                // File was likely truncated or replaced
                console.log('\n--- Log file truncated. Resetting tail position. ---\n');
                lastReadSize = 0; // Reset position
                // Optionally: Read the whole file content now
                // fs.createReadStream(logFilePath).pipe(process.stdout);
            }
            // If size is the same, do nothing
        };

        // Start watching (polling interval default is usually fine, or specify e.g., 500ms)
        fs.watchFile(logFilePath, { persistent: true, interval: 500 }, watchListener);

        // Store the listener reference for cleanup
        fileWatcher = watchListener;

    } catch (err) {
        console.error(`\n--- Error starting file tailing: ${err.message} ---`);
        watchingFile = false;
    }
};

const stopFileTailing = () => {
    if (watchingFile && fileWatcher) {
        console.log('Stopping file watcher...');
        fs.unwatchFile(logFilePath, fileWatcher);
        watchingFile = false;
        fileWatcher = null;
    }
};
// --- End Node.js File Tailing Logic ---

app.post('/logs', (req, res) => {
  const messages = req.body && Array.isArray(req.body.messages) ? req.body.messages : [];
  if (messages.length === 0) {
    console.warn('Received request with no messages or invalid format');
    return res.sendStatus(200);
  }
  messages.forEach((logObject) => {
    if (typeof logObject === 'object' && logObject !== null) {
      try {
        const logEntry = JSON.stringify(logObject) + '\n';
        logStream.write(logEntry, (err) => {
          if (err) console.error('Log write failed:', err);
        });
      } catch (stringifyError) {
        console.error('Failed to stringify log object:', stringifyError, logObject);
        const fallbackEntry = `[${new Date().toISOString()}] ERROR: Failed to process log entry: ${stringifyError.message}\n`;
        logStream.write(fallbackEntry);
      }
    } else {
        console.warn('Received non-object item in messages array:', logObject);
        const fallbackEntry = `[${new Date().toISOString()}] WARN: Received invalid log entry type: ${typeof logObject}\n`;
        logStream.write(fallbackEntry);
    }
  });
  res.sendStatus(200);
});

if (!command || command === 'start') {
  app.listen(port, () => {
    console.log(`LLM Debugger server running on http://localhost:${port}`);
    console.log(`Logs will be saved to: ${logFilePath}`);
    // Remove old tail logic
    // console.log('--- Tailing log file ---');
    // Start the new file tailing
    startFileTailing();
  });
} else {
  console.log('Usage: npx @alesanchezr/llm-debugger [start] [--log-file <path>]');
}

process.on('SIGINT', () => {
  console.log('\nSIGINT received. Shutting down...');
  // Stop the file watcher first
  stopFileTailing();

  // Then close the log stream
  // Add a small delay for safety? Might not be needed.
  logStream.end(() => {
    console.log('Log stream closed.');
    process.exit(0);
  });

  // Force exit if stream doesn't close quickly
  setTimeout(() => {
      console.warn('Log stream did not close in time, forcing exit.');
      process.exit(1);
  }, 2000);
});