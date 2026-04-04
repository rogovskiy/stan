1. python generate_company_summary.py TEM (company description + new record)

2. Add ticker to save_filtered_sec_data.py and run python save_filtered_sec_data.py

3. python download_max_data.py TEM

4. From repo `functions_yahoo`: `source venv/bin/activate && make vendor && make backfill-quarterly TICKER=TEM` (or `PYTHONPATH=vendor:. python -m yahoo.generate_quarterly_timeseries TEM`)

5. Add IR urls in the web 

6. python scan_ir_website.py TEM --verbose

7. Enable autorefresh in the database
