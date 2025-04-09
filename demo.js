// demo.js
document.addEventListener('DOMContentLoaded', () => {
    const logOutput = document.getElementById('localLogOutput');

    // --- Mirror logs locally (optional, demonstrates console override) ---
    // Store original methods before they might be overridden by console_sniffer
    const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error
    };
    const logToPage = (level, args) => {
        const message = args.map(arg => {
            try {
                if (arg instanceof Error) return arg.stack || arg.toString();
                if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg, null, 2);
                return String(arg);
            } catch { return '[Unserializable]'; }
        }).join(' ');
        const line = document.createElement('div');
        line.textContent = `[${level.toUpperCase()}] ${new Date().toLocaleTimeString()}: ${message}`;
        logOutput.appendChild(line);
        logOutput.scrollTop = logOutput.scrollHeight; // Auto-scroll
    };
    // Override console methods AFTER debugger has potentially done so
    // We rely on the debugger calling the *original* method it stored
    setTimeout(() => { // Use timeout to ensure debugger scripts have run
        console.log = (...args) => { logToPage('debug', args); originalConsole.log.apply(console, args); };
        console.warn = (...args) => { logToPage('warn', args); originalConsole.warn.apply(console, args); };
        console.error = (...args) => { logToPage('error', args); originalConsole.error.apply(console, args); };
        console.log("Local log mirror initialized.");
    }, 100); // Small delay

    // --- Button Listeners ---
    document.getElementById('logDebug')?.addEventListener('click', () => {
        console.log('This is a debug message.', 123, true);
    });

    document.getElementById('logWarn')?.addEventListener('click', () => {
        console.warn('This is a warning message.');
    });

    document.getElementById('logError')?.addEventListener('click', () => {
        console.error('This is an error message!', new Error('Something went wrong'));
    });

    document.getElementById('logObject')?.addEventListener('click', () => {
        console.log('Logging an object:', { a: 1, b: 'hello', c: { nested: true } });
    });

    document.getElementById('fetchSuccess')?.addEventListener('click', () => {
        console.log('Fetching data from JSONPlaceholder...');
        fetch('https://jsonplaceholder.typicode.com/todos/1')
            .then(response => response.json())
            .then(json => console.log('Fetch Success:', json))
            .catch(error => console.error('Fetch error:', error));
    });

    document.getElementById('fetchNotFound')?.addEventListener('click', () => {
        console.log('Fetching data from a non-existent endpoint...');
        fetch('/api/notfound') // Assuming this endpoint doesn't exist on your server
            .then(response => {
                 if (!response.ok) {
                    console.warn(`Fetch Warning: Status ${response.status}`);
                 }
                 return response.text(); // Try to read body anyway
            })
            .then(text => console.log('Fetch completed (might be error page):', text))
            .catch(error => console.error('Fetch network error:', error));
    });

    document.getElementById('fetchPost')?.addEventListener('click', () => {
        console.log('Posting data to JSONPlaceholder...');
        fetch('https://jsonplaceholder.typicode.com/posts', {
            method: 'POST',
            body: JSON.stringify({
                title: 'foo',
                body: 'bar',
                userId: 1,
            }),
            headers: {
                'Content-type': 'application/json; charset=UTF-8',
            },
        })
            .then(response => response.json())
            .then(json => console.log('POST Success:', json))
            .catch(error => console.error('POST error:', error));
    });

    document.getElementById('triggerUnhandled')?.addEventListener('click', () => {
        console.warn('About to trigger an unhandled error...');
        setTimeout(() => {
            const undefinedVar = {};
            undefinedVar.nonExistentMethod(); // This will throw an error
        }, 50);
    });

    // --- Advanced Error Testing Functions ---
    
    // Deep Stack Trace Error
    document.getElementById('triggerStackTrace')?.addEventListener('click', () => {
        console.warn('About to trigger a deep stack trace error...');
        function level1() {
            level2();
        }
        
        function level2() {
            level3();
        }
        
        function level3() {
            level4();
        }
        
        function level4() {
            level5();
        }
        
        function level5() {
            // Cause error
            const a = { deeply: { nested: null } };
            a.deeply.nested.property = "This will fail";
        }
        
        // Trigger the error after a short delay
        setTimeout(level1, 50);
    });
    
    // Unhandled Promise Rejection
    document.getElementById('triggerPromiseRejection')?.addEventListener('click', () => {
        console.warn('About to trigger an unhandled promise rejection...');
        
        // Create a promise that will be rejected
        new Promise((resolve, reject) => {
            setTimeout(() => {
                reject(new Error('This promise was intentionally rejected'));
            }, 50);
        });
        // Intentionally not adding .catch() to leave it unhandled
    });

    // Example of catching unhandled errors/rejections (might be logged by browser or other tools)
    window.addEventListener('error', function(event) {
      console.error('[Unhandled Window Error]', event.message, event.filename, event.lineno, event.colno, event.error);
    });

    window.addEventListener('unhandledrejection', function(event) {
      console.error('[Unhandled Promise Rejection]', event.reason);
    });

}); 