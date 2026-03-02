# Run from run_youtube. YouTube refresh runs as Firebase Function (functions_youtube).
# Local run: use functions_youtube/run_local.py. Trigger: publish to youtube-refresh-requests.

.PHONY: run create-topic trigger-function

ENV_FILE ?= ../data-fetcher/.env.local

# Run YouTube refresh locally for one subscription (uses functions_youtube). Requires deps in functions_youtube (e.g. venv).
SUBSCRIPTION_ID ?= DCrz7cxOv4OIZWMiC0jN
run:
	@if [ -z "$(SUBSCRIPTION_ID)" ]; then echo "Usage: make run SUBSCRIPTION_ID=<id>"; exit 1; fi
	@if [ ! -f $(ENV_FILE) ]; then echo "Missing $(ENV_FILE). Create it with FIREBASE_* and YOUTUBE_API_KEY."; exit 1; fi
	cd .. && python3 functions_youtube/run_local.py $(SUBSCRIPTION_ID)

# Create Pub/Sub topic youtube-refresh-requests (YouTube; distinct from yf-refresh-requests). Run once per project.
create-topic:
	@PROJECT_ID=$$(grep -v '^\#' $(ENV_FILE) 2>/dev/null | grep FIREBASE_PROJECT_ID | cut -d= -f2- | tr -d '"' | xargs); \
	if [ -z "$$PROJECT_ID" ]; then echo "Set FIREBASE_PROJECT_ID in $(ENV_FILE)"; exit 1; fi; \
	gcloud pubsub topics create youtube-refresh-requests --project="$$PROJECT_ID"

# Publish one message to youtube-refresh-requests. Override: make trigger-function SUBSCRIPTION_ID=abc PROJECT_ID=my-project
PROJECT_ID ?= $(shell grep -v '^\#' $(ENV_FILE) 2>/dev/null | grep FIREBASE_PROJECT_ID | cut -d= -f2- | tr -d '"' | xargs)
trigger-function:
	@if [ -z "$(SUBSCRIPTION_ID)" ]; then echo "Usage: make trigger-function SUBSCRIPTION_ID=<id>"; exit 1; fi
	gcloud pubsub topics publish youtube-refresh-requests --message='{"subscriptionId":"$(SUBSCRIPTION_ID)"}' --project=$(PROJECT_ID)
