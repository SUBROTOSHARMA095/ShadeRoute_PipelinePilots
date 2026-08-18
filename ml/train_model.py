from pathlib import Path

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns


# ============================================================
# PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATA_PATH = (
    PROJECT_ROOT
    / "data"
    / "SOA_ITER_ML_10m_Dataset_2026.csv"
)

OUTPUT_DIR = (
    PROJECT_ROOT
    / "ml"
    / "outputs"
)

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True
)


# ============================================================
# LOAD DATA
# ============================================================

df = pd.read_csv(DATA_PATH)

print("=" * 60)
print("SOA ITER ML — EXPLORATORY ANALYSIS")
print("=" * 60)

print("\nDataset shape:")
print(df.shape)


# ============================================================
# CREATE VEGETATION PRESENCE
# ============================================================

df["vegetation_present"] = (
    df["vegetation_fraction"] > 0
).astype(int)

print("\nVegetation presence:")
print(
    df["vegetation_present"]
    .value_counts()
    .sort_index()
)


# ============================================================
# FEATURE CORRELATION
# ============================================================

features = [
    "NDVI",
    "NDBI",
    "BSI",
    "NDWI",
    "LST",
    "vegetation_fraction"
]

correlation = df[features].corr()

print("\nCorrelation matrix:")
print(correlation)


# ============================================================
# SAVE CORRELATION MATRIX
# ============================================================

correlation.to_csv(
    OUTPUT_DIR / "correlation_matrix.csv"
)


# ============================================================
# CORRELATION HEATMAP
# ============================================================

plt.figure(figsize=(9, 7))

sns.heatmap(
    correlation,
    annot=True,
    fmt=".2f",
    cmap="coolwarm",
    center=0
)

plt.title(
    "SOA ITER — Feature Correlation"
)

plt.tight_layout()

plt.savefig(
    OUTPUT_DIR / "feature_correlation.png",
    dpi=300
)

plt.close()


# ============================================================
# VEGETATION FRACTION DISTRIBUTION
# ============================================================

plt.figure(figsize=(8, 5))

plt.hist(
    df["vegetation_fraction"],
    bins=20
)

plt.xlabel(
    "Vegetation Fraction"
)

plt.ylabel(
    "Number of 10 m Pixels"
)

plt.title(
    "Vegetation Fraction Distribution"
)

plt.tight_layout()

plt.savefig(
    OUTPUT_DIR / "vegetation_fraction_distribution.png",
    dpi=300
)

plt.close()


# ============================================================
# FEATURE VS VEGETATION
# ============================================================

for feature in [
    "NDVI",
    "NDBI",
    "BSI",
    "NDWI",
    "LST"
]:

    plt.figure(figsize=(7, 5))

    plt.scatter(
        df[feature],
        df["vegetation_fraction"],
        alpha=0.35
    )

    plt.xlabel(feature)

    plt.ylabel(
        "Vegetation Fraction"
    )

    plt.title(
        f"{feature} vs Vegetation Fraction"
    )

    plt.tight_layout()

    plt.savefig(
        OUTPUT_DIR
        / f"{feature}_vs_vegetation.png",
        dpi=300
    )

    plt.close()


# ============================================================
# SPATIAL VEGETATION MAP
# ============================================================

plt.figure(figsize=(8, 7))

scatter = plt.scatter(
    df["longitude"],
    df["latitude"],
    c=df["vegetation_fraction"],
    s=12,
    cmap="Greens",
    vmin=0,
    vmax=1
)

plt.colorbar(
    scatter,
    label="Vegetation Fraction"
)

plt.xlabel("Longitude")
plt.ylabel("Latitude")

plt.title(
    "SOA ITER — 10 m Vegetation Fraction"
)

plt.axis("equal")

plt.tight_layout()

plt.savefig(
    OUTPUT_DIR
    / "vegetation_spatial_distribution.png",
    dpi=300
)

plt.close()


print("\nOutputs saved to:")

print(OUTPUT_DIR)

print("\nExploratory analysis complete.")