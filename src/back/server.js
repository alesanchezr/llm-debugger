#!/usr/bin/env node
// src/backend/server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3006;
app.use(express.json());
app.use(cors());

// Parse command-line arguments
const args = process.argv.slice(2);
const command = args[0];
let logFilePath = path.join(process.cwd(), 'llm-debugger-logs.txt');
const logFileIndex = args.indexOf('--log-file');
if (logFileIndex !== -1 && logFileIndex + 1 < args.length) {
  logFilePath = path.resolve(args[logFileIndex + 1]);
}

const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
logStream.on('error', err => console.error('Stream error:', err));

app.post('/logs', (req, res) => {
  const messages = Array.isArray(req.body.messages) ? req.body.messages : [req.body];
  messages.forEach(({ message, level = 'DEBUG', timestamp }) => {
    const logEntry = `[${timestamp}] ${level.toUpperCase()}: ${message}\n`;
    logStream.write(logEntry, err => {
      if (err) console.error('Write failed:', err);
    });
  });
  res.sendStatus(200);
});

// Start server if command is 'start' or no command is given
if (!command || command === 'start') {
  app.listen(port, () => {
    console.log(`LLM Debugger server running on http://localhost:${port}`);
    console.log(`Logs will be saved to: ${logFilePath}`);
  });
} else {
  console.log('Usage: npx @alesanchezr/llm-debugger [start] [--log-file <path>]');
}

process.on('SIGINT', () => {
  logStream.end(() => {
    console.log('Log stream closed');
    process.exit(0);
  });
});