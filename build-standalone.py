#!/usr/bin/env python3
"""Inline styles.css and app.js into index.html to produce a single portable file."""
from pathlib import Path

root = Path(__file__).parent
html = (root / "index.html").read_text()
html = html.replace('<link rel="stylesheet" href="styles.css">',
                    "<style>\n" + (root / "styles.css").read_text() + "\n</style>")
html = html.replace('<script src="app.js"></script>',
                    "<script>\n" + (root / "app.js").read_text() + "\n</script>")
assert "styles.css" not in html and 'app.js"' not in html, "inlining failed"

out = root / "biobuzz-scorer-standalone.html"
out.write_text(html)
print(f"wrote {out.name} ({len(html):,} bytes)")
