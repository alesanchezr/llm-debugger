// src/front/console_sniffer.js

// Helper to parse stack trace - very basic, targets common formats
function parseStackForLocation(stack) {
    if (!stack) return null;

    const lines = stack.split('\\n');
    // Try to find the first line that doesn't refer to the sniffer itself
    // This index might need adjustment based on browser/call stack depth
    let relevantLine = null;
    for (let i = 2; i < lines.length; i++) {
         if (lines[i] && !lines[i].includes('llm-debugger') && !lines[i].includes('createLogHandler')) {
            relevantLine = lines[i];
            break;
         }
    }


    if (!relevantLine) {
        // Fallback if specific filtering fails, might point to sniffer internals
        relevantLine = lines[2] || lines[1]; // Often the 3rd line is the caller
    }


    if (!relevantLine) return null;

    // Attempt to extract file and line number using regex for common formats
    // Format: "at functionName (filePath:line:column)" or "functionName@filePath:line:column"
    const match = relevantLine.match(/(?:at |@)?(?:.*?[(]?)([^() ]+):(\d+):(\d+)[)]?/);

    if (match && match[1] && match[2]) {
      // Basic cleanup for file path (remove query strings, etc.)
      const filePath = match[1].split('?')[0];
      // Try to get a shorter path relative to the origin
      let fileName = filePath;
      try {
          const url = new URL(filePath);
          if (window.location && url.origin === window.location.origin) {
              fileName = url.pathname;
          }
      } catch (e) { /* Ignore if not a valid URL or if window not defined (e.g., during build) */ }

      return {
        file: fileName || match[1], // Use cleaned path or original match
        line: parseInt(match[2], 10),
        // column: parseInt(match[3], 10) // Column is available if needed
      };
    }
    
    // Fallback for other potential formats or if regex fails
    const parts = relevantLine.trim().split(':');
    if (parts.length >= 3) {
        const line = parseInt(parts[parts.length - 2], 10);
        const file = parts.slice(0, parts.length - 2).join(':').split(' ').pop();
         if (file && !isNaN(line)) {
             return { file: file, line: line };
         }
    }


    return null; // Could not parse
}

// Export the main function
export function createConsoleSniffer(config, logCallback) {
    const { enabledLevels } = config;
    const logLevels = { DEBUG: 'log', WARNING: 'warn', ERROR: 'error' };
    const originalMethods = { log: console.log, warn: console.warn, error: console.error };
    let isActive = false;

    function createLogHandler(level) {
        return function (...args) {
             // --- Get stack trace ---
             let location = null;
             try {
               const err = new Error();
               location = parseStackForLocation(err.stack);
             } catch (e) {
                 // Failed to get or parse stack
             }
             // --- End stack trace ---
            
            const upperLevel = level.toUpperCase();
            // If not active, just call original method
            if (!isActive || !enabledLevels.has(upperLevel)) {
                return originalMethods[logLevels[upperLevel]]?.apply(console, args);
            }

            // Format message (handle various argument types)
            const messageParts = args.map(arg => {
              try {
                if (arg instanceof Error) return arg.stack || arg.message;
                if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg);
                return String(arg);
              } catch (e) { return `[Unserializable argument: ${e.message}]`; }
            });
            const message = messageParts.join(' ');
            const entry = {
                message, level: upperLevel, timestamp: new Date().toISOString(), type: 'console',
                file: location?.file || null, line: location?.line || null
            };
            logCallback(entry); // Log first
            originalMethods[logLevels[upperLevel]]?.apply(console, args); // Then call original
        };
    }

    function start() {
        if (isActive) return;
        isActive = true;
        console.log = createLogHandler('DEBUG');
        console.warn = createLogHandler('WARNING');
        console.error = createLogHandler('ERROR');
    }

    function stop() {
        if (!isActive) return;
        isActive = false; // Deactivate logging first
        console.log = originalMethods.log;
        console.warn = originalMethods.warn;
        console.error = originalMethods.error;
    }

    return {
        start,
        stop,
        originalMethods // Expose original methods
    };
} 