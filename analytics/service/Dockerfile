# The analytics service's worker (analytics/service). Built by Railway from this
# folder; settings come from Railway's variables (--env process).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-deps .

# Never run as root.
RUN useradd --create-home --uid 10001 worker
USER worker

# SIGTERM (a redeploy or scale-down) stops it cleanly: no new jobs, the running
# one gets SHUTDOWN_GRACE_SECONDS, then is given back to the queue.
STOPSIGNAL SIGTERM
# The image refuses production by default; the production service's start command
# (railway.json) adds --allow-production on purpose.
CMD ["dinerai-analytics", "worker", "--env", "process"]
