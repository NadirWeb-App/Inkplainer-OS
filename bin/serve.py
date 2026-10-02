"""Serve Inkplainer on 127.0.0.1 for a local install (used by bin/inkplainer).

Like `python3 -m http.server`, but it refuses hidden paths so the install's
.git directory is never served.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".mjs": "text/javascript",
    }

    def send_head(self):
        path = unquote(urlsplit(self.path).path)
        if any(part.startswith(".") for part in path.split("/") if part):
            self.send_error(404)
            return None
        return super().send_head()


def main():
    port, directory = int(sys.argv[1]), sys.argv[2]
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=directory))
    server.serve_forever()


if __name__ == "__main__":
    main()
