FROM python:3.11-slim

WORKDIR /app

# Install spatial index C-libraries for Rtree, Shapely, and OSMnx
RUN apt-get update && apt-get install -y --no-install-recommends \
    libspatialindex-dev \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Google Cloud Run dynamically injects $PORT (default 8080)
ENV PORT=8080

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
