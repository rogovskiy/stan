#!/usr/bin/env python3
"""Check GOOG quarters with missing cash flow"""

import os
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(__file__), '.env.local')
load_dotenv(env_path)

from firebase_cache import FirebaseCache

cache = FirebaseCache()

# Check what's in Firebase for these quarters
for qk in ['2013Q4', '2025Q2', '2025Q3']:
    data = cache.get_sec_financial_data('GOOG', qk)
    if data:
        print(f'{qk}:')
        print(f'  data_source: {data.get("data_source")}')
        print(f'  has income_statement: {bool(data.get("income_statement"))}')
        print(f'  has cash_flow_statement: {bool(data.get("cash_flow_statement"))}')
        cf = data.get('cash_flow_statement', {})
        if cf:
            print(f'  cash_flow keys: {list(cf.keys())}')
        print()
    else:
        print(f'{qk}: No data in Firebase\n')
