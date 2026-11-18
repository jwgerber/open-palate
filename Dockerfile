# Stage 1: build the frontend.
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: the app.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=frontend /build/dist ./frontend/dist
RUN useradd --create-home --uid 10001 app \
    && mkdir -p /data \
    && chown -R app:app /data \
    && chmod +x start.sh
USER app
VOLUME /data
EXPOSE 8000
CMD ["./start.sh"]
