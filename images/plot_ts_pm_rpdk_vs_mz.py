"""Phase margin vs temperature: PDK poly R_Z (res_ff/typ/res_ss) vs M_Z, all corners.

Reads the ngspice corner results (corner T tag rz k a0 ft pm f180 gm) and
writes ts_pm_rpdk_vs_mz.png.
Usage:  py plot_ts_pm_rpdk_vs_mz.py [results.txt]   (default ts_corners_results.txt)
"""
import sys
import matplotlib.pyplot as plt
import numpy as np

T = [-40, 27, 85, 125]
corners = ["TT", "SS", "FF", "SF", "FS"]
D = {}
path = sys.argv[1] if len(sys.argv) > 1 else "ts_corners_results.txt"
for line in open(path):
    parts = line.split()
    if len(parts) != 10:
        continue
    c, t, tag, rz, k, a0, ft, pm, f180, gm = parts
    D[(c.upper(), int(t), tag)] = float(pm)

def pm(c, tag):
    return [D[(c, t, tag)] for t in T]

color = dict(TT="#2a78d6", SS="#eb6834", FF="#1baf7a", SF="#eda100", FS="#e87ba4")
marker = dict(TT="o", SS="s", FF="^", SF="D", FS="v")
INK, MUTED, GRID = "#1f1f1e", "#6b6a64", "#e4e3de"
plt.rcParams.update({
    "font.size": 9, "axes.edgecolor": MUTED, "axes.labelcolor": INK,
    "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False,
    "axes.spines.right": False, "axes.grid": True, "grid.color": GRID,
    "grid.linewidth": 0.6, "axes.axisbelow": True,
})

allr = [v for c in corners for g in ("rpdk_0", "rpdk_0.2", "rpdk_-0.2") for v in pm(c, g)]
allm = [v for c in corners for v in pm(c, "mz")]
fig, (a1, a2) = plt.subplots(1, 2, figsize=(7.2, 3.3), sharey=True)
for c in corners:
    a1.fill_between(T, pm(c, "rpdk_-0.2"), pm(c, "rpdk_0.2"), color=color[c], alpha=0.13, lw=0)
    a1.plot(T, pm(c, "rpdk_0"), color=color[c], lw=1.6, marker=marker[c], ms=5,
            mec="white", mew=0.8, label=c, zorder=3)
    a2.plot(T, pm(c, "mz"), color=color[c], lw=1.6, marker=marker[c], ms=5,
            mec="white", mew=0.8, label=c, zorder=3)
a1.set_title(f"PDK poly $R_Z$, res_ff to res_ss  (spread {np.ptp(allr):.1f}°)",
             fontsize=8.5, color=INK)
a2.set_title(f"Triode $M_Z$  (spread {np.ptp(allm):.1f}°)", fontsize=8.5, color=INK)
a1.text(-40, min(allr) - 0.15, "band = res_ff to res_ss, line = typical",
        fontsize=7, color=MUTED, va="top")
a1.set_ylabel("Phase margin (°)")
for ax in (a1, a2):
    ax.set_xticks(T)
    ax.set_xlabel("Temperature (°C)")
a1.set_ylim(60.5, 72.5)
h, l = a2.get_legend_handles_labels()
fig.legend(h, l, loc="upper center", ncol=5, frameon=False,
           bbox_to_anchor=(0.5, 1.0), title="Process corner (NMOS/PMOS)",
           title_fontsize=8.5)
fig.tight_layout(rect=(0, 0, 1, 0.86))
fig.savefig("ts_pm_rpdk_vs_mz.png", dpi=300)
print("saved ts_pm_rpdk_vs_mz.png")