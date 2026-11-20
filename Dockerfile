# Stage 1: build the frontend.
FROM node:26-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: the app.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 OPEN_PALATE_CONTAINER=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=frontend /build/dist ./frontend/dist
RUN useradd --create-home --uid 10001 app \
    && mkdir -p /data \
    && chown -R app:app /data \
    && chmod +x start.sh docker-entrypoint.sh
# No USER line: the entrypoint starts as root to fix /data ownership, then runs
# start.sh as uid 10001 (setpriv).
VOLUME /data
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
