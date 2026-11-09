"""Static server for the DSY preview that never lets the browser cache a module.

ES modules are cached hard, so without this every edit needs a hard reload and
a stale copy looks exactly like a bug in the new code.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass


directory = sys.argv[1]
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8777
ThreadingHTTPServer(('127.0.0.1', port), partial(NoCache, directory=directory)).serve_forever()
