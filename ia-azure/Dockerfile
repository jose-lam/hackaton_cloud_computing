FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py geo_osm.py gemini_engine.py ./

RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8080

# Azure Container Apps define PORT (--env-vars PORT=8080, --target-port 8080); exec para que uvicorn reciba SIGTERM directamente.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --no-access-log"]
