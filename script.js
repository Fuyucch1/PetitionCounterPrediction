// Store historical data for rate calculations
let dataHistory = [];
const TARGET_SIGNATURES = 1000000;
const FETCH_INTERVAL = 30000; // Fetch every 30 seconds
const UI_UPDATE_INTERVAL = 1000; // Update UI every second
const PLOT_REFRESH_INTERVAL = 30000; // Refresh plot every 30 seconds (same as data fetch)
const CACHE_DURATION = 30; // Server cache duration in seconds
const AUTO_REFRESH_THRESHOLD = 40; // After how many seconds to auto-refresh data

// Store the latest actual count and rates for interpolation.py
let latestActualCount = 0;
let currentPerMinuteRate = 0;
let currentPerHourRate = 0;
let lastFetchTime = 0; // Track when data was last fetched from ECI
let nextFetchTimeout = null; // Timeout for next data fetch
let isFetchingData = false; // Flag to prevent multiple simultaneous data fetches
let isFetchingPlot = false; // Flag to prevent multiple simultaneous plot fetches
let uiUpdateInterval = null; // Store the interval ID for UI updates
let autoRefreshTimeout = null; // Store the timeout ID for auto-refresh

// Initialization flag to prevent multiple initializations
let isInitialized = false;

// Add debug information to track script execution
const scriptInstanceId = Math.random().toString(36).substring(2, 15);
console.log(`Script instance initialized with ID: ${scriptInstanceId}`);

// Debug function to log with instance ID for tracking
function debugLog(message) {
    console.log(`[Instance ${scriptInstanceId.substring(0, 4)}] ${message}`);
}

// Function to fetch data from the ECI website via our Flask API
async function fetchSignatureData() {
    // If already fetching data, don't start another fetch
    if (isFetchingData) {
        debugLog('Data fetch already in progress, skipping this request');
        return;
    }

    // Set flag to indicate fetch is in progress
    isFetchingData = true;
    debugLog('Starting data fetch');

    try {
        // Fetch data from our API endpoint
        const response = await fetch('/get_signatures');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        // Process the data
        processData(data);

        // Update lastFetchTime from server data
        if (data.last_fetch_time) {
            lastFetchTime = data.last_fetch_time;
        }

        // Schedule next fetch based on server's fetch cycle
        scheduleNextFetch();

        // Clear any existing auto-refresh timeout
        if (autoRefreshTimeout) {
            clearTimeout(autoRefreshTimeout);
            autoRefreshTimeout = null;
        }

        // Set up a new auto-refresh timeout
        setupAutoRefresh();

        // Refresh the plot when new data is received
        fetchPlotData();

        // Log the last update time
        const lastUpdated = new Date(data.timestamp * 1000).toLocaleTimeString();
        debugLog(`Data updated at ${lastUpdated}`);

    } catch (error) {
        console.error('Error fetching signature data:', error);
        document.getElementById('current-count').textContent = 'Error loading data';

        // If there was an error, try again after a short delay
        setTimeout(() => {
            isFetchingData = false; // Reset flag before retry
            fetchSignatureData();
        }, 5000);

        // Return early to avoid the finally block
        return;
    } finally {
        // Reset the flag when fetch is complete (only for successful execution)
        isFetchingData = false;
    }
}

