# gunicorn_config.py

bind = "127.0.0.1:5000"
workers = 2  # 2-4 is usually fine unless CPU bound
worker_class = "gthread"
threads = 4  # number of threads per worker
timeout = 120
loglevel = "info"

accesslog = "-"  # stdout
errorlog = "-"   # stderr

preload_app = True
reload = False  # Set to True in development