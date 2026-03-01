# Run from functions_yahoo. Deploys from repo root (where firebase.json is).
# Vendor is gitignored; run "make vendor" or any target that needs it to copy from data-fetcher.
# Does NOT copy yahoo/ (lives in this package).

.PHONY: deploy deploy-yahoo run vendor trigger-function

VENDOR_ROOT := vendor
DATA_FETCHER := ..
VENDOR_SOURCES := \
	$(DATA_FETCHER)/data-fetcher/services/firebase_base_service.py \
	$(DATA_FETCHER)/data-fetcher/services/price_data_service.py \
	$(DATA_FETCHER)/data-fetcher/services/financial_data_service.py \
	$(DATA_FETCHER)/data-fetcher/services/analyst_data_service.py \
	$(DATA_FETCHER)/data-fetcher/services/job_run_service.py \
	$(DATA_FETCHER)/data-fetcher/services/__init__.py \
	$(DATA_FETCHER)/data-fetcher/yfinance_service.py \
	$(DATA_FETCHER)/data-fetcher/financial_data_validator.py

vendor: $(VENDOR_ROOT)/.stamp

$(VENDOR_ROOT)/.stamp: $(VENDOR_SOURCES)
	@mkdir -p $(VENDOR_ROOT)/services
	cp $(DATA_FETCHER)/data-fetcher/services/firebase_base_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/price_data_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/financial_data_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/analyst_data_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/job_run_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/__init__.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/yfinance_service.py $(VENDOR_ROOT)/
	cp $(DATA_FETCHER)/data-fetcher/financial_data_validator.py $(VENDOR_ROOT)/
	@touch $(VENDOR_ROOT)/.stamp

deploy: vendor deploy-yahoo

deploy-yahoo:
	cd .. && firebase deploy --only functions:yahoo:yahoo_refresh

# Run Yahoo refresh locally (one ticker, default AAPL). Requires venv + ../data-fetcher/.env.local
run: vendor
	source venv/bin/activate && python run_local.py AAPL

# Publish one message to yf-refresh-requests to trigger the deployed function. Override: make trigger-function TICKER=MSFT PROJECT_ID=my-project
PROJECT_ID ?= stan-1464e
TICKER ?= AAPL
trigger-function:
	gcloud pubsub topics publish yf-refresh-requests --message='{"ticker":"$(TICKER)"}' --project=$(PROJECT_ID)
