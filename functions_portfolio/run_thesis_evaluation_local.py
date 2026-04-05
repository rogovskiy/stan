#!/usr/bin/env python3
"""
Run position thesis evaluation locally (same logic as the queue consumer).

Usage:
    make run-thesis-eval THESIS_DOC_ID=<thesis-doc-id>
    python run_thesis_evaluation_local.py <THESIS_DOC_ID>
"""
import argparse
import logging
import os
import sys

_root = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_root, "vendor")
for _p in (_vendor, _root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_env = os.path.join(os.path.dirname(_root), "data-fetcher", ".env.local")
if not os.path.isfile(_env):
    print("Missing ../data-fetcher/.env.local (FIREBASE_*).")
    sys.exit(1)

from dotenv import load_dotenv

load_dotenv(_env)

if not os.getenv("FIREBASE_PRIVATE_KEY"):
    print("FIREBASE_PRIVATE_KEY not set in ../data-fetcher/.env.local")
    sys.exit(1)


def main() -> None:
    p = argparse.ArgumentParser(
        description="Run grounded thesis evaluation locally for one thesis document"
    )
    p.add_argument(
        "thesis_doc_id",
        nargs="?",
        default=os.environ.get("THESIS_DOC_ID", ""),
        help="Firestore thesis document ID",
    )
    args = p.parse_args()

    thesis_doc_id = args.thesis_doc_id.strip()
    if not thesis_doc_id:
        print("Usage: make run-thesis-eval THESIS_DOC_ID=<thesis-doc-id>")
        sys.exit(1)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from position_thesis_evaluation import run_position_thesis_evaluation

    rc = run_position_thesis_evaluation(thesis_doc_id, quiet=False)
    sys.exit(rc)


if __name__ == "__main__":
    main()
