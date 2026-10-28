"""CSV, a one-page PDF, and an xAPI statement. Callers run the release gate first."""

from __future__ import annotations

import csv
import io
import json
from typing import Any


def to_csv(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""
    buffer = io.StringIO()
    fieldnames = list(rows[0].keys())
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key, "") for key in fieldnames})
    return buffer.getvalue()


def to_xapi(actor: str, verb: str, activity: str, banner: str) -> dict[str, Any]:
    return {
        "actor": {"name": actor},
        "verb": {"id": f"https://a2e.invalid/verbs/{verb}", "display": {"en-US": verb}},
        "object": {"id": activity, "definition": {"name": {"en-US": activity}}},
        "context": {"extensions": {"https://a2e.invalid/banner": banner}},
    }


def to_pdf(title: str, body: str) -> bytes:
    """A single-page PDF with no external font. Text is Latin-1, CUI stays in the banner."""
    safe = f"{title}\n{body}".encode("latin-1", errors="replace")
    # Keep the content stream short and escaped.
    escaped = safe.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")
    stream = b"BT /F1 12 Tf 72 720 Td (" + escaped[:800] + b") Tj ET"
    objects = [
        b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
        b"2 0 obj<< /Type /Pages /Count 1 /Kids [3 0 R] >>endobj\n",
        b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
        b"4 0 obj<< /Length " + str(len(stream)).encode() + b" >>stream\n" + stream + b"\nendstream\nendobj\n",
        b"5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
    ]
    header = b"%PDF-1.4\n"
    offset = len(header)
    chunks = [header]
    xref = [b"0000000000 65535 f \n"]
    for obj in objects:
        xref.append(f"{offset:010d} 00000 n \n".encode())
        chunks.append(obj)
        offset += len(obj)
    xref_at = offset
    trailer = (
        b"xref\n0 6\n"
        + b"".join(xref)
        + b"trailer<< /Size 6 /Root 1 0 R >>\nstartxref\n"
        + str(xref_at).encode()
        + b"\n%%EOF"
    )
    chunks.append(trailer)
    blob = b"".join(chunks)
    json.dumps({"bytes": len(blob)})  # touch json so the export path stays typed
    return blob
