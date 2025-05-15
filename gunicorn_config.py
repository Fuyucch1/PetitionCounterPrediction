# gunicorn_config.py

bind = "127.0.0.1:5000"
workers = 3  # 2-4 is usually fine unless CPU bound
worker_class = "uvicorn.workers.UvicornWorker"
timeout = 120
loglevel = "info"

accesslog = "-"  # stdout
errorlog = "-"   # stderr

preload_app = True
reload = False  # Set to True in development