// src/front/fetch_sniffer.js

// Export the main function
export function createFetchSniffer(config, logCallback) {
    const originalFetch = window.fetch;
    let isActive = false;

    async function logAndFetch(...args) {
        // If not active, just call original fetch
        if (!isActive) {
            return originalFetch(...args);
        }

        const [urlOrRequest, options] = args;
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
            method: method.toUpperCase(), url: String(url), responseStatus, responseBody
        };
        logCallback(responseLog);

        return response;
    }

    function start() {
        if (isActive) return;
        isActive = true;
        window.fetch = logAndFetch;
        window.originalFetch = originalFetch;
    }

    function stop() {
        if (!isActive) return;
        isActive = false;
        window.fetch = originalFetch;
    }

    return {
        start,
        stop
    };
} 