// Function to schedule the next data fetch based on server's fetch cycle
function scheduleNextFetch() {
    // Clear any existing timeout to prevent multiple scheduled fetches
    if (nextFetchTimeout) {
        clearTimeout(nextFetchTimeout);
        nextFetchTimeout = null;
    }

    // Calculate time since last server fetch
    const now = Date.now() / 1000; // Convert to seconds to match server timestamp
    const timeSinceLastFetch = now - lastFetchTime;

    // Schedule next fetch exactly 30 seconds after the last fetch
    // If 30 seconds have already passed, fetch immediately (minimum 1 second delay)
    const timeUntilNextFetch = Math.max(1000, FETCH_INTERVAL/1000 - timeSinceLastFetch) * 1000;

    // Schedule next fetch with a wrapper function that checks if a fetch is already in progress
    nextFetchTimeout = setTimeout(() => {
        // Only proceed if not already fetching data
        if (!isFetchingData) {
            debugLog(`Executing scheduled fetch after ${timeUntilNextFetch/1000} seconds`);
            fetchSignatureData();
        } else {
            debugLog('Scheduled fetch skipped because a fetch is already in progress');
            // Re-schedule in case this one was skipped
            scheduleNextFetch();
        }
    }, timeUntilNextFetch);

    debugLog(`Next data fetch scheduled in ${timeUntilNextFetch/1000} seconds with timeout ID: ${nextFetchTimeout}`);
}

// Process the data and update the UI
function processData(data) {
    // Add the current count and timestamp to history
    dataHistory.push({
        count: data.count,
        timestamp: data.last_fetch_time * 1000 // Use server's fetch time (convert from seconds to milliseconds)
    });

    // Keep only the last 60 data points (for an hour of data if fetching every minute)
    if (dataHistory.length > 60) {
        dataHistory.shift();
    }

    // Update latest actual count and rates from server
    latestActualCount = data.count;
    currentPerMinuteRate = data.per_minute_rate;
    currentPerHourRate = data.per_hour_rate;

    // Update current count display
    const currentCountElement = document.getElementById('current-count');
    if (currentCountElement) {
        currentCountElement.textContent = data.count.toLocaleString();
    }

    // Update rates display
    const perMinuteElement = document.getElementById('per-minute');
    if (perMinuteElement) {
        perMinuteElement.textContent = Math.round(data.per_minute_rate).toLocaleString();
    }

    const perHourElement = document.getElementById('per-hour');
    if (perHourElement) {
        perHourElement.textContent = Math.round(data.per_hour_rate).toLocaleString();
    }

    // Update estimated time to reach 1 million
    const timeToMillionElement = document.getElementById('time-to-million');
    if (timeToMillionElement) {
        if (data.estimated_completion_date) {
            const estimatedDate = new Date(data.estimated_completion_date);
            const options = {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            };
            timeToMillionElement.textContent = estimatedDate.toLocaleDateString(undefined, options);
        } else {
            timeToMillionElement.textContent = 'Cannot estimate (rate too low)';
        }
    }

    // Calculate and update progress bar
    const progressElement = document.getElementById('progress');
    const progressTextElement = document.getElementById('progress-text');

    if (progressElement && progressTextElement) {
        const progressPercentage = data.progress_percentage;
        progressElement.style.width = `${Math.min(progressPercentage, 100)}%`;
        progressTextElement.textContent = `${progressPercentage.toFixed(2)}%`;
    }

    // Update last updated timestamp
    const lastUpdatedElement = document.getElementById('last-updated');
    if (lastUpdatedElement) {
        const formattedTime = new Date(data.timestamp * 1000).toLocaleTimeString();
        lastUpdatedElement.textContent = `Last updated: ${formattedTime}`;
    }
}

// Function to set up the auto-refresh mechanism separately from UI updates
function setupAutoRefresh() {
    // Clear any existing auto-refresh timeout
    if (autoRefreshTimeout) {
        clearTimeout(autoRefreshTimeout);
        autoRefreshTimeout = null;
    }

    // Set a timeout to refresh data after AUTO_REFRESH_THRESHOLD seconds
    autoRefreshTimeout = setTimeout(() => {
        // Only proceed if not already fetching data
        if (!isFetchingData) {
            debugLog(`Auto-refresh triggered after ${AUTO_REFRESH_THRESHOLD} seconds`);
            fetchSignatureData();
        } else {
            debugLog('Auto-refresh skipped because a fetch is already in progress');
            // Try again shortly
            setupAutoRefresh();
        }
    }, AUTO_REFRESH_THRESHOLD * 1000);

    debugLog(`Auto-refresh scheduled in ${AUTO_REFRESH_THRESHOLD} seconds with timeout ID: ${autoRefreshTimeout}`);
}

