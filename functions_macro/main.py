# Macro refresh: scheduled function (no Pub/Sub).
# vendor/ = shared code (extraction_utils, firebase_base_service, channels_config_service).
# macro/ and market_shifts/ = macro-only code in this package.
import logging
import os
import sys

# Configure logging first (same as functions/main.py) so logger.info etc. show in Cloud Logging
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level, logging.INFO))

_root = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_root, "vendor")
for _p in (_vendor, _root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from firebase_admin import initialize_app

initialize_app()

from firebase_functions import scheduler_fn
from firebase_functions.params import SecretParam

from macro.refresh_macro_scores import refresh_macro_scores

# Param name must be UPPER_SNAKE_CASE; Secret Manager secret must match: GEMINI_API_KEY
GEMINI_API_KEY = SecretParam("GEMINI_API_KEY")
from market_shifts.scan_market_shifts import run_scan_market_shifts

logger = logging.getLogger(__name__)


@scheduler_fn.on_schedule(
    schedule="0 6 * * *",
    memory=512,
    timeout_sec=120,
    concurrency=1,
    secrets=[GEMINI_API_KEY],
)
def macro_refresh(event: scheduler_fn.ScheduledEvent) -> None:
    """Run macro risk scores then market shifts + summaries (daily at 06:00 UTC)."""
    # Expose secret as GEMINI_API_KEY so extraction_utils / pipeline see it
    os.environ["GEMINI_API_KEY"] = GEMINI_API_KEY.value or ""
    logger.info("Macro refresh started at: %s", event.schedule_time)
    try:
        result = refresh_macro_scores(verbose=True, save_to_firebase=True)
        print(f"refresh_macro_scores done: asOf={result.get('asOf')}", flush=True)
        print("Starting market shifts scan (extraction then summaries; may take 2-5 min)...", flush=True)
        sys.stdout.flush()
        shifts_result = run_scan_market_shifts(
            skip_deep_analysis=True, skip_merge=True, verbose=False
        )
        print(
            f"run_scan_market_shifts done: shift_count={shifts_result.get('shift_count')}, merges_applied={shifts_result.get('merges_applied')}",
            flush=True,
        )
    except Exception as e:
        logger.exception("Macro refresh failed: %s", e)
        raise
