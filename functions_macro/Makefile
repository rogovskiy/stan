# Run from functions_macro. Deploys from repo root (where firebase.json is).
# Vendor is gitignored; run "make vendor" or any target that needs it to copy from data-fetcher.

.PHONY: deploy deploy-macro run vendor trigger-function

VENDOR_ROOT := vendor
DATA_FETCHER := ..
VENDOR_SOURCES := $(DATA_FETCHER)/data-fetcher/extraction_utils.py \
	$(DATA_FETCHER)/data-fetcher/services/firebase_base_service.py \
	$(DATA_FETCHER)/data-fetcher/services/channels_config_service.py \
	$(DATA_FETCHER)/data-fetcher/services/job_run_service.py \
	$(DATA_FETCHER)/data-fetcher/services/__init__.py

# Populate vendor from data-fetcher if missing (vendor/ is in .gitignore).
vendor: $(VENDOR_ROOT)/.stamp

$(VENDOR_ROOT)/.stamp: $(VENDOR_SOURCES)
	@mkdir -p $(VENDOR_ROOT)/services
	cp $(DATA_FETCHER)/data-fetcher/extraction_utils.py $(VENDOR_ROOT)/
	cp $(DATA_FETCHER)/data-fetcher/services/firebase_base_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/channels_config_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/job_run_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/__init__.py $(VENDOR_ROOT)/services/
	@touch $(VENDOR_ROOT)/.stamp

deploy: vendor deploy-macro

deploy-macro:
	cd .. && firebase deploy --only functions:macro:macro_refresh

# Invoke the deployed macro function via its Cloud Scheduler job.
REGION ?= us-central1
SCHEDULER_JOB ?= firebase-schedule-macro_refresh-us-central1
trigger-function:
	gcloud scheduler jobs run $(SCHEDULER_JOB) --location=$(REGION)

# Run macro refresh locally (verbose). Requires venv + ../data-fetcher/.env.local
run: vendor
	source venv/bin/activate && python run_local.py
