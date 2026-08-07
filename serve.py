#!/usr/bin/env python3
"""
Notes Gallery — optional local launcher.

You do NOT need this to use Notes Gallery on your computer: just double-click
index.html. This launcher is handy when you want to:
  * open Notes Gallery on your PHONE (same Wi-Fi as this computer), or
  * guarantee browser storage works reliably (some browsers restrict it
    for file:// pages).

Run it by double-clicking "Start Notes Gallery.bat" (Windows) or:
    python serve.py

Then open the printed address. On your phone, use the http://<PC-IP>:8765 one.
Stop the server with Ctrl+C or by closing the window.

NOTE: storage still lives inside the browser (IndexedDB), separately per
device/browser. Use  ⋯ → Export  to back up to a .json in your Storage/ folder,
and Import it on another device to move your workspace across.
"""
import http.server
import os
import socket
import webbrowser
from functools import partial

PORT = 8765
HERE = os.path.dirname(os.path.abspath(__file__))


def lan_ip():
    """Best-effort local network IP (no traffic actually sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # avoid stale-cache surprises while iterating
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the console quiet


def main():
    handler = partial(Handler, directory=HERE)
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler) as httpd:
        ip = lan_ip()
        line = "=" * 52
        print(line)
        print("  [#]  Notes Gallery is running")
        print(line)
        print(f"  On this computer : http://localhost:{PORT}/")
        print(f"  On your phone    : http://{ip}:{PORT}/")
        print("     (phone must be on the same Wi-Fi network)")
        print(line)
        print("  Press Ctrl+C to stop.")
        try:
            webbrowser.open(f"http://localhost:{PORT}/")
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Stopped. Bye!")


if __name__ == "__main__":
    main()
