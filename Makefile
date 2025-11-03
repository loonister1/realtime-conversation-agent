SHELL=/bin/bash

dev_compose    := REQUIREMENT_FILE=requirements/dev.txt docker compose -f docker-compose.dev.yml
stage_compose  := REQUIREMENT_FILE=requirements/stage.txt docker compose -f docker-compose.stage.yml
prod_compose   := REQUIREMENT_FILE=requirements/prod.txt docker compose -f docker-compose.prod.yml
success        := success

%.deploy: %.build %.down %.up.d
	@echo "Deployment complete for $* environment"

%.build:
	@$($*_compose) build

%.up:
	@$($*_compose) up

%.up.d:
	@$($*_compose) up -d

%.down:
	@$($*_compose) down --remove-orphans

%.restart:
	@$($*_compose) restart

%.logs:
	@$($*_compose) logs -f

%.shell:
	@$($*_compose) exec app /bin/bash

%.migrate:
	@$($*_compose) exec app alembic upgrade head

%.makemigration:
	@$($*_compose) exec app alembic revision --autogenerate -m "$(msg)"

%.upgrade:
	@$($*_compose) exec app alembic upgrade head

%.current:
	@$($*_compose) exec app alembic current

%.history:
	@$($*_compose) exec app alembic history

%.test:
	@$($*_compose) exec app pytest

%.clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	@$($*_compose) down -v

help:
	@echo "Available commands:"
	@echo "  dev.build        Build dev containers"
	@echo "  dev.up           Run dev containers"
	@echo "  dev.up.d         Run dev containers in detached mode"
	@echo "  dev.down         Stop dev containers"
	@echo "  dev.restart      Restart dev containers"
	@echo "  dev.logs         Show logs for dev containers"
	@echo "  dev.shell        Shell into dev app container"
	@echo "  dev.migrate      Run DB migrations in dev (apply existing migrations)"
	@echo "  dev.makemigration  Create a new DB migration in dev (msg=...)"
	@echo "  dev.upgrade      Apply migrations in dev (same as migrate)"
	@echo "  dev.current      Show current migration in dev"
	@echo "  dev.history      Show migration history in dev"
	@echo "  dev.test         Run tests in dev"
	@echo "  dev.clean        Clean dev environment"
	@echo "  stage.deploy     Deploy stage environment (build, down, up, migrate)"
	@echo "  stage.build      Build stage containers"
	@echo "  stage.up         Run stage containers"
	@echo "  stage.up.d       Run stage containers in detached mode"
	@echo "  stage.down       Stop stage containers"
	@echo "  stage.restart    Restart stage containers"
	@echo "  stage.logs       Show logs for stage containers"
	@echo "  stage.shell      Shell into stage app container"
	@echo "  stage.migrate      Run DB migrations in stage (apply existing migrations)"
	@echo "  stage.makemigration  Create a new DB migration in stage (msg=...)"
	@echo "  stage.upgrade      Apply migrations in stage (same as migrate)"
	@echo "  stage.current      Show current migration in stage"
	@echo "  stage.history      Show migration history in stage"
	@echo "  stage.test       Run tests in stage"
	@echo "  stage.clean      Clean stage environment"
	@echo "  prod.deploy      Deploy prod environment (build, down, up, migrate)"
	@echo "  prod.build       Build prod containers"
	@echo "  prod.up          Run prod containers"
	@echo "  prod.up.d        Run prod containers in detached mode"
	@echo "  prod.down        Stop prod containers"
	@echo "  prod.restart     Restart prod containers"
	@echo "  prod.logs        Show logs for prod containers"
	@echo "  prod.shell       Shell into prod app container"
	@echo "  prod.migrate      Run DB migrations in prod (apply existing migrations)"
	@echo "  prod.makemigration  Create a new DB migration in prod (msg=...)"
	@echo "  prod.upgrade      Apply migrations in prod (same as migrate)"
	@echo "  prod.current      Show current migration in prod"
	@echo "  prod.history      Show migration history in prod"
	@echo "  prod.test        Run tests in prod"
	@echo "  prod.clean       Clean prod environment"
