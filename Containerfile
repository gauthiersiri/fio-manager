FROM registry.access.redhat.com/ubi9/python-312:latest
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY frontend/dist ./static
ENV FIO_STATIC_DIR=/app/static FIO_DATA_DIR=/data PYTHONUNBUFFERED=1
EXPOSE 8080 8081
USER 1001
CMD ["python", "-m", "app.main"]
