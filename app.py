from flask import Flask, jsonify, send_from_directory
import time
import os
import logging
from datetime import datetime, timedelta
import asyncio
import threading
from playwright.async_api import async_playwright
import numpy as np
from sklearn.linear_model import LinearRegression
from scipy.stats import t
import json
from scipy.optimize import curve_fit
import matplotlib.pyplot as plt
import io
import base64

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ECI_URL = "https://eci.ec.europa.eu/043/public/#/screen/home"
TARGET_SIGNATURES = 1000000
HISTORY_FILE = "interpolated_signature_history.json"

cache = {
    "data": None,
    "timestamp": 0,
    "last_fetch_time": 0,
    "cache_duration": 30
}

data_history = []
if os.path.exists(HISTORY_FILE):
    with open(HISTORY_FILE, "r") as f:
        data_history = json.load(f)

# Save history periodically to prevent data loss
def periodic_save(interval=60):
    while True:
        try:
            save_history()
        except Exception as e:
            logger.error(f"Error saving history: {e}")
        time.sleep(interval)

def save_history():
    with open(HISTORY_FILE, "w") as f:
        json.dump(data_history, f)

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

async def fetch_signature_count():
    try:
        logger.info("Fetching new data from ECI website using Playwright")
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()
            await page.goto(ECI_URL)
            await page.wait_for_selector('.ocs-progress-bar-data', state='visible')

            try:
                current_count_element = await page.query_selector('div[aria-label*="Current number of signatories"]')
                if not current_count_element:
                    current_count_element = await page.query_selector('.ocs-progress-bar-data > div:first-child')
                if not current_count_element:
                    logger.error("Could not find current count element")
                    await browser.close()
                    return None

                count_text = await current_count_element.inner_text()
                signature_count = int(count_text.strip().replace(',', ''))
                await browser.close()
                return signature_count

            except Exception as e:
                logger.error(f"Error extracting signature count: {str(e)}")
                await browser.close()
                return None

    except Exception as e:
        logger.error(f"Error with Playwright: {str(e)}")
        return None


def time_of_day_forecast(data, lookback_days=1):
    if len(data) < 20:
        return None

    # Group rates by hour of day (0-23)
    hourly_bins = {h: [] for h in range(24)}
    now = datetime.utcnow()
    current_hour = now.hour
    lookback_start = now - timedelta(days=lookback_days)

    # Calculate current signature rate (most recent data points)
    current_rate = 0
    if len(data) >= 2:
        # Use more recent data points for current rate (last 10 minutes if available)
        recent_cutoff = time.time() - 600  # 10 minutes
        recent_data = [d for d in data if d["timestamp"] >= recent_cutoff]

        if len(recent_data) >= 2:
            latest = recent_data[-1]
            oldest = recent_data[0]
            time_diff = latest["timestamp"] - oldest["timestamp"]
            count_diff = latest["count"] - oldest["count"]
            if time_diff > 0 and count_diff >= 0:
                current_rate = count_diff / time_diff  # sigs/sec
        else:
            # Fallback to last two points if we don't have 10 minutes of data
            latest = data[-1]
            previous = data[-2]
            time_diff = latest["timestamp"] - previous["timestamp"]
            count_diff = latest["count"] - previous["count"]
            if time_diff > 0 and count_diff >= 0:
                current_rate = count_diff / time_diff  # sigs/sec

    for i in range(1, len(data)):
        t0 = datetime.utcfromtimestamp(data[i - 1]["timestamp"])
        t1 = datetime.utcfromtimestamp(data[i]["timestamp"])
        if t0 < lookback_start or t1 < lookback_start:
            continue
        dt = data[i]["timestamp"] - data[i - 1]["timestamp"]
        dc = data[i]["count"] - data[i - 1]["count"]
        if dt > 0 and dc >= 0:
            hour = t0.hour
            rate = dc / dt  # sigs/sec
            hourly_bins[hour].append(rate)

    # Calculate average rate from hours that have data
    valid_rates = []
    for h, rates in hourly_bins.items():
        if rates:
            valid_rates.extend(rates)

    # Use 80% of the average as the fallback for missing hours (more conservative)
    average_rate = np.mean(valid_rates) * 0.8 if valid_rates else current_rate * 0.7

    hourly_avg = {}
    for h, rates in hourly_bins.items():
        if rates:
            hourly_avg[h] = np.mean(rates)
        elif h == current_hour:
            # Use current rate for the current hour if no historical data
            hourly_avg[h] = current_rate
        else:
            # Use degraded average for other hours with no data
            hourly_avg[h] = average_rate

    # Simulate forward hour-by-hour
    current_count = data[-1]["count"]
    if current_count >= TARGET_SIGNATURES:
        return None

    projected_time = datetime.utcnow()
    remaining = TARGET_SIGNATURES - current_count
    steps = 0

    while remaining > 0 and steps < 24 * 60:
        hour = projected_time.hour
        rate = hourly_avg.get(hour, average_rate)  # Fallback to average_rate if hour not found
        if rate > 0:
            gained = rate * 3600
            remaining -= gained
        projected_time += timedelta(hours=1)
        steps += 1

    if remaining > 0:
        return None

    return 0, 0, projected_time.strftime("%Y-%m-%d %H:%M:%S")

