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
export function initResourceCheck(logCallback) {
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