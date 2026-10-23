#!/usr/bin/env python3
"""Append ?v=<sha> to local asset URLs in frontend/index.html and bump SHELL_VERSION in sw.js.
Pages max-age lets old JS outlive new HTML; this prevents stale-cache TypeErrors."""
import re, sys, pathlib

sha = sys.argv[1] if len(sys.argv) > 1 else "dev"
root = pathlib.Path("frontend")

idx = root / "index.html"
html = idx.read_text(encoding="utf-8")
html = re.sub(r'((?:src|href)="(?!https?:)[^"?]+\.(?:js|css))(\?v=[^"]*)?"', rf'\1?v={sha}"', html)
idx.write_text(html, encoding="utf-8")

sw = root / "sw.js"
js = sw.read_text(encoding="utf-8")
js = re.sub(r"const SHELL_VERSION = '[^']*';", f"const SHELL_VERSION = '{sha}';", js)
sw.write_text(js, encoding="utf-8")
print("cache-busted with", sha)
