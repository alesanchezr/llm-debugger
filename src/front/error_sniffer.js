export function createErrorSniffer(config, logCallback) {
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
