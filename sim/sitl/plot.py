"""Plot position error against time for the GNSS trials (docs/media/sitl_gnss.png)."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

COLORS = {"gnss_only": "#d1495b", "fused": "#edae49", "gated": "#00798c"}
LABELS = {"gnss_only": "GNSS only", "fused": "GNSS + VIO", "gated": "GNSS + VIO + spoof gate"}


def main(src: Path, out: Path) -> None:
    rows: dict[tuple, dict] = {}
    for line in src.read_text().splitlines():
        r = json.loads(line)
        rows[(r["fault"], r["mode"], r["seed"])] = r
    fig, axes = plt.subplots(1, 2, figsize=(11, 4), dpi=150)
    for ax, fault, title, log in (
        (axes[0], "loss", "GNSS jammed for 120 s", True),
        (axes[1], "drag", "GNSS spoofed: 0.5 m/s drag for 120 s", False),
    ):
        for mode in ("gnss_only", "fused", "gated"):
            for (f, m, seed), r in sorted(rows.items()):
                if f != fault or m != mode:
                    continue
                t0 = r["t_fault"]
                xs, ys = [], []
                for t, tn, te, en, ee, _used in r["series"]:
                    if t < t0 - 5:
                        continue
                    xs.append(t - t0)
                    ys.append(max(0.05, math.hypot(en - tn, ee - te)))
                ax.plot(xs, ys, color=COLORS[mode], lw=1.4, alpha=0.85, label=LABELS[mode] if seed == 0 else None)
                if r.get("detect_s") is not None:
                    ax.axvline(r["detect_s"], color=COLORS[mode], lw=0.8, ls=":")
        ax.set_title(title, fontsize=11, loc="left")
        ax.set_xlabel("seconds since the fault began")
        ax.set_ylabel("EKF2 position error, m")
        if log:
            ax.set_yscale("log")
        ax.grid(alpha=0.25)
        ax.spines[["top", "right"]].set_visible(False)
    axes[0].legend(frameon=False, fontsize=9)
    axes[1].text(0.98, 0.04, "dotted: the gate drops GNSS", transform=axes[1].transAxes, ha="right", va="bottom", fontsize=8, color="#555")
    fig.suptitle("PX4 v1.18 SIH, closed loop, 3 seeds per line colour", fontsize=9, x=0.01, ha="left", color="#555")
    fig.tight_layout()
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "docs/eval/sitl_gnss.jsonl"), Path(sys.argv[2] if len(sys.argv) > 2 else "docs/media/sitl_gnss.png"))
