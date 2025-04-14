// src/front/console_sniffer.js

// Helper to parse stack trace - very basic, targets common formats
function parseStackForLocation(stack) {
    if (!stack) return null;
    const lines = stack.split('\\n');
    let relevantLine = null;
    
    // Skip debugger frames to find the actual caller
    const skipPatterns = [
        'llm-debugger.js', 
        'createLogHandler',
        'at console.log',
        'at console.warn',
        'at console.error'
    ];
    
    // Find the first line that doesn't match any skip patterns
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        
        // Skip internal debugger frames
        let shouldSkip = false;
        for (const pattern of skipPatterns) {
            if (lines[i].includes(pattern)) {
                shouldSkip = true;
                break;
            }
        }
        
        if (!shouldSkip) {
            relevantLine = lines[i];
            break;
        }
    }
    
    // Fallback to first non-empty line if all were skipped
    if (!relevantLine) {
        for (let i = 1; i < lines.length; i++) {
            if (lines[i] && lines[i].trim()) {
                relevantLine = lines[i];
                break;
            }
        }
    }
    
    // Last fallback - just use line 1 or 2
    if (!relevantLine) relevantLine = lines[2] || lines[1];
    if (!relevantLine) return null;
    
    // Try to parse the line
    const match = relevantLine.match(/(?:at |@)?(?:.*?[(]?)([^() ]+):(\d+):(\d+)[)]?/);
    if (match && match[1] && match[2]) {
        const filePath = match[1].split('?')[0];
        let fileName = filePath;
        try {
            const url = new URL(filePath);
            if (window.location && url.origin === window.location.origin) fileName = url.pathname;
        } catch (e) { /* Ignore */ }
        return { 
            file: fileName || match[1], 
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10) 
        };
    }
    
    // Alternative format (older browsers or different formats)
    const parts = relevantLine.trim().split(':');
    if (parts.length >= 3) {
        const line = parseInt(parts[parts.length - 2], 10);
        const column = parseInt(parts[parts.length - 1], 10);
        const file = parts.slice(0, parts.length - 2).join(':').split(' ').pop();
        if (file && !isNaN(line)) {
            return { 
                file: file, 
                line: line,
                column: isNaN(column) ? 0 : column
            };
        }
    }
    
    return null;
}

// Export the main function
export function createConsoleSniffer(config, logCallback) {
    const { enabledLevels } = config;
    const logLevels = { DEBUG: 'log', WARNING: 'warn', ERROR: 'error', INFO: 'log' };
    const originalMethods = { log: console.log, warn: console.warn, error: console.error };
    let isActive = false;
    originalMethods.log('Logging for enabledLevels:', config);

    function createLogHandler(level) {
        const originalMethod = originalMethods[logLevels[level.toUpperCase()]];
        // Use original group methods to avoid recursion if console itself is logged
        const groupMethod = originalMethods.log; // Or decide based on level
        const groupEndMethod = originalMethods.log; // Doesn't really matter
        
        return function (...args) {
            // Get stack trace early to determine origin
            let location = null;
            try {
                const error = new Error();
                location = parseStackForLocation(error.stack);
            } catch (e) {
                // Ignore parsing errors here, will be handled later if needed
            }

            // Start a collapsed group showing the origin, if found
            if (location) {
                // Use original console.log to start the group to avoid recursion
                originalMethods.log.call(console, `--- Group Logged From: ${location.file}:${location.line} ---`); 
                // Using a simple log message instead of groupCollapsed for wider compatibility 
                // and less potential interference. 
            }
            
            // Always call the original method to preserve stack traces and output
            originalMethod.apply(console, args);

            // --- Logging logic (remains mostly the same) ---
            if (!isActive) return;
            
            const upperLevel = level.toUpperCase();
            
            if (!enabledLevels.has(upperLevel)) return;
            try {
                // We already tried getting location, reuse it if possible
                if (!location) { 
                    const error = new Error(); // Try again if failed initially?
                    location = parseStackForLocation(error.stack); 
                }
                
                const messageParts = args.map(arg => {
                    try {
                        if (arg instanceof Error) return arg.stack || arg.message;
                        if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg);
                        return String(arg);
                    } catch (e) { return `[Unserializable argument: ${e.message}]`; }
                });
                
                const message = messageParts.join(' ');
                const entry = {
                    message, 
                    level: upperLevel, 
                    timestamp: new Date().toISOString(), 
                    type: 'console',
                    file: location?.file || null, 
                    line: location?.line || null
                };
                
                logCallback(entry);
            } catch (err) { 
                // Fallback logging (as before)
                const messageParts = args.map(arg => {
                    try {
                        if (arg instanceof Error) return arg.stack || arg.message;
                        if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg);
                        return String(arg);
                    } catch (e) { return `[Unserializable argument: ${e.message}]`; }
                });
                const message = messageParts.join(' ');
                const entry = {
                    message, 
                    level: upperLevel, 
                    timestamp: new Date().toISOString(), 
                    type: 'console'
                };
                logCallback(entry);
                originalMethods.error.call(console, 'Error in LLM Debugger while logging console message:', err);
            }
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