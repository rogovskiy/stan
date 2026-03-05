# Run from functions_youtube. Deploys from repo root (where firebase.json is).
# Vendor is gitignored; run "make vendor" or any target that needs it to copy from data-fetcher.

.PHONY: deploy deploy-youtube run vendor trigger-function create-topic test-transcript trigger-analysis run-analysis

VENDOR_ROOT := vendor
DATA_FETCHER := ..
ENV_FILE ?= $(DATA_FETCHER)/data-fetcher/.env.local
VENDOR_SOURCES := \
	$(DATA_FETCHER)/data-fetcher/extraction_utils.py \
	$(DATA_FETCHER)/data-fetcher/dynamic_prompt_runner.py \
	$(DATA_FETCHER)/data-fetcher/services/firebase_base_service.py \
	$(DATA_FETCHER)/data-fetcher/services/job_run_service.py \
	$(DATA_FETCHER)/data-fetcher/services/prompt_config_service.py \
	$(DATA_FETCHER)/data-fetcher/services/prompt_execution_log_service.py \
	$(DATA_FETCHER)/data-fetcher/services/__init__.py

# Populate vendor from data-fetcher if missing (vendor/ is in .gitignore).
vendor: $(VENDOR_ROOT)/.stamp

$(VENDOR_ROOT)/.stamp: $(VENDOR_SOURCES)
	@mkdir -p $(VENDOR_ROOT)/services
	cp $(DATA_FETCHER)/data-fetcher/extraction_utils.py $(VENDOR_ROOT)/
	cp $(DATA_FETCHER)/data-fetcher/dynamic_prompt_runner.py $(VENDOR_ROOT)/
	cp $(DATA_FETCHER)/data-fetcher/services/firebase_base_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/job_run_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/prompt_config_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/prompt_execution_log_service.py $(VENDOR_ROOT)/services/
	cp $(DATA_FETCHER)/data-fetcher/services/__init__.py $(VENDOR_ROOT)/services/
	@touch $(VENDOR_ROOT)/.stamp

deploy: vendor deploy-youtube

deploy-youtube:
	cd .. && firebase deploy --only functions:youtube

# Run YouTube refresh locally for one subscription. Requires venv + ../data-fetcher/.env.local (FIREBASE_*, YOUTUBE_API_KEY).
SUBSCRIPTION_ID ?= DCrz7cxOv4OIZWMiC0jN
run: vendor
	@if [ -z "$(SUBSCRIPTION_ID)" ]; then echo "Usage: make run SUBSCRIPTION_ID=<id>"; exit 1; fi
	@if [ ! -f $(ENV_FILE) ]; then echo "Missing $(ENV_FILE). Create it with FIREBASE_* and YOUTUBE_API_KEY."; exit 1; fi
	source venv/bin/activate && python run_local.py $(SUBSCRIPTION_ID)

# Create Pub/Sub topics. Run once per project.
create-topic:
	@PROJECT_ID=$$(grep -v '^\#' $(ENV_FILE) 2>/dev/null | grep FIREBASE_PROJECT_ID | cut -d= -f2- | tr -d '"' | xargs); \
	if [ -z "$$PROJECT_ID" ]; then echo "Set FIREBASE_PROJECT_ID in $(ENV_FILE)"; exit 1; fi; \
	gcloud pubsub topics create youtube-refresh-requests --project="$$PROJECT_ID"; \
	gcloud pubsub topics create youtube-transcript-analysis-requests --project="$$PROJECT_ID"

# Publish one message to youtube-refresh-requests to trigger the deployed function. Override: make trigger-function SUBSCRIPTION_ID=abc PROJECT_ID=my-project
PROJECT_ID ?= $(shell grep -v '^\#' $(ENV_FILE) 2>/dev/null | grep FIREBASE_PROJECT_ID | cut -d= -f2- | tr -d '"' | xargs)
trigger-function:
	@if [ -z "$(SUBSCRIPTION_ID)" ]; then echo "Usage: make trigger-function SUBSCRIPTION_ID=<id>"; exit 1; fi
	gcloud pubsub topics publish youtube-refresh-requests --message='{"subscriptionId":"$(SUBSCRIPTION_ID)"}' --project=$(PROJECT_ID)

# Run transcript analysis locally (Storage → Gemini → Firestore). No deployment. Requires GEMINI_API_KEY in .env.local.
# Usage: make run-analysis
#        make run-analysis VIDEO_ID=abc123xyz
run-analysis:
	@if [ ! -f $(ENV_FILE) ]; then echo "Missing $(ENV_FILE). Create it with FIREBASE_* and GEMINI_API_KEY."; exit 1; fi
	source venv/bin/activate && python run_transcript_analysis_local.py $(if $(VIDEO_ID),--video-id $(VIDEO_ID),)

# Trigger transcript analysis (publish to Pub/Sub so Cloud Function runs): all or one video.
# Usage: make trigger-analysis
#        make trigger-analysis DRY_RUN=1
#        make trigger-analysis VIDEO_ID=abc123xyz
trigger-analysis:
	@if [ ! -f $(ENV_FILE) ]; then echo "Missing $(ENV_FILE). Create it with FIREBASE_*."; exit 1; fi
	source venv/bin/activate && python trigger_analysis.py $(if $(VIDEO_ID),--video-id $(VIDEO_ID),) $(if $(DRY_RUN),--dry-run,)

# Extract transcript via Playwright (pip install playwright && playwright install chromium).
# Usage: make test-transcript URL="https://www.youtube.com/watch?v=VIDEO_ID"   or  URL=VIDEO_ID
test-transcript:
	@if [ -z "$(URL)" ]; then echo "Usage: make test-transcript URL=<youtube_url_or_video_id>"; exit 1; fi
	source venv/bin/activate && python test_transcript_playwright.py "$(URL)"