// Function to update the UI every second with interpolated values
function updateUIEverySecond() {
    // Only update if we have at least one data point
    if (dataHistory.length === 0) return;

    const latest = dataHistory[dataHistory.length - 1];
    const now = new Date().getTime();

    // Calculate time elapsed since last fetch from ECI (in seconds)
    const secondsElapsed = (now - lastFetchTime * 1000) / 1000;

    // Update UI without triggering auto-refresh (handled separately now)

    // Calculate interpolated count based on per-minute rate
    // (converting per-minute rate to per-second rate by dividing by 60)
    const interpolatedCount = Math.round(latest.count + (currentPerMinuteRate / 60) * secondsElapsed);

    // Update current count display with interpolated value
    const currentCountElement = document.getElementById('current-count');
    if (currentCountElement) {
        currentCountElement.textContent = interpolatedCount.toLocaleString();
    }

    // Update progress bar with interpolated value
    const progressElement = document.getElementById('progress');
    const progressTextElement = document.getElementById('progress-text');

    if (progressElement && progressTextElement) {
        const progressPercentage = (interpolatedCount / TARGET_SIGNATURES) * 100;
        progressElement.style.width = `${Math.min(progressPercentage, 100)}%`;
        progressTextElement.textContent = `${progressPercentage.toFixed(2)}%`;
    }

    // Update the "last updated" text to show how long ago
    const lastUpdatedElement = document.getElementById('last-updated');
    if (lastUpdatedElement) {
        const lastUpdatedText = lastUpdatedElement.textContent;

        // Format the time ago text
        let timeAgoText;
        if (secondsElapsed < 60) {
            timeAgoText = `${Math.floor(secondsElapsed)} seconds ago`;
        } else if (secondsElapsed < 3600) {
            const minutes = Math.floor(secondsElapsed / 60);
            timeAgoText = `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else {
            const hours = Math.floor(secondsElapsed / 3600);
            const minutes = Math.floor((secondsElapsed % 3600) / 60);
            timeAgoText = `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        }

        // Check if the text already contains a time ago part
        if (lastUpdatedText.includes(' (')) {
            // Extract the original timestamp
            const originalTimestamp = lastUpdatedText.split('Last updated: ')[1].split(' (')[0];
            lastUpdatedElement.textContent = `Last updated: ${originalTimestamp} (${timeAgoText})`;
        } else if (lastUpdatedText.includes('Last updated:')) {
            // First run after a real update, the text doesn't have a time ago part yet
            const originalTimestamp = lastUpdatedText.split('Last updated: ')[1];
            lastUpdatedElement.textContent = `Last updated: ${originalTimestamp} (${timeAgoText})`;
        }
    }
}

