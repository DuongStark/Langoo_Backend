import time
import uuid

from curl_cffi import requests as rq

from muse import (
    Gateway,
    _hatch_headers,
    fetch_access_token,
    fetch_session_info,
    load_cookies,
)

COOKIE_FILE = r"C:\Users\PC\Desktop\muse-native\cookies-acc2.json"


def main() -> None:
    cookies = load_cookies(COOKIE_FILE)
    info = fetch_session_info(cookies)
    print("VM", info.get("vm_id"), info.get("vm_state"), info.get("status"))

    token = fetch_access_token(cookies)
    body = {
        "vm_id": info["vm_id"],
        "retry_count": 0,
        "connect_attempt_id": str(uuid.uuid4()),
    }
    response = rq.post(
        "https://muse.ai/api/hatch/vm/wake",
        headers=_hatch_headers(cookies, token),
        json=body,
        impersonate="chrome",
        timeout=30,
    )
    print("WAKE", response.status_code, response.text[:300])

    time.sleep(3)
    try:
        gateway = Gateway(cookies)
        print("GATEWAY_OK", gateway.vm_id)
        gateway.close()
    except Exception as exc:
        print("GATEWAY_ERR", type(exc).__name__, str(exc)[:300])


if __name__ == "__main__":
    main()
