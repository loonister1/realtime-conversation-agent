FROM python:3.11-bookworm

ENV PYTHONUNBUFFERED=1

RUN apt update

# Install uv
RUN pip install uv==0.8.22

RUN mkdir /app
WORKDIR /app

COPY . /app
RUN uv pip install -r /app/requirements.txt --system
