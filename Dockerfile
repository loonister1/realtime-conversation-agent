FROM python:3.11-bookworm

ENV PYTHONUNBUFFERED=1
ARG REQUIREMENT_FILE

RUN apt update

# Install uv
RUN pip install uv==0.8.22

RUN mkdir /app
WORKDIR /app

COPY requirements/ /app/requirements/
RUN uv pip install -r /app/$REQUIREMENT_FILE --system
