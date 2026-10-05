"""Servidor estático de desarrollo con aislamiento entre orígenes (lo exige SharedArrayBuffer).

Uso: python tools/serve.py [puerto]   (sirve la carpeta web/)
"""
import http.server
import sys
from functools import partial
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "web"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".pdbqt": "text/plain",
        ".sdf": "text/plain",
        ".pdb": "text/plain",
    }

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    http.server.ThreadingHTTPServer(("127.0.0.1", puerto), partial(Handler, directory=str(RAIZ))).serve_forever()
