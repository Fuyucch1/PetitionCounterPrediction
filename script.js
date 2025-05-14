// Store historical data for rate calculations
let dataHistory = [];
const TARGET_SIGNATURES = 1000000;
const FETCH_INTERVAL = 30000; // Fetch every 30 seconds
const UI_UPDATE_INTERVAL = 1000; // Update UI every second
const PLOT_REFRESH_INTERVAL = 30000; // Refresh plot every 30 seconds (same as data fetch)
const CACHE_DURATION = 30; // Server cache duration in seconds

// Store the latest actual count and rates for interpolation.py
let latestActualCount = 0;
let currentPerMinuteRate = 0;
let currentPerHourRate = 0;
let lastFetchTime = 0; // Track when data was last fetched from ECI
let nextFetchTimeout = null; // Timeout for next data fetch

// Function to fetch data from the ECI website via our Flask API
async function fetchSignatureData() {
    try {
        // Fetch data from our API endpoint
        const response = await fetch('/api/signatures');

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

        // Refresh the plot when new data is received
        fetchPlotData();

        // Log the last update time
        const lastUpdated = new Date(data.timestamp * 1000).toLocaleTimeString();
        console.log(`Data updated at ${lastUpdated}`);

    } catch (error) {
        console.error('Error fetching signature data:', error);
        document.getElementById('current-count').textContent = 'Error loading data';

        // If there was an error, try again after a short delay
        setTimeout(fetchSignatureData, 5000);
    }
}

// Function to schedule the next data fetch based on server's fetch cycle
function scheduleNextFetch() {
    // Clear any existing timeout
    if (nextFetchTimeout) {
        clearTimeout(nextFetchTimeout);
    }

    // Calculate time since last server fetch
    const now = Date.now() / 1000; // Convert to seconds to match server timestamp
    const timeSinceLastFetch = now - lastFetchTime;

    // Schedule next fetch exactly 30 seconds after the last fetch
    // If 30 seconds have already passed, fetch immediately (minimum 1 second delay)
    const timeUntilNextFetch = Math.max(1000, 30 - timeSinceLastFetch) * 1000;

    // Schedule next fetch
    nextFetchTimeout = setTimeout(fetchSignatureData, timeUntilNextFetch);

    console.log(`Next data fetch scheduled in ${timeUntilNextFetch/1000} seconds`);
}

// Note: We're now using the Flask API to fetch real data from the ECI website
// The implementation is in the fetchSignatureData function above

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
    document.getElementById('current-count').textContent = data.count.toLocaleString();

    // Update rates display
    document.getElementById('per-minute').textContent = Math.round(data.per_minute_rate).toLocaleString();
    document.getElementById('per-hour').textContent = Math.round(data.per_hour_rate).toLocaleString();

    // Update estimated time to reach 1 million
    if (data.estimated_completion_date) {
        const estimatedDate = new Date(data.estimated_completion_date);
        const options = { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        document.getElementById('time-to-million').textContent = estimatedDate.toLocaleDateString(undefined, options);
    } else {
        document.getElementById('time-to-million').textContent = 'Cannot estimate (rate too low)';
    }

    // Calculate and update progress bar
    const progressPercentage = data.progress_percentage;
    document.getElementById('progress').style.width = `${Math.min(progressPercentage, 100)}%`;
    document.getElementById('progress-text').textContent = `${progressPercentage.toFixed(2)}%`;

    // Update last updated timestamp
    const formattedTime = new Date(data.timestamp * 1000).toLocaleTimeString();
    document.getElementById('last-updated').textContent = `Last updated: ${formattedTime}`;
}

// Function to update the UI every second with interpolated values
function updateUIEverySecond() {
    // Only update if we have at least one data point
    if (dataHistory.length === 0) return;

    const latest = dataHistory[dataHistory.length - 1];
    const now = new Date().getTime();

    // Calculate time elapsed since last fetch from ECI (in seconds)
    const secondsElapsed = (now - lastFetchTime * 1000) / 1000;

    // Automatically refresh data when timer reaches 40 seconds
    if (secondsElapsed >= 40) {
        console.log('Auto-refreshing data after 40 seconds');
        fetchSignatureData();
        return; // Exit early as fetchSignatureData will trigger a new UI update
    }

    // Calculate interpolated count based on per-minute rate
    // (converting per-minute rate to per-second rate by dividing by 60)
    const interpolatedCount = Math.round(latest.count + (currentPerMinuteRate / 60) * secondsElapsed);

    // Update current count display with interpolated value
    document.getElementById('current-count').textContent = interpolatedCount.toLocaleString();

    // Update progress bar with interpolated value
    const progressPercentage = (interpolatedCount / TARGET_SIGNATURES) * 100;
    document.getElementById('progress').style.width = `${Math.min(progressPercentage, 100)}%`;
    document.getElementById('progress-text').textContent = `${progressPercentage.toFixed(2)}%`;

    // Update the "last updated" text to show how long ago
    const lastUpdatedElement = document.getElementById('last-updated');
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

// Function to fetch and display the plot
async function fetchPlotData() {
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

        Plotly.newPlot('signature-plot', plotData, layout, config);

    } catch (error) {
        console.error('Error fetching plot data:', error);
        document.getElementById('signature-plot').innerHTML = 'Error loading plot';
    }
}

// Initialize the application
function init() {
    // Fetch data immediately on page load
    fetchSignatureData();
    // Initial plot fetch (subsequent refreshes will be triggered by fetchSignatureData)
    fetchPlotData();

    // Update UI every second with interpolated values
    setInterval(updateUIEverySecond, UI_UPDATE_INTERVAL);
}

// Start the application when the page loads
window.addEventListener('DOMContentLoaded', init);
