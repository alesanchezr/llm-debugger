(function () {
    'use strict';

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
    function createConsoleSniffer(config, logCallback) {
        const { enabledLevels } = config;
        const logLevels = { DEBUG: 'log', WARNING: 'warn', ERROR: 'error', INFO: 'log' };
        const originalMethods = { log: console.log, warn: console.warn, error: console.error };
        let isActive = false;
        originalMethods.log('Logging for enabledLevels:', config);

        function createLogHandler(level) {
            const originalMethod = originalMethods[logLevels[level.toUpperCase()]];
            // Use original group methods to avoid recursion if console itself is logged
            originalMethods.log; // Or decide based on level
            originalMethods.log; // Doesn't really matter
            
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

    // src/front/fetch_sniffer.js

    // Export the main function
    function createFetchSniffer(config, logCallback) {
        const originalFetch = window.fetch;
        let isActive = false;

        async function logAndFetch(...args) {
            // If not active, just call original fetch
            if (!isActive) {
                return originalFetch(...args);
            }

            const [urlOrRequest, options] = args;
            
            // Skip internal resource check requests
            const isInternalRequest = 
                (options?.headers && typeof options.headers === 'object' && 
                 options.headers['X-LLM-Debugger-Internal'] === 'resource-check') ||
                (urlOrRequest?.headers && typeof urlOrRequest.headers === 'object' && 
                 urlOrRequest.headers.get && urlOrRequest.headers.get('X-LLM-Debugger-Internal') === 'resource-check');
            
            if (isInternalRequest) {
                return originalFetch(...args);
            }
            
            const url = (typeof urlOrRequest === 'string') ? urlOrRequest : urlOrRequest.url;
            const method = options?.method || (typeof urlOrRequest === 'object' ? urlOrRequest.method : 'GET') || 'GET';
            const requestBody = options?.body || (typeof urlOrRequest === 'object' ? urlOrRequest.body : null);
            const timestamp = new Date().toISOString();

            // Log request start
            const requestLog = {
                timestamp, type: 'network', subType: 'fetch_request', method: method.toUpperCase(),
                url: String(url), requestBody: null
            };

            // Attempt to capture request body
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
                } else {
                    responseBody = `[Unsupported content type: ${contentType}]`;
                }
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

            // Log response/completion
            const responseLog = {
                timestamp: new Date().toISOString(), type: 'network', subType: 'fetch_response',
                method: method.toUpperCase(), url: String(url), responseStatus, responseBody,
                responseStatusText: response.statusText
            };
            logCallback(responseLog);

            return response;
        }

        function start() {
            if (isActive) return;
            isActive = true;
            window.fetch = logAndFetch;
            window.originalFetch = originalFetch; // Store for resource check module
        }

        function stop() {
            if (!isActive) return;
            isActive = false;
            window.fetch = originalFetch;
            delete window.originalFetch;
        }

        return {
            start,
            stop
        };
    }

    // src/front/test-scripts-and-styles.js

    // Store the log callback provided during initialization
    let logCallbackFn = null;

    async function performResourceCheck() {
        if (!logCallbackFn) {
            console.warn('[LLM-Debugger] Resource check - Log callback not initialized.');
            return;
        }

        // Use the original fetch stored by the fetch sniffer or fall back to window.fetch
        const _fetch = window.originalFetch || window.fetch;

        // Query DOM safely - ensure DOM is ready before calling
        const resources = document.querySelectorAll('script[src], link[rel="stylesheet"][href]');
        const checks = [];
        let count = 0;

        resources.forEach(resource => {
            const url = resource.src || resource.href;
            if (!url) return; // Skip elements without src/href

            count++;
            let absoluteUrl;
            try {
                absoluteUrl = new URL(url, document.baseURI).href;
            } catch (e) {
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    type: 'resource', subType: 'error',
                    tagName: resource.tagName.toUpperCase(),
                    originalUrl: url, url: null,
                    status: 'Invalid URL', error: e.message
                };
                logCallbackFn(logEntry);
                return;
            }

            // Use a custom header to mark this as an internal resource check request
            const checkPromise = _fetch(absoluteUrl, { 
                method: 'HEAD', 
                credentials: 'omit',
                headers: {
                    'X-LLM-Debugger-Internal': 'resource-check'
                }
            })
                .then(response => {
                    if (response.status >= 400) {
                        const logEntry = {
                            timestamp: new Date().toISOString(),
                            type: 'resource', subType: 'failed',
                            tagName: resource.tagName.toUpperCase(),
                            url: absoluteUrl,
                            status: response.status,
                            statusText: response.statusText
                        };
                        logCallbackFn(logEntry);
                    } // Optional: Log success if needed
                })
                .catch(error => {
                    const logEntry = {
                        timestamp: new Date().toISOString(),
                        type: 'resource', subType: 'error',
                        tagName: resource.tagName.toUpperCase(),
                        url: absoluteUrl,
                        status: 'Network/CORS Error',
                        error: error.message
                    };
                    logCallbackFn(logEntry);
                });
            checks.push(checkPromise);
        });

        // Wait for all checks to complete
        await Promise.allSettled(checks);

        // Log completion
        console.log(`[LLM-Debugger] Resource check complete (${count} resources checked).`);
    }

    // Export an initialization function
    function initResourceCheck(logCallback) {
        console.log('[LLM-Debugger] Initializing resource check...');
        if (typeof document === 'undefined' || document.readyState === 'loading') {
            // Wait for DOMContentLoaded if the document is still loading
            document.addEventListener('DOMContentLoaded', () => {
                logCallbackFn = logCallback;
                 // Delay check slightly after DOM ready
                setTimeout(performResourceCheck, 500);
            }, { once: true });
        } else {
            // DOM is already ready, run check after a short delay
            logCallbackFn = logCallback;
            setTimeout(performResourceCheck, 500);
        }
    }

    function createErrorSniffer(config, logCallback) {
        let originalOnError = null;
        let originalOnUnhandledRejection = null;
        let isActive = false;

        function handleError(message, source, lineno, colno, error) {
            if (!isActive) return false; // Let the original handler run if not active

            const logEntry = {
                timestamp: new Date().toISOString(),
                type: 'error',
                subType: 'uncaught',
                message: message,
                file: source,
                line: lineno,
                column: colno,
                stack: error ? error.stack : null
            };
            logCallback(logEntry);

            // Call the original handler if it exists
            if (originalOnError) {
                return originalOnError.call(window, message, source, lineno, colno, error);
            }
            // Indicate that the error was not handled by our sniffer to allow default browser behavior
            return false; 
        }

        function handleRejection(event) {
            if (!isActive) return;

            const reason = event.reason;
            let message = 'Unknown promise rejection reason';
            let stack = null;

            if (reason instanceof Error) {
                message = reason.message;
                stack = reason.stack;
            } else {
                // Try to stringify non-Error reasons
                try {
                    message = JSON.stringify(reason);
                } catch (e) {
                    message = String(reason);
                }
            }

            const logEntry = {
                timestamp: new Date().toISOString(),
                type: 'error',
                subType: 'promise_rejection',
                message: message,
                stack: stack
            };
            logCallback(logEntry);

            // Call the original handler if it exists
            if (originalOnUnhandledRejection) {
                originalOnUnhandledRejection.call(window, event);
            }
        }

        function start() {
            if (isActive) return;
            isActive = true;
            
            // Store original handlers
            originalOnError = window.onerror;
            originalOnUnhandledRejection = window.onunhandledrejection;

            // Assign new handlers
            window.onerror = handleError;
            window.onunhandledrejection = handleRejection;
            
            // Store handlers globally for potential removal by stopDebugger (optional but good practice)
            window._llmDebuggerErrorHandlers = { handleError, handleRejection };

            // Internal log for debugging start
            // Use setTimeout to avoid potential race conditions if logCallback logs immediately
            setTimeout(() => {
                logCallback({
                    timestamp: new Date().toISOString(),
                    type: 'internal', // Use a distinct type for internal messages
                    subType: 'sniffer_start',
                    sniffer: 'error',
                    message: 'Error sniffer started.'
                });
            }, 0);
        }

        function stop() {
            if (!isActive) return;
            isActive = false;
            
            // Restore original handlers
            window.onerror = originalOnError;
            window.onunhandledrejection = originalOnUnhandledRejection;

            // Clear stored handlers
            delete window._llmDebuggerErrorHandlers;

            originalOnError = null;
            originalOnUnhandledRejection = null;
            
            // Internal log for debugging stop
            // Use setTimeout for consistency
            setTimeout(() => {
                logCallback({
                    timestamp: new Date().toISOString(),
                    type: 'internal',
                    subType: 'sniffer_stop',
                    sniffer: 'error',
                    message: 'Error sniffer stopped.'
                });
             }, 0);
        }

        return {
            start,
            stop
        };
    }

    // src/frontend/llm-debugger.js

    // Main debugger logic wrapped in an IIFE to avoid polluting global scope unnecessarily
    (function () {
        // --- Configuration Parsing ---
        const config = window.LLM_DEBUGGER_CONFIG || {};
        
        // Default configuration
        const defaultConfig = {
            autoStart: true,
            bufferSize: 150 * 1024, // 150KB
            endpoint: 'http://localhost:3006/logs',
            logLevel: ['ERROR', 'WARNING', 'DEBUG'],
            sniffers: ['console', 'fetch', 'resourceCheck', 'error'],
            sendInterval: 5000 // 5 seconds
        };

        // Merge config with defaults
        const finalConfig = {
            ...defaultConfig,
            ...config,
            // Ensure arrays are properly handled
            logLevel: Array.isArray(config.logLevel) ? config.logLevel : (config.logLevel || '').toUpperCase().split(','),
            sniffers: Array.isArray(config.sniffers) ? config.sniffers : (config.sniffers || '').toLowerCase().split(',').filter(Boolean)
        };
        if(finalConfig.logLevel == '') finalConfig.logLevel = defaultConfig.logLevel;

        const enabledLevels = new Set(finalConfig.logLevel.filter(level => ['DEBUG', 'WARNING', 'ERROR', 'INFO'].includes(level)));
        const enabledSniffers = new Set(finalConfig.sniffers);

        // --- State ---
        let logBuffer = [];
        let currentBufferSize = 0;
        let sendIntervalId = null;
        let isRunning = false;
        let consoleSnifferInstance = null;
        let fetchSnifferInstance = null;
        let errorSnifferInstance = null;
        
        // Original console methods that we'll use for internal logging
        const originalMethods = { 
            log: console.log, 
            warn: console.warn, 
            error: console.error 
        };

        // --- Logging & Buffering ---
        function formatLogEntry(entry) {
            const timestamp = entry.timestamp || new Date().toISOString();
            
            switch(entry.type) {
                case 'console':
                    const level = entry.level || 'DEBUG';
                    const location = entry.file ? ` in ${entry.file}:${entry.line}` : '';
                    return `[${timestamp}] CONSOLE ${level}: ${entry.message}${location}`;
                
                case 'network':
                    if (entry.subType === 'fetch_request') {
                        return `[${timestamp}] NETWORK: ${entry.method} ${entry.url}`;
                    } else if (entry.subType === 'fetch_response') {
                        return `[${timestamp}] NETWORK: ${entry.method} ${entry.url} (${entry.responseStatus} ${entry.responseStatusText || ''})`;
                    } else if (entry.subType === 'fetch_error') {
                        return `[${timestamp}] NETWORK ERROR: ${entry.method} ${entry.url} - ${entry.error}`;
                    }
                    break;
                
                case 'resource':
                    if (entry.subType === 'failed') {
                        return `[${timestamp}] RESOURCE: Failed to load ${entry.tagName.toLowerCase()} ${entry.url} (${entry.status} ${entry.statusText || ''})`;
                    } else if (entry.subType === 'error') {
                        return `[${timestamp}] RESOURCE ERROR: Failed to load ${entry.tagName.toLowerCase()} ${entry.url} - ${entry.error || 'Unknown error'}`;
                    }
                    break;

                case 'error':
                    if (entry.subType === 'promise_rejection') {
                        const stackTrace = entry.stack ? `\nStack trace:\n${entry.stack}` : '';
                        return `[${timestamp}] UNHANDLED PROMISE REJECTION: ${entry.message}${stackTrace}`;
                    } else if (entry.subType === 'uncaught') {
                        const errorLocation = entry.file ? ` in ${entry.file}:${entry.line}:${entry.column}` : '';
                        const stackTrace = entry.stack ? `\nStack trace:\n${entry.stack}` : '';
                        return `[${timestamp}] UNCAUGHT ERROR: ${entry.message}${errorLocation}${stackTrace}`;
                    }
                    break;

                case 'internal':
                    return `[${timestamp}] INTERNAL (${entry.sniffer}): ${entry.message}`;
            }
            
            // Fallback for unknown types
            return `[${timestamp}] ${entry.type.toUpperCase()}: ${JSON.stringify(entry)}`;
        }

        function addLogEntry(entry) {
            if (!isRunning) return; // Don't collect logs if not running

            const formattedEntry = formatLogEntry(entry);
            const entrySize = new TextEncoder().encode(formattedEntry).length;

            if (currentBufferSize + entrySize > finalConfig.bufferSize && logBuffer.length > 0) {
                sendLogsInternal(); // Flush buffer if adding this entry exceeds size
            }

            // If a single entry is larger than the buffer, log an error and discard
            if (entrySize > finalConfig.bufferSize) {
                console.error('[LLM-Debugger] Log entry discarded: size exceeds buffer limit.', entry);
                return;
            }

            logBuffer.push(formattedEntry);
            currentBufferSize += entrySize;
        }

        // --- Sending Logic ---
        function sendLogsInternal() {
            if (logBuffer.length === 0) return;

            const payload = logBuffer.join('\n --- \n');
            
            // Debug: Print to console what we're sending using original console to avoid recursion
            originalMethods.log(`[LLM-Debugger] Sending ${logBuffer.length} logs to ${finalConfig.endpoint}`);
            
            // Clear the buffer immediately to avoid duplicates if sending fails
            [...logBuffer]; // Keep a copy for debugging if needed
            logBuffer = [];
            currentBufferSize = 0;

            // Use sendBeacon if available for robustness on page unload
            if (navigator.sendBeacon) {
                try {
                    const success = navigator.sendBeacon(finalConfig.endpoint, new Blob([payload], { type: 'text/plain' }));
                    if (!success) {
                        originalMethods.error('[LLM-Debugger] sendBeacon failed, attempting fetch fallback.');
                        fallbackFetchSend(payload);
                    }
                } catch (e) {
                    originalMethods.error('[LLM-Debugger] sendBeacon error:', e);
                    fallbackFetchSend(payload);
                }
            } else {
                fallbackFetchSend(payload);
            }
        }

        function fallbackFetchSend(payload) {
            fetch(finalConfig.endpoint, {
                method: 'POST',
                body: payload,
                headers: {
                    'Content-Type': 'text/plain'
                },
                keepalive: true // Ensure the request completes even if the page is unloading
            })
            .then(response => {
                if (!response.ok) {
                    originalMethods.error(`[LLM-Debugger] Server responded with status ${response.status}`);
                }
            })
            .catch(error => {
                originalMethods.error('[LLM-Debugger] Failed to send logs:', error);
            });
        }

        // --- Control Functions ---
        function startDebugger() {
            if (isRunning) return;
            isRunning = true;
            
            originalMethods.log(`[LLM-Debugger] Starting with sniffers: ${Array.from(enabledSniffers).join(', ')}`);

            // Start sniffers
            if (enabledSniffers.has('console')) {
                originalMethods.log('[LLM-Debugger] Initializing console sniffer for levels:', enabledLevels);
                consoleSnifferInstance = createConsoleSniffer({ enabledLevels }, addLogEntry);
                consoleSnifferInstance.start();
                
                // Test log to verify console capture is working
                const testLog = {
                    message: 'Console sniffer initialized', 
                    level: 'DEBUG', 
                    timestamp: new Date().toISOString(), 
                    type: 'console'
                };
                addLogEntry(testLog);
            }
            
            if (enabledSniffers.has('fetch')) {
                originalMethods.log('[LLM-Debugger] Initializing fetch sniffer');
                fetchSnifferInstance = createFetchSniffer({}, addLogEntry);
                fetchSnifferInstance.start();
            }
            
            if (enabledSniffers.has('resourceCheck')) {
                originalMethods.log('[LLM-Debugger] Initializing resource check sniffer');
                initResourceCheck(addLogEntry);
            }

            if (enabledSniffers.has('error')) {
                originalMethods.log('[LLM-Debugger] Initializing error sniffer');
                errorSnifferInstance = createErrorSniffer({}, addLogEntry);
                errorSnifferInstance.start();
            }

            // Start interval sending
            if (finalConfig.sendInterval > 0) {
                originalMethods.log(`[LLM-Debugger] Setting up log sending interval: ${finalConfig.sendInterval}ms`);
                sendIntervalId = setInterval(sendLogsInternal, finalConfig.sendInterval);
            }

            // Store error handlers for cleanup
            // window.LLMDebugger._errorHandlers = errorHandlers;
            
            // Add unload listeners to ensure logs are sent when page is closed
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') { 
                    originalMethods.log('[LLM-Debugger] Page hidden, sending logs');
                    sendLogsInternal(); 
                }
            });
            window.addEventListener('pagehide', () => {
                originalMethods.log('[LLM-Debugger] Page hiding, sending logs');
                sendLogsInternal();
            });
            window.addEventListener('beforeunload', () => {
                originalMethods.log('[LLM-Debugger] Page unloading, sending logs');
                sendLogsInternal();
            });
            
            // Force an immediate test send
            setTimeout(() => {
                originalMethods.log('[LLM-Debugger] Sending initial test log');
                sendLogsInternal();
            }, 1000);
        }

        function stopDebugger() {
            if (!isRunning) return;
            isRunning = false;

            // Stop sniffers
            consoleSnifferInstance?.stop();
            fetchSnifferInstance?.stop();
            errorSnifferInstance?.stop();

            // Remove error handler
            // removeGlobalErrorHandler(window.LLMDebugger._errorHandlers);
            // delete window.LLMDebugger._errorHandlers;
            
            // Remove unload listeners
            window.removeEventListener('visibilitychange', sendLogsInternal);
            window.removeEventListener('pagehide', sendLogsInternal);
            window.removeEventListener('beforeunload', sendLogsInternal);

            // Stop interval
            if (sendIntervalId) {
                clearInterval(sendIntervalId);
                sendIntervalId = null;
            }

            // Send any remaining logs
            sendLogsInternal();
        }

        // --- Startup help ---
        function checkEndpointConnection() {
            originalMethods.log(`[LLM-Debugger] Checking endpoint connection to: ${finalConfig.endpoint}`);
            
            fetch(finalConfig.endpoint, {
                method: 'HEAD',
                headers: {
                    'X-LLM-Debugger': 'connection-check'
                }
            })
            .then(response => {
                if (response.ok) {
                    originalMethods.log(`[LLM-Debugger] Successfully connected to endpoint: ${finalConfig.endpoint}`);
                } else {
                    originalMethods.error(`[LLM-Debugger] Server responded with status ${response.status} - logs may not be recorded`);
                }
            })
            .catch(error => {
                originalMethods.error(`[LLM-Debugger] Failed to connect to endpoint: ${finalConfig.endpoint}`, error);
                originalMethods.error('Check that the log server is running and accessible from this page');
            });
        }

        // --- Public API ---
        window.LLMDebugger = {
            start: startDebugger,
            stop: stopDebugger,
            flush: sendLogsInternal,
            test: function() {
                
                // Force immediate sending
                sendLogsInternal();
                
                return "Test logs generated and flush triggered";
            },
            checkConnection: checkEndpointConnection
        };

        // --- Auto-Start ---
        if (finalConfig.autoStart) {
            // Use timeout to ensure DOM is ready and script tag is parsed
            setTimeout(startDebugger, 0);
        }
    })();

})();
