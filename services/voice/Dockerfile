FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng libsndfile1 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.7.5
WORKDIR /app
COPY services/voice/pyproject.toml services/voice/uv.lock ./
RUN uv sync --frozen --no-dev
COPY services/voice/app.py services/voice/kitten_cpu.py services/voice/download_models.py services/voice/models.json ./
COPY services/voice/test_api.py ./
COPY services/voice/licenses ./licenses
COPY services/voice/THIRD_PARTY.md ./THIRD_PARTY.md
ENV PATH="/app/.venv/bin:$PATH" HF_HUB_DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
RUN useradd --create-home --user-group --uid 10001 cityvoice && mkdir /models && chown cityvoice:cityvoice /models
USER cityvoice
EXPOSE 4200
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4200", "--no-access-log"]
