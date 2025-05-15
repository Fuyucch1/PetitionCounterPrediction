# Gunicorn configuration file
from app import app
import logging

# Bind to port 5000
bind = "127.0.0.1:5000"

# Number of worker processes
workers = 5

# Worker class to use
worker_class = "sync"

# Timeout for worker processes (in seconds)
timeout = 120

# Log level
loglevel = "info"

# Custom access log format that excludes 404 requests
# Define a function to filter out 404 requests
def access_log_filter(log_record):
    # Check if the status code is 404 and filter it out
    return not (log_record.status == '404')

# Configure the logger to use our filter
logger = logging.getLogger('gunicorn.access')
logger.addFilter(access_log_filter)

# Access log format
accesslog = "-"  # Log to stdout
errorlog = "-"   # Log to stderr

# Preload application code before forking worker processes
preload_app = True

# Reload workers when code changes (for development)
# Set to False in production
reload = False
