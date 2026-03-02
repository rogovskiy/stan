import requests
import xml.etree.ElementTree as ET


API_KEY = "AIzaSyDHD611Vjj3krqp7ytgYPfI1NnBsP5LqB8"
#HANDLE = "@MarkMeldrum"
HANDLE = "@Bullishbounce"

def resolve_handle_to_channel_id(handle: str) -> str:
    url = "https://www.googleapis.com/youtube/v3/search"
    params = {
        "part": "snippet",
        "q": handle,
        "type": "channel",
        "maxResults": 1,
        "key": API_KEY,
    }

    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()

    if not data["items"]:
        raise ValueError("Channel not found")

    return data["items"][0]["snippet"]["channelId"]



def latest_videos(channel_id: str) -> list[dict]:
    feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    r = requests.get(feed_url, timeout=20)
    r.raise_for_status()

    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
    }

    root = ET.fromstring(r.text)

    videos = []
    for entry in root.findall("atom:entry", ns):
        videos.append({
            "video_id": entry.findtext("yt:videoId", namespaces=ns),
            "title": entry.findtext("atom:title", namespaces=ns),
            "published": entry.findtext("atom:published", namespaces=ns),
        })

    return videos

if __name__ == "__main__":
    channel_id = resolve_handle_to_channel_id(HANDLE)
    videos = latest_videos(channel_id)
    print("Videos:", videos)
    print("Channel ID:", channel_id)
