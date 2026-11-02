FROM node:22-bookworm-slim AS ui
WORKDIR /ui
COPY services/ui/package.json services/ui/package-lock.json ./
RUN npm ci
COPY services/ui ./
RUN npm run build

FROM python:3.12-slim

RUN useradd --create-home --uid 10001 a2e
WORKDIR /app
COPY services/api /app
COPY --from=ui /ui/dist /app/src/a2e/static
COPY policies /app/policies
RUN pip install --no-cache-dir . \
    && python -c "import pathlib, shutil, a2e; src=pathlib.Path('/app/src/a2e/static'); dst=pathlib.Path(a2e.__file__).resolve().parent/'static'; dst.exists() and shutil.rmtree(dst); shutil.copytree(src, dst)" \
    && chmod 755 /app/docker-entrypoint.sh \
    && chown -R a2e:a2e /app
USER a2e
ENV PYTHONPATH=/app/src \
    A2E_POLICY_DIR=/app/policies \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=20 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready')"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
