# ==========================================
# Stage 1: Build Frontend Assets
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# The Vite config expects logo.webp at the parent directory of frontend
COPY logo.webp ./
COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm install
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Build Python Virtual Environment
# ==========================================
FROM python:3.11-slim AS python-builder
WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    find /opt/venv -type d -name "tests" -prune -exec rm -rf {} + && \
    find /opt/venv -type d -name "test" -prune -exec rm -rf {} + && \
    find /opt/venv -type d -name "__pycache__" -prune -exec rm -rf {} + && \
    find /opt/venv -name "*.pyc" -delete && \
    find /opt/venv -name "*.pyo" -delete

# ==========================================
# Stage 3: Clean Production Runtime
# ==========================================
FROM python:3.11-slim AS runtime
WORKDIR /app

# Copy optimized virtual environment from builder
COPY --from=python-builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy backend source, branding, and precompiled frontend assets
COPY catlabel/ ./catlabel/
COPY logo.webp ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create persistent data directory for fonts, database, and templates
RUN mkdir -p /app/data/fonts
VOLUME ["/app/data"]

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

# Native Python healthcheck with zero system package dependencies
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

CMD ["uvicorn", "catlabel.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
