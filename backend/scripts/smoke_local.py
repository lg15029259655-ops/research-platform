"""Safe local connectivity smoke test; never prints credentials or response bodies."""

import httpx
import json
import sys
from pathlib import Path


def main() -> None:
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=60) as client:
        session = client.get("/api/session")
        cookie = client.cookies.get("medread_session")
        print(f"session_status={session.status_code} cookie_present={bool(cookie)}")
        probe = client.post("/api/ai/probe", json={"message": "请只回答：连接正常。"})
        done = '"type":"done"' in probe.text or '"type": "done"' in probe.text
        error = '"type":"error"' in probe.text or '"type": "error"' in probe.text
        print(f"probe_status={probe.status_code} stream_done={done} stream_error={error}")
        if len(sys.argv) > 1:
            path = Path(sys.argv[1])
            with path.open("rb") as source:
                uploaded = client.post("/api/papers", files={"file": (path.name, source, "application/pdf")})
            print(f"upload_status={uploaded.status_code}")
            uploaded.raise_for_status()
            paper = uploaded.json()
            try:
                figure = next((unit for unit in paper["units"] if unit["kind"] == "FIGURE"), None)
                if figure:
                    analysis = client.post(f"/api/papers/{paper['id']}/chat", json={"action": "NAVIGATE", "unit_id": figure["id"]}, timeout=120)
                    events = [json.loads(line[6:]) for line in analysis.text.splitlines() if line.startswith("data: ")]
                    done_event = next((event for event in events if event.get("type") == "done"), {})
                    print(f"figure_status={analysis.status_code} actual_page={figure['actual_pdf_page']} visual_verified={done_event.get('visual_verified')} stream_done={bool(done_event)}")
            finally:
                client.delete(f"/api/papers/{paper['id']}")


if __name__ == "__main__":
    main()
