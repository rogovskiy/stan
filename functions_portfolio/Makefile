# Run from functions_portfolio. Deploys from repo root (where firebase.json is).
# vendor/ is gitignored; run "make vendor" before deploy.

.PHONY: deploy deploy-portfolio run vendor trigger-publish

VENDOR_ROOT := vendor
DATA_FETCHER := ..
VENDOR_SOURCES := $(DATA_FETCHER)/data-fetcher/services/firebase_base_service.py \
	$(DATA_FETCHER)/data-fetcher/services/channels_config_service.py \
	$(DATA_FETCHER)/data-fetcher/services/portfolio_service.py \
	$(DATA_FETCHER)/data-fetcher/services/price_data_service.py \
	$(DATA_FETCHER)/data-fetcher/services/job_run_service.py \
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
	cp $(DATA_FETCHER)/data-fetcher/services/__init__.py $(VENDOR_ROOT)/services/
	@touch $(VENDOR_ROOT)/.stamp

deploy: vendor deploy-portfolio

deploy-portfolio:
	cd .. && firebase deploy --only functions:portfolio:portfolio_weekly_publish,functions:portfolio:portfolio_channel_exposure_refresh

REGION ?= us-central1
SCHEDULER_JOB ?= firebase-schedule-portfolio_weekly_publish-$(REGION)
trigger-publish:
	gcloud scheduler jobs run $(SCHEDULER_JOB) --location=$(REGION)

# Default portfolio for local channel exposure (override: make run PORTFOLIO_ID=...)
PORTFOLIO_ID ?= JrKlHwhZewfMNiY3pNzl

run: vendor
	source venv/bin/activate && python run_local.py $(PORTFOLIO_ID)
