# BE quét CCCD: Flask + OpenCV (YOLO ONNX, Haar) + Groq OCR, chạy bằng gunicorn.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=10000 \
    OPENCV_THREADS=1 \
    MALLOC_ARENA_MAX=2

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Không chạy bằng root
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 10000

# 1 worker để vừa RAM 512MB (Render free); threads xử lý song song yêu cầu chờ Groq.
# timeout 180s: Groq có thể tự thử lại khi bị giới hạn hạn mức.
CMD ["sh", "-c", "exec gunicorn app:app --bind 0.0.0.0:${PORT} --workers 1 --threads 4 --timeout 180 --access-logfile -"]
