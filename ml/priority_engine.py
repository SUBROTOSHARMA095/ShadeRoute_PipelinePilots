from pathlib import Path

import numpy as np
import pandas as pd


# ============================================================
# PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATA_PATH = (
    PROJECT_ROOT
    / "data"
    / "SOA_ITER_ML_10m_Dataset_2026.csv"
)

OUTPUT_DIR = PROJECT_ROOT / "ml" / "outputs"

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True
)


# ============================================================
# CONFIGURATION
# ============================================================

# Priority weights.
#
# These are a transparent decision-support heuristic,
# NOT ML-learned causal weights.

WEIGHTS = {
    "heat_stress": 0.30,
    "vegetation_deficit": 0.35,
    "bare_soil": 0.15,
    "built_up": 0.10,
    "low_moisture": 0.10
}


# ============================================================
# NORMALIZATION
# ============================================================

def min_max(series):
    """
    Normalize a feature to 0-1.
    """

    minimum = series.min()
    maximum = series.max()

    if maximum == minimum:
        return pd.Series(
            0.0,
            index=series.index
        )

    return (
        (series - minimum)
        / (maximum - minimum)
    )


# ============================================================
# LOAD DATA
# ============================================================

print("=" * 70)
print("SOA ITER — VEGETATION PRIORITY ENGINE")
print("=" * 70)

print("\nLoading:")
print(DATA_PATH)

df = pd.read_csv(DATA_PATH)

print("\nDataset:")
print(df.shape)


# ============================================================
# REQUIRED COLUMNS
# ============================================================

required_columns = [
    "longitude",
    "latitude",
    "NDVI",
    "NDBI",
    "BSI",
    "NDWI",
    "LST",
    "vegetation_fraction"
]

missing = [
    column
    for column in required_columns
    if column not in df.columns
]

if missing:

    raise ValueError(
        f"Missing required columns: {missing}"
    )


# ============================================================
# ENVIRONMENTAL INDICATORS
# ============================================================

# High LST = higher heat stress
df["heat_stress"] = min_max(
    df["LST"]
)


# Low vegetation = higher vegetation deficit
df["vegetation_deficit"] = (
    1
    -
    df["vegetation_fraction"]
)

df["vegetation_deficit"] = (
    df["vegetation_deficit"]
    .clip(0, 1)
)


# High BSI = more bare surface
df["bare_soil_score"] = min_max(
    df["BSI"]
)


# High NDBI = stronger built-up signal
df["built_up_score"] = min_max(
    df["NDBI"]
)


# NDWI is generally higher where moisture is greater.
# Therefore lower NDWI contributes to priority.
df["low_moisture_score"] = (
    1
    -
    min_max(df["NDWI"])
)


# ============================================================
# PRIORITY SCORE
# ============================================================

df["priority_score"] = (

    WEIGHTS["heat_stress"]
    * df["heat_stress"]

    +

    WEIGHTS["vegetation_deficit"]
    * df["vegetation_deficit"]

    +

    WEIGHTS["bare_soil"]
    * df["bare_soil_score"]

    +

    WEIGHTS["built_up"]
    * df["built_up_score"]

    +

    WEIGHTS["low_moisture"]
    * df["low_moisture_score"]
)


# Convert to 0-100
df["priority_score"] = (
    df["priority_score"]
    * 100
)


# ============================================================
# PRIORITY CLASS
# ============================================================

def priority_class(score):

    if score < 20:
        return "Very Low"

    if score < 40:
        return "Low"

    if score < 60:
        return "Moderate"

    if score < 80:
        return "High"

    return "Very High"


df["priority_class"] = (
    df["priority_score"]
    .apply(priority_class)
)


# ============================================================
# RECOMMENDATION
# ============================================================

