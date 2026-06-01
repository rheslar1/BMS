FROM ubuntu:22.04

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN python3 -m venv /opt/bems-ai-venv \
    && /opt/bems-ai-venv/bin/pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY generated ./generated

EXPOSE 8000
EXPOSE 50052
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python3 -c "from urllib.request import urlopen; urlopen('http://localhost:8000/health', timeout=3).read()" || exit 1
CMD ["/opt/bems-ai-venv/bin/python", "app.py"]