// Function to fetch and display the plot
async function fetchPlotData() {
    // If already fetching plot data, don't start another fetch
    if (isFetchingPlot) {
        console.log('Plot fetch already in progress, skipping this request');
        return;
    }

    // Set flag to indicate plot fetch is in progress
    isFetchingPlot = true;

    try {
        // Fetch plot data from our API endpoint
        const response = await fetch('/api/plot');

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        // Create a modern, smooth interactive plot using Plotly.js
        const plotData = [{
            x: data.time_labels,
            y: data.new_signatures,
            type: 'scatter',
            mode: 'lines',  // Remove markers for a cleaner look
            line: {
                width: 3,
                shape: 'spline',  // Use spline for smooth curves
                smoothing: 1.3,   // Increase smoothing
                color: '#3498db'  // Modern blue color
            },
            fill: 'tozeroy',      // Add area fill below the line
            fillcolor: 'rgba(52, 152, 219, 0.2)'  // Light blue with transparency
        }];

        const layout = {
            title: {
                text: data.title,
                font: {
                    family: 'Arial, sans-serif',
                    size: 24,
                    color: '#2c3e50'
                }
            },
            xaxis: {
                title: {
                    text: data.x_label,
                    font: {
                        family: 'Arial, sans-serif',
                        size: 16,
                        color: '#7f8c8d'
                    }
                },
                tickangle: -45,
                gridcolor: '#ecf0f1',
                zerolinecolor: '#ecf0f1'
            },
            yaxis: {
                title: {
                    text: data.y_label,
                    font: {
                        family: 'Arial, sans-serif',
                        size: 16,
                        color: '#7f8c8d'
                    }
                },
                gridcolor: '#ecf0f1',
                zerolinecolor: '#ecf0f1'
            },
            paper_bgcolor: 'white',
            plot_bgcolor: 'white',
            margin: { l: 60, r: 50, b: 100, t: 80, pad: 4 },
            hovermode: 'closest'
        };

        const config = {
            responsive: true,
            displayModeBar: false,
            displaylogo: false
        };

        const plotElement = document.getElementById('signature-plot');
        if (plotElement) {
            Plotly.newPlot('signature-plot', plotData, layout, config);
        }

    } catch (error) {
        console.error('Error fetching plot data:', error);
        const plotElement = document.getElementById('signature-plot');
        if (plotElement) {
            plotElement.innerHTML = 'Error loading plot';
        }
    } finally {
        // Reset the flag when plot fetch is complete (whether successful or not)
        isFetchingPlot = false;
    }
}

// Clear all existing intervals and timeouts
function clearAllTimers() {
    // Clear UI update interval
    if (uiUpdateInterval) {
        debugLog(`Clearing UI update interval: ${uiUpdateInterval}`);
        clearInterval(uiUpdateInterval);
        uiUpdateInterval = null;
    }

    // Clear data fetch timeout
    if (nextFetchTimeout) {
        debugLog(`Clearing next fetch timeout: ${nextFetchTimeout}`);
        clearTimeout(nextFetchTimeout);
        nextFetchTimeout = null;
    }

    // Clear auto-refresh timeout
    if (autoRefreshTimeout) {
        debugLog(`Clearing auto-refresh timeout: ${autoRefreshTimeout}`);
        clearTimeout(autoRefreshTimeout);
        autoRefreshTimeout = null;
    }
}

// Initialize the application
function init() {
    // Check if already initialized to prevent multiple initializations
    if (isInitialized) {
        debugLog('Application already initialized, skipping initialization');
        return;
    }

    debugLog('Initializing application');

    // Set initialization flag
    isInitialized = true;

    // Clear any existing timers that might be running
    clearAllTimers();

    // Reset fetch flags
    isFetchingData = false;
    isFetchingPlot = false;

    // Fetch data immediately on page load
    fetchSignatureData();

    // Set up UI update interval - THIS IS THE ONLY PLACE WE SET UP THE INTERVAL
    uiUpdateInterval = setInterval(updateUIEverySecond, UI_UPDATE_INTERVAL);
    debugLog(`Set up UI update interval with ID: ${uiUpdateInterval}`);

    debugLog('Application initialized successfully');
}

// Self-executing function to handle initialization
(function() {
    // Check if the script has already been initialized via a global flag
    if (window.signatureTrackerInitialized) {
        debugLog('Script already initialized via global flag, preventing duplicate execution');
        return;
    }

    // Set a global flag to prevent multiple initializations
    window.signatureTrackerInitialized = true;
    debugLog('Set global initialization flag');

    // Check the document's ready state
    if (document.readyState === 'loading') {
        // Document still loading, add event listener
        debugLog('Document still loading, adding DOMContentLoaded event listener');
        document.addEventListener('DOMContentLoaded', function onDOMReady() {
            // Remove the event listener to prevent multiple initializations
            document.removeEventListener('DOMContentLoaded', onDOMReady);
            debugLog('DOMContentLoaded event fired, initializing application');
            init();
        });
    } else {
        // Document already loaded, run init immediately
        debugLog('Document already loaded, running init immediately');
        init();
    }
})();