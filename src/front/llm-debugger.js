// src/frontend/llm-debugger.js
(function () {
    // Parse query parameters from script src
    const scriptTag = document.currentScript || document.querySelector('script[src*="llm-debugger.js"]');
    const urlParams = new URLSearchParams(scriptTag.src.split('?')[1] || '');
    const autoStart = urlParams.get('auto_start') === 'true';
    const bufferSize = parseInt(urlParams.get('buffer_size') || '150', 10) * 1024; // Default 150KB
    const endpoint = 'http://localhost:3006/logs';
    const levelParam = (urlParams.get('level') || 'ERROR,WARNING,DEBUG').toUpperCase().split(',');
  
    // Valid log levels and their mapping to console methods
    const logLevels = {
      DEBUG: 'log',
      WARNING: 'warn',
      ERROR: 'error'
    };
    const enabledLevels = new Set(levelParam.filter(level => logLevels[level]));
  
    // Buffer for logs
    let logBuffer = [];
    let currentBufferSize = 0;
  
    // Original console methods
    const originalMethods = {
      log: console.log,
      warn: console.warn,
      error: console.error
    };
  
    // Function to send logs to backend
    function sendLogs() {
      if (logBuffer.length === 0) return;
      const payload = { messages: logBuffer };
      const payloadString = JSON.stringify(payload);
      fetch(endpoint, {
        method: 'POST',
        body: payloadString,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true
      }).catch(() => {}); // Silent failure
      logBuffer = [];
      currentBufferSize = 0;
    }
  
    // Generic log handler
    function createLogHandler(level) {
      return function (...args) {
        if (!enabledLevels.has(level)) return; // Skip if level isn’t enabled
        const message = args.map(arg => String(arg)).join(' ');
        const entry = { message, level, timestamp: new Date().toISOString() };
        const entrySize = new TextEncoder().encode(JSON.stringify(entry)).length;
  
        if (currentBufferSize + entrySize > bufferSize) {
          sendLogs(); // Flush buffer if it exceeds size
        }
  
        logBuffer.push(entry);
        currentBufferSize += entrySize;
  
        originalMethods[logLevels[level]].apply(console, args); // Call original method
      };
    }
  
    // Override console methods
    console.log = createLogHandler('DEBUG');
    console.warn = createLogHandler('WARNING');
    console.error = createLogHandler('ERROR');
  
    // Auto-start if specified
    if (autoStart) {
      setInterval(sendLogs, 5000); // Send every 5 seconds
    }
  
    // Expose manual flush method
    window.LLMDebugger = { flush: sendLogs };
  })();