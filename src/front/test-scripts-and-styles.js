// src/front/test-scripts-and-styles.js

// Store the log callback provided during initialization
let logCallbackFn = null;

async function performResourceCheck() {
    if (!logCallbackFn) {
        console.warn('[LLMDebugger-ResourceCheck] Log callback not initialized.');
        return;
    }

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
                type: 'resourceCheck', subType: 'error',
                tagName: resource.tagName.toUpperCase(),
                originalUrl: url, url: null,
                status: 'Invalid URL', error: e.message
            };
            logCallbackFn(logEntry);
            return;
        }

        const checkPromise = fetch(absoluteUrl, { method: 'HEAD', credentials: 'omit' })
            .then(response => {
                if (!response.ok) {
                    const logEntry = {
                        timestamp: new Date().toISOString(),
                        type: 'resourceCheck', subType: 'failed',
                        tagName: resource.tagName.toUpperCase(),
                        url: absoluteUrl,
                        status: response.status
                    };
                    logCallbackFn(logEntry);
                } // Optional: Log success if needed
            })
            .catch(error => {
                const logEntry = {
                    timestamp: new Date().toISOString(),
                    type: 'resourceCheck', subType: 'error',
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

    // Log completion (using original console if possible, might need reference from main module)
    console.log(`[LLMDebugger] Resource check complete (${count} resources checked).`);
}

// Export an initialization function
export function initResourceCheck(logCallback) {
    console.log('[LLMDebugger] Initializing resource check...');
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