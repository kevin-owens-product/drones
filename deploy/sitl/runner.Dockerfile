FROM python:3.12-slim
RUN apt-get -qq update && apt-get -qq install -y gcc libc6-dev make docker.io >/dev/null && pip -q install --root-user-action=ignore pymavlink numpy
