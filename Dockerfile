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
# Stage 2: Production Python Runtime
# ==========================================
FROM python:3.11-slim
WORKDIR /app

# Install minimal system libraries for PDF rendering and GLib
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python backend dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source, branding, and built frontend
COPY catlabel/ ./catlabel/
COPY logo.webp ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create persistent data directory for fonts, database, and templates
RUN mkdir -p /app/data/fonts
VOLUME ["/app/data"]

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "catlabel.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
