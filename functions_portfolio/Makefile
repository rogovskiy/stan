# Run from functions_portfolio. Deploys from repo root (where firebase.json is).
# vendor/ is gitignored; run "make vendor" before deploy.

.PHONY: deploy deploy-portfolio run run-thesis-eval vendor trigger-publish trigger-thesis-refresh

VENDOR_ROOT := vendor
DATA_FETCHER := ..
VENDOR_SOURCES := $(DATA_FETCHER)/data-fetcher/services/firebase_base_service.py \
	$(DATA_FETCHER)/data-fetcher/services/channels_config_service.py \
	$(DATA_FETCHER)/data-fetcher/services/portfolio_service.py \
	$(DATA_FETCHER)/data-fetcher/services/price_data_service.py \
	$(DATA_FETCHER)/data-fetcher/services/job_run_service.py \
	$(DATA_FETCHER)/data-fetcher/services/prompt_config_service.py \
	$(DATA_FETCHER)/data-fetcher/services/prompt_execution_log_service.py \
	$(DATA_FETCHER)/data-fetcher/extraction_utils.py \
	$(DATA_FETCHER)/data-fetcher/dynamic_prompt_runner.py \
	$(DATA_FETCHER)/data-fetcher/services/__init__.py

vendor: $(VENDOR_ROOT)/.stamp

$(VENDOR_ROOT)/.stamp: $(VENDOR_SOURCES)
	@mkdir -p $(VENDOR_ROOT)/services
	rm -f $(VENDOR_ROOT)/portfolio_channel_exposure.py
	cp $(DATA_FETCHER)/data-fetcher/services/firebase_base_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/channels_config_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/portfolio_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/price_data_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/job_run_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/prompt_config_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/prompt_execution_log_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/__init__.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/extraction_utils.py $(VENDOR_ROOT)/
	cp $(DATA_FETCHER)/data-fetcher/dynamic_prompt_runner.py $(VENDOR_ROOT)/
	@touch $(VENDOR_ROOT)/.stamp

deploy: vendor deploy-portfolio

deploy-portfolio:
	cd .. && firebase deploy --only functions:portfolio:portfolio_weekly_publish,functions:portfolio:portfolio_channel_exposure_refresh,functions:portfolio:position_thesis_evaluation_refresh

REGION ?= us-central1
SCHEDULER_JOB ?= firebase-schedule-portfolio_weekly_publish-$(REGION)
THESIS_EVALUATION_TOPIC ?= position-thesis-evaluation-requests
THESIS_DOC_ID ?=
trigger-publish:
	gcloud scheduler jobs run $(SCHEDULER_JOB) --location=$(REGION)

trigger-thesis-refresh:
	@test -n "$(THESIS_DOC_ID)" || (echo "Usage: make trigger-thesis-refresh THESIS_DOC_ID=<thesis-doc-id> [PORTFOLIO_ID=<portfolio-id>]" && exit 1)
	@gcloud pubsub topics publish $(THESIS_EVALUATION_TOPIC) \
		--message='{"thesisDocId":"$(THESIS_DOC_ID)","portfolioId":"$(PORTFOLIO_ID)"}'

# Default portfolio for local channel exposure (override: make run PORTFOLIO_ID=...)
PORTFOLIO_ID ?= JrKlHwhZewfMNiY3pNzl

run: vendor
	source venv/bin/activate && python run_local.py $(PORTFOLIO_ID)

run-thesis-eval: vendor
	@test -n "$(THESIS_DOC_ID)" || (echo "Usage: make run-thesis-eval THESIS_DOC_ID=<thesis-doc-id>" && exit 1)
	source venv/bin/activate && python run_thesis_evaluation_local.py $(THESIS_DOC_ID)