def calculate_rates():
    if len(data_history) < 2:
        return {
            "per_minute_rate": 0,
            "per_hour_rate": 0,
            "estimated_completion_date": None,
            "confidence_interval": None
        }

    now = time.time()
    recent_window = 120
    recent_entries = [e for e in reversed(data_history) if now - e["timestamp"] <= recent_window]

    if len(recent_entries) >= 2:
        latest = recent_entries[0]
        oldest = recent_entries[-1]
        time_diff = latest["timestamp"] - oldest["timestamp"]
        count_diff = latest["count"] - oldest["count"]
        if time_diff > 0:
            per_minute = (count_diff / time_diff) * 60
            per_hour = per_minute * 60
        else:
            per_minute = 0
            per_hour = 0
    else:
        per_minute = 0
        per_hour = 0

    forecast = time_of_day_forecast(data_history)
    return {
        "per_minute_rate": per_minute,
        "per_hour_rate": per_hour,
        "estimated_completion_date": forecast[2] if forecast else None,
        "confidence_interval": None
    }

@app.route('/api/signatures')
def get_signatures():
    try:
        if cache["data"]:
            return jsonify(cache["data"])
        else:
            return jsonify({"error": "No data yet"}), 503
    except Exception as e:
        logger.exception("Error fetching signature data")
        return jsonify({"error": str(e)}), 500

@app.route('/api/history')
def get_history():
    return jsonify(data_history)

@app.route('/api/plot')
def get_plot():
    if len(data_history) < 2:
        return jsonify({"error": "Not enough data to plot."}), 400

    current_time = time.time()
    two_hours_ago = current_time - (2 * 60 * 60)

    # Process all data into 5-minute intervals
    interval_data = {}
    for entry in data_history:
        interval_timestamp = int(entry["timestamp"] // (5 * 60)) * (5 * 60)
        if interval_timestamp not in interval_data:
            interval_data[interval_timestamp] = {
                "start_count": entry["count"],
                "end_count": entry["count"],
                "timestamp": interval_timestamp,
                "is_visible": interval_timestamp >= two_hours_ago  # Flag for visibility
            }
        else:
            interval_data[interval_timestamp]["end_count"] = entry["count"]

    # Sort all intervals by timestamp
    sorted_intervals = sorted(interval_data.values(), key=lambda x: x["timestamp"])

    # Skip the last interval if it's less than 5 minutes old (incomplete)
    if sorted_intervals and (current_time - sorted_intervals[-1]["timestamp"]) < 300:
        sorted_intervals.pop()

    new_signatures = []
    time_labels = []
    visible_signatures = []
    visible_time_labels = []

    for i in range(len(sorted_intervals)):
        interval = sorted_intervals[i]
        signatures_in_interval = interval["end_count"] - interval["start_count"]

        if i > 0:
            previous_interval = sorted_intervals[i-1]
            signatures_since_previous = interval["start_count"] - previous_interval["end_count"]
            signatures_in_interval += signatures_since_previous

        time_label = datetime.fromtimestamp(interval["timestamp"]).strftime("%H:%M:%S")
        new_signatures.append(signatures_in_interval)
        time_labels.append(time_label)

        # Only include in visible data if within the 2-hour window
        if interval["is_visible"]:
            visible_signatures.append(signatures_in_interval)
            visible_time_labels.append(time_label)

    return jsonify({
        "time_labels": visible_time_labels,
        "new_signatures": visible_signatures,
        "title": "New Signatures Per 5 Minutes (Last 2 Hours)",
        "x_label": "Time (5-minute intervals)",
        "y_label": "Signatures Per 5 Minutes"
    })

def background_refresh():
    while True:
        try:
            current_time = time.time()
            signature_count = asyncio.run(fetch_signature_count())
            if signature_count is not None:
                data_history.append({"count": signature_count, "timestamp": current_time})
                if len(data_history) > 500:
                    data_history.pop(0)
                save_history()
                rates = calculate_rates()
                cache["last_fetch_time"] = current_time
                cache["data"] = {
                    "count": signature_count,
                    "timestamp": current_time,
                    "last_fetch_time": current_time,
                    "formatted_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "per_minute_rate": rates["per_minute_rate"],
                    "per_hour_rate": rates["per_hour_rate"],
                    "estimated_completion_date": rates["estimated_completion_date"],
                    "confidence_interval": rates["confidence_interval"],
                    "progress_percentage": (signature_count / TARGET_SIGNATURES) * 100
                }
        except Exception as e:
            logger.error(f"Background refresh failed: {e}")
        time.sleep(30)

if __name__ == '__main__':
    threading.Thread(target=background_refresh, daemon=True).start()
    threading.Thread(target=periodic_save, daemon=True).start()
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
