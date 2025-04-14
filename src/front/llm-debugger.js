// src/frontend/llm-debugger.js
import { createConsoleSniffer } from './console_sniffer.js';
import { createFetchSniffer } from './fetch_sniffer.js';
import { initResourceCheck } from './test-scripts-and-styles.js';
import { createErrorSniffer } from './error_sniffer.js';

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
        const sentBuffer = [...logBuffer]; // Keep a copy for debugging if needed
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