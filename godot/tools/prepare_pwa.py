#!/usr/bin/env python3
"""Make Godot's generated PWA service worker activate updated builds promptly."""

import json
import re
import sys
from pathlib import Path


MARKER = "// ABORE LIFE RPG update activation"
ICON_FILES = ("index.144x144.png", "index.180x180.png", "index.512x512.png")
UPDATE_HANDLERS = """
// ABORE LIFE RPG update activation
self.addEventListener('install', (event) => {
\tevent.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
\tevent.waitUntil(
\t\tself.clients.claim()
\t\t\t.then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
\t\t\t.then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))
\t);
});
"""


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: prepare_pwa.py <exported-service-worker.js>", file=sys.stderr)
        return 2

    worker_path = Path(sys.argv[1])
    if not worker_path.is_file():
        print(f"Service worker not found: {worker_path}", file=sys.stderr)
        return 1

    content = worker_path.read_text(encoding="utf-8")
    cache_match = re.search(r"const CACHED_FILES = (\[[^\]]*\]);", content)
    if not cache_match:
        print(f"Unrecognized Godot cache list: {worker_path}", file=sys.stderr)
        return 1
    cached_files = json.loads(cache_match.group(1))
    updated_cache = list(dict.fromkeys([*cached_files, *ICON_FILES]))
    content = content[:cache_match.start(1)] + json.dumps(updated_cache) + content[cache_match.end(1):]

    if MARKER in content:
        worker_path.write_text(content, encoding="utf-8")
        return 0
    if "self.addEventListener('install'" not in content or "self.addEventListener('activate'" not in content:
        print(f"Unrecognized Godot service worker format: {worker_path}", file=sys.stderr)
        return 1

    worker_path.write_text(content.rstrip() + "\n\n" + UPDATE_HANDLERS.lstrip(), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
