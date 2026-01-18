import logging

def root_sig():
    root = logging.getLogger()
    return [(type(h).__name__,
             type(getattr(h, "formatter", None)).__name__,
             getattr(getattr(h, "formatter", None), "_fmt", None))
            for h in root.handlers]

def show_diff(label, before):
    after = root_sig()
    if after != before:
        print(f"\n!!! ROOT LOGGING CHANGED: {label} !!!")
        print("before:", before)
        print("after :", after)

before = root_sig()
import crawlee  # or from crawlee... import ...
show_diff("after importing crawlee", before)

before = root_sig()
show_diff("after IRDocumentService()", before)
