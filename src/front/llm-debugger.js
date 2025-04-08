// src/frontend/llm-debugger.js
import { createConsoleSniffer } from './console_sniffer.js';
import { createFetchSniffer } from './fetch_sniffer.js';
// Import the resource checker initializer
import { initResourceCheck } from './test-scripts-and-styles.js';

// Main debugger logic wrapped in an IIFE to avoid polluting global scope unnecessarily
(function () {
    // --- Configuration Parsing ---
    const scriptTag = document.currentScript || document.querySelector('script[src*="llm-debugger.js"]');
    const urlParams = new URLSearchParams(scriptTag.src.split('?')[1] || '');
    const autoStart = urlParams.get('auto_start') !== 'false'; // Default true
    const bufferSize = parseInt(urlParams.get('buffer_size') || '150', 10) * 1024; // Default 150KB
    const endpoint = urlParams.get('endpoint') || 'http://localhost:3006/logs';
    const levelParam = (urlParams.get('level') || 'ERROR,WARNING,DEBUG').toUpperCase().split(',');
    const sniffersParam = (urlParams.get('sniffers') || 'console,fetch,resourceCheck').toLowerCase().split(',');
    const sendInterval = parseInt(urlParams.get('send_interval') || '5000', 10); // Default 5 seconds

    const enabledLevels = new Set(levelParam.filter(level => ['DEBUG', 'WARNING', 'ERROR'].includes(level)));
    const enabledSniffers = new Set(sniffersParam);

    // --- State ---
    let logBuffer = [];
    let currentBufferSize = 0;
    let sendIntervalId = null;
    let isRunning = false;
    let consoleSnifferInstance = null;
    let fetchSnifferInstance = null;

    // --- Global Error Handler for Resource Loading ---
    // Store the listener function reference for removal
    let resourceErrorListener = null;

    function setupResourceErrorMonitoring(logCallback) {
        resourceErrorListener = (event) => {
            if (event.target instanceof HTMLLinkElement || event.target instanceof HTMLScriptElement) {
                const target = event.target;
                const url = target.href || target.src;
                // Basic check to avoid logging errors for elements without src/href
                if (!url) return;

                const logEntry = {
                    timestamp: new Date().toISOString(),
                    type: 'resource',
                    subType: 'load_error',
                    tagName: target.tagName.toUpperCase(),
                    url: url,
                    // Note: Cannot reliably get HTTP status code here
                    message: `Failed to load resource: ${url}`
                };
                logCallback(logEntry);
                // Optional: Prevent duplicate logging if window.onerror also fires?
                // event.stopPropagation(); // Might interfere with other error handlers
            }
            // We don't handle other errors here, let them bubble or be caught elsewhere
        };
        // Use capture phase to catch errors early
        window.addEventListener('error', resourceErrorListener, true);
    }

    function removeResourceErrorMonitoring() {
        if (resourceErrorListener) {
            window.removeEventListener('error', resourceErrorListener, true);
            resourceErrorListener = null;
        }
    }
    // --- End Global Error Handler ---

    // === Embedded Console Sniffer Code ===
    // Helper to parse stack trace - very basic, targets common formats
    function parseStackForLocation(stack) {
        if (!stack) return null;
        const lines = stack.split('\\n');
        let relevantLine = null;
        for (let i = 2; i < lines.length; i++) {
            // Avoid referencing the current script name directly if possible
            if (lines[i] && !lines[i].includes('llm-debugger.js') && !lines[i].includes('createLogHandler') ) {
                relevantLine = lines[i];
                break;
            }
        }
        if (!relevantLine) relevantLine = lines[2] || lines[1];
        if (!relevantLine) return null;
        const match = relevantLine.match(/(?:at |@)?(?:.*?[(]?)([^() ]+):(\d+):(\d+)[)]?/);
        if (match && match[1] && match[2]) {
            const filePath = match[1].split('?')[0];
            let fileName = filePath;
            try {
                const url = new URL(filePath);
                if (url.origin === window.location.origin) fileName = url.pathname;
            } catch (e) { /* Ignore */ }
            return { file: fileName || match[1], line: parseInt(match[2], 10) };
        }
        const parts = relevantLine.trim().split(':');
        if (parts.length >= 3) {
            const line = parseInt(parts[parts.length - 2], 10);
            const file = parts.slice(0, parts.length - 2).join(':').split(' ').pop();
            if (file && !isNaN(line)) return { file: file, line: line };
        }
        return null;
    }

    function createConsoleSniffer(config, logCallback) {
        const { enabledLevels } = config;
        const logLevels = { DEBUG: 'log', WARNING: 'warn', ERROR: 'error' };
        const originalMethods = { log: console.log, warn: console.warn, error: console.error };
        let isActive = false;

        function createLogHandler(level) {
            return function (...args) {
                if (!isActive) return originalMethods[logLevels[level.toUpperCase()]]?.apply(console, args);
                let location = null;
                try {
                    location = parseStackForLocation(new Error().stack);
                } catch (e) { /* ignore */ }
                const upperLevel = level.toUpperCase();
                if (!enabledLevels.has(upperLevel)) return originalMethods[logLevels[upperLevel]]?.apply(console, args);
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
                logCallback(entry);
                originalMethods[logLevels[upperLevel]]?.apply(console, args);
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
        return { start, stop, originalMethods }; // Expose original methods if needed
    }
    // === End Embedded Console Sniffer Code ===

    // === Embedded Fetch Sniffer Code ===
    function createFetchSniffer(config, logCallback) {
        const originalFetch = window.fetch;
        let isActive = false;

        async function logAndFetch(...args) {
            if (!isActive) return originalFetch(...args);
            const [urlOrRequest, options] = args;
            const url = (typeof urlOrRequest === 'string') ? urlOrRequest : urlOrRequest.url;
            const method = options?.method || (typeof urlOrRequest === 'object' ? urlOrRequest.method : 'GET') || 'GET';
            const requestBody = options?.body || (typeof urlOrRequest === 'object' ? urlOrRequest.body : null);
            const timestamp = new Date().toISOString();
            const requestLog = {
                timestamp, type: 'network', subType: 'fetch_request', method: method.toUpperCase(),
                url: String(url), requestBody: null
            };
            if (requestBody instanceof Blob || requestBody instanceof ArrayBuffer || requestBody instanceof FormData || typeof requestBody === 'string') {
                requestLog.requestBody = `[Body type: ${requestBody.constructor.name}]`;
            }
            logCallback(requestLog);
            let response, responseStatus = null, responseBody = null;
            try {
                response = await originalFetch(...args);
                responseStatus = response.status;
                const responseClone = response.clone();
                const contentType = responseClone.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    try { responseBody = await responseClone.json(); } catch (e) { responseBody = '[Failed to parse JSON body]'; }
                } else if (contentType && (contentType.includes('text/') || contentType.includes('application/xml'))) {
                    try { responseBody = await responseClone.text(); } catch (e) { responseBody = '[Failed to read text body]'; }
                } else { responseBody = `[Unsupported content type: ${contentType}]`; }
            } catch (error) {
                responseStatus = 0;
                responseBody = { error: error.message, stack: error.stack };
                const errorLog = {
                    timestamp: new Date().toISOString(), type: 'network', subType: 'fetch_error',
                    method: method.toUpperCase(), url: String(url), error: error.message, stack: error.stack
                };
                logCallback(errorLog);
                throw error;
            }
            const responseLog = {
                timestamp: new Date().toISOString(), type: 'network', subType: 'fetch_response',
                method: method.toUpperCase(), url: String(url), responseStatus, responseBody
            };
            logCallback(responseLog);
            return response;
        }

        function start() {
            if (isActive) return;
            isActive = true;
            window.fetch = logAndFetch;
        }

        function stop() {
             if (!isActive) return;
             isActive = false;
             window.fetch = originalFetch;
        }
        return { start, stop };
    }
    // === End Embedded Fetch Sniffer Code ===

    // --- Logging & Buffering ---
    function addLogEntry(entry) {
        if (!isRunning) return; // Don't collect logs if not running

        const entryString = JSON.stringify(entry);
        const entrySize = new TextEncoder().encode(entryString).length;

        if (currentBufferSize + entrySize > bufferSize && logBuffer.length > 0) {
            sendLogsInternal(); // Flush buffer if adding this entry exceeds size
        }

        // If a single entry is larger than the buffer, log an error and discard
        if (entrySize > bufferSize) {
            console.error('[LLMDebugger] Log entry discarded: size exceeds buffer limit.', entry);
            return;
        }

        logBuffer.push(entry);
        currentBufferSize += entrySize;
    }

    // --- Sending Logic ---
    function sendLogsInternal() {
        if (logBuffer.length === 0) return;

        const payload = { messages: logBuffer };
        const payloadString = JSON.stringify(payload);
        logBuffer = []; // Clear buffer immediately
        currentBufferSize = 0;

        // Use sendBeacon if available for robustness on page unload
        if (navigator.sendBeacon) {
            try {
                const success = navigator.sendBeacon(endpoint, new Blob([payloadString], { type: 'application/json' }));
                if (!success) {
                    console.error('[LLMDebugger] sendBeacon failed, attempting fetch.');
                    fallbackFetchSend(payloadString);
                }
            } catch (e) {
                console.error('[LLMDebugger] Error using sendBeacon:', e);
                fallbackFetchSend(payloadString);
            }
        } else {
            fallbackFetchSend(payloadString);
        }
    }

    function fallbackFetchSend(payloadString) {
         fetch(endpoint, {
                method: 'POST',
                body: payloadString,
                headers: { 'Content-Type': 'application/json' },
                keepalive: true
            }).catch(error => {
                // Use original console if sniffer was enabled and captured it
                const origError = consoleSnifferInstance?.originalMethods?.error || console.error;
                origError.call(console, '[LLMDebugger] Failed to send logs:', error);
            });
    }

    // --- Control Functions ---
    function startDebugger() {
        if (isRunning) return;
        const origLog = consoleSnifferInstance?.originalMethods?.log || console.log;
        origLog.call(console, '[LLMDebugger] Starting...');
        isRunning = true;

        // Initialize Sniffers
        if (enabledSniffers.has('console')) {
            consoleSnifferInstance = createConsoleSniffer({ enabledLevels }, addLogEntry);
            consoleSnifferInstance.start();
        }
        if (enabledSniffers.has('fetch')) {
            fetchSnifferInstance = createFetchSniffer({}, addLogEntry);
            fetchSnifferInstance.start();
        }
        // Initialize Resource Check
        if (enabledSniffers.has('resourceCheck')) {
            initResourceCheck(addLogEntry); // Call the imported initializer
        }

        // Start interval sending
        if (sendInterval > 0) {
            sendIntervalId = setInterval(sendLogsInternal, sendInterval);
        }

        // Add unload listeners
        window.addEventListener('visibilitychange', () => {
           if (document.visibilityState === 'hidden') { sendLogsInternal(); }
        });
        window.addEventListener('pagehide', sendLogsInternal);

        (consoleSnifferInstance?.originalMethods?.log || console.log).call(console, '[LLMDebugger] Started.');
    }

    function stopDebugger() {
        if (!isRunning) return;
        console.log('[LLMDebugger] Stopping...');

        // Stop Sniffers
        consoleSnifferInstance?.stop();
        fetchSnifferInstance?.stop();
        // No specific stop needed for resourceCheck

        // Stop interval
        if (sendIntervalId) {
            clearInterval(sendIntervalId);
            sendIntervalId = null;
        }

        // Remove unload listeners
        // ...

        // Send remaining logs
        sendLogsInternal();

        isRunning = false;
        const origLog = consoleSnifferInstance?.originalMethods?.log || console.log;
        origLog.call(console, '[LLMDebugger] Stopped.');
    }

    // --- Public API ---
    window.LLMDebugger = {
        start: startDebugger,
        stop: stopDebugger,
        flush: sendLogsInternal
    };

    // --- Auto-Start ---
    if (autoStart) {
        // Use timeout to ensure DOM is ready and script tag is parsed
        setTimeout(startDebugger, 0);
    }
})();