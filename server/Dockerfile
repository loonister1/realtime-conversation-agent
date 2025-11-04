FROM python:3.11-bookworm

ENV PYTHONUNBUFFERED=1

RUN apt update
RUN apt-get install -y portaudio19-dev

# Install uv
RUN pip install uv==0.8.22

RUN mkdir /app
WORKDIR /app

COPY ../pyproject.toml /app/pyproject.toml
RUN uv pip install -e /app --system
