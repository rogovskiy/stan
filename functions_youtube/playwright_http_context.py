"""
Execute raw HTTP in Playwright browser context – two approaches.

1) Use the page's request context (same cookies as the page)
   page.request shares cookie storage with the page. Any GET/POST you do
   automatically gets the same Cookie header the page would send.

2) Capture a request the page made and replay it (or inspect it)
   Listen to page.on("request") to get url, method, headers, post_data.
   Then either replay with page.request or copy to requests/httpx.
"""

from playwright.sync_api import sync_playwright


def http_in_context_example():
    """
    Make a raw HTTP call using the same cookies/context as the page.
    No browser UI request is made – this is Playwright's APIRequestContext.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        # Now page has YouTube cookies. Any request via page.request
        # will send those cookies automatically.
        response = page.request.get(
            "https://www.youtube.com/youtubei/v1/player?key=...",
            headers={"Content-Type": "application/json"},
            # data=... for POST body
        )
        # response.ok, response.status, response.headers, response.text(), response.json()
        browser.close()
        return response


def capture_and_replay_example():
    """
    Capture the raw request when the page makes it, then replay it
    (or log url/method/headers/post_data for debugging).
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        captured = []

        def on_request(request):
            # Only capture a specific API call, e.g. YouTube innertube
            if "youtubei" in request.url or "player" in request.url:
                captured.append({
                    "url": request.url,
                    "method": request.method,
                    "headers": request.all_headers(),  # includes cookie
                    "post_data": request.post_data,     # None for GET
                    "post_data_json": request.post_data_json,
                })

        page.on("request", on_request)
        page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        page.wait_for_timeout(5000)
        browser.close()

        # Replay first captured request using the same context (would need
        # to run inside the playwright block so page.request is still valid):
        # if captured:
        #     r = captured[0]
        #     if r["method"] == "GET":
        #         resp = page.request.get(r["url"], headers=r["headers"])
        #     else:
        #         resp = page.request.fetch(r["url"], method=r["method"], headers=r["headers"], data=r["post_data"])
        return captured


def route_fetch_example():
    """
    Inside a route handler, route.fetch() re-executes the request and
    returns the response (so you can modify and fulfill with it).
    This is "run the raw HTTP call" and get the result.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        def handle(route):
            # Execute the request as the browser would and get the response
            response = route.fetch()
            body = response.text()
            # Optionally modify body, then:
            route.fulfill(response=response, body=body)

        page.route("**/youtubei/**", handle)
        page.goto("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        page.wait_for_timeout(3000)
        browser.close()


# Summary:
# - Same context as page:  page.request.get(url) / .post(url, data=...) / .fetch(...)
# - Capture request:      page.on("request", lambda r: ...)  → r.url, r.method, r.all_headers(), r.post_data
# - Re-execute in route:  route.fetch()  → returns APIResponse