def recommendation(row):

    score = row["priority_score"]

    vegetation = row["vegetation_fraction"]
    lst = row["LST"]

    if score >= 80:

        return (
            "Very high priority for tree planting "
            "or vegetation intervention"
        )

    if score >= 60:

        return (
            "High priority for tree planting "
            "or additional vegetation"
        )

    if score >= 40:

        return (
            "Moderate priority; consider vegetation "
            "enhancement where feasible"
        )

    if vegetation >= 0.75:

        return (
            "Existing vegetation is already high; "
            "planting priority is low"
        )

    return (
        "Low priority for immediate planting"
    )


df["recommendation"] = (
    df.apply(
        recommendation,
        axis=1
    )
)


# ============================================================
# SORTED PRIORITY OUTPUT
# ============================================================

priority_columns = [
    "longitude",
    "latitude",

    "NDVI",
    "NDBI",
    "BSI",
    "NDWI",
    "LST",

    "vegetation_fraction",

    "heat_stress",
    "vegetation_deficit",
    "bare_soil_score",
    "built_up_score",
    "low_moisture_score",

    "priority_score",
    "priority_class",
    "recommendation"
]

priority_df = (
    df[priority_columns]
    .sort_values(
        "priority_score",
        ascending=False
    )
)


# ============================================================
# SAVE PRIORITY MAP DATA
# ============================================================

priority_path = (
    OUTPUT_DIR
    / "SOA_ITER_10m_Planting_Priority_2026.csv"
)

priority_df.to_csv(
    priority_path,
    index=False
)


# ============================================================
# TREE SCENARIO FUNCTION
# ============================================================

def recommend_tree_locations(
    number_of_trees,
    dataframe=priority_df
):

    if number_of_trees <= 0:

        raise ValueError(
            "Number of trees must be greater than zero."
        )

    number_of_trees = int(
        number_of_trees
    )

    # Each selected grid cell represents a
    # high-priority planting location.
    number_of_locations = min(
        number_of_trees,
        len(dataframe)
    )

    recommendations = (
        dataframe
        .head(number_of_locations)
        .copy()
    )

    recommendations[
        "planting_rank"
    ] = np.arange(
        1,
        len(recommendations) + 1
    )

    return recommendations


# ============================================================
# DEFAULT SCENARIO
# ============================================================

DEFAULT_TREES = 250

tree_recommendations = (
    recommend_tree_locations(
        DEFAULT_TREES
    )
)

tree_path = (
    OUTPUT_DIR
    / "tree_recommendations_250_2026.csv"
)

tree_recommendations.to_csv(
    tree_path,
    index=False
)


# ============================================================
# SUMMARY
# ============================================================

print("\n" + "=" * 70)
print("PRIORITY SUMMARY")
print("=" * 70)

print(
    df[
        "priority_class"
    ]
    .value_counts()
    .reindex(
        [
            "Very High",
            "High",
            "Moderate",
            "Low",
            "Very Low"
        ],
        fill_value=0
    )
)


print("\nPriority statistics:")

print(
    df[
        "priority_score"
    ]
    .describe()
)


print("\nTop 10 priority cells:")

print(
    priority_df[
        [
            "longitude",
            "latitude",
            "LST",
            "vegetation_fraction",
            "priority_score",
            "priority_class"
        ]
    ]
    .head(10)
    .to_string(
        index=False
    )
)


# ============================================================
# TREE SCENARIO SUMMARY
# ============================================================

print("\n" + "=" * 70)
print("TREE PLANTING SCENARIO")
print("=" * 70)

print(
    f"\nRequested trees: {DEFAULT_TREES}"
)

print(
    f"Recommended cells: "
    f"{len(tree_recommendations)}"
)

print(
    "\nAverage priority of selected cells:"
)

print(
    tree_recommendations[
        "priority_score"
    ].mean()
)


# ============================================================
# OUTPUTS
# ============================================================

print("\n" + "=" * 70)
print("OUTPUTS")
print("=" * 70)

print(
    "\nPriority dataset:"
)

print(priority_path)

print(
    "\n250-tree recommendation:"
)

print(tree_path)

print(
    "\nPriority engine complete."
)