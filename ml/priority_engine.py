from pathlib import Path
import geopandas as gpd
import numpy as np
import pandas as pd

# ============================================================
# PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Updated path to public/data
DATA_DIR = PROJECT_ROOT / "public" / "data"

DATA_PATH = PROJECT_ROOT / "data" / "SOA_ITER_ML_10m_Dataset_2026.csv"

OUTPUT_DIR = PROJECT_ROOT / "ml" / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# GeoJSON layers in public/data/
infra_path = DATA_DIR / "soa_infrastructure.geojson"
missing_bldg_path = DATA_DIR / "missingBuildings.geojson"
paths_path = DATA_DIR / "paths.geojson"

# ============================================================
# CONFIGURATION
# ============================================================

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
    minimum = series.min()
    maximum = series.max()
    if maximum == minimum:
        return pd.Series(0.0, index=series.index)
    return (series - minimum) / (maximum - minimum)

# ============================================================
# LOAD DATA
# ============================================================

print("=" * 70)
print("SOA ITER — VEGETATION PRIORITY & MIST SPRAYER ENGINE")
print("=" * 70)

df = pd.read_csv(DATA_PATH)

required_columns = [
    "longitude", "latitude", "NDVI", "NDBI", 
    "BSI", "NDWI", "LST", "vegetation_fraction"
]

missing = [col for col in required_columns if col not in df.columns]
if missing:
    raise ValueError(f"Missing required columns: {missing}")

# ============================================================
# ENVIRONMENTAL INDICATORS & SCORING
# ============================================================

df["heat_stress"] = min_max(df["LST"])
df["vegetation_deficit"] = (1 - df["vegetation_fraction"]).clip(0, 1)
df["bare_soil_score"] = min_max(df["BSI"])
df["built_up_score"] = min_max(df["NDBI"])
df["low_moisture_score"] = 1 - min_max(df["NDWI"])

df["priority_score"] = (
    WEIGHTS["heat_stress"] * df["heat_stress"] +
    WEIGHTS["vegetation_deficit"] * df["vegetation_deficit"] +
    WEIGHTS["bare_soil"] * df["bare_soil_score"] +
    WEIGHTS["built_up"] * df["built_up_score"] +
    WEIGHTS["low_moisture"] * df["low_moisture_score"]
) * 100

def priority_class(score):
    if score < 20: return "Very Low"
    if score < 40: return "Low"
    if score < 60: return "Moderate"
    if score < 80: return "High"
    return "Very High"

df["priority_class"] = df["priority_score"].apply(priority_class)

# ============================================================
# SPATIAL FILTERING & INTERVENTION CLASSIFICATION (NEW)
# ============================================================

print("\nProcessing Spatial Geometry (Filtering Buildings & Paths)...")

# 1. Convert DataFrame to GeoDataFrame
gdf = gpd.GeoDataFrame(
    df,
    geometry=gpd.points_from_xy(df["longitude"], df["latitude"]),
    crs="EPSG:4326"
)

# 2. Load Infrastructure, Missing Buildings, and Paths
# infra_path = PROJECT_ROOT / "data" / "soa_infrastructure.geojson"
# missing_bldg_path = PROJECT_ROOT / "data" / "missingBuildings.geojson"
# paths_path = PROJECT_ROOT / "data" / "paths.geojson"

infra_gdf = gpd.read_file(infra_path) if infra_path.exists() else gpd.GeoDataFrame()
buildings_gdf = gpd.read_file(missing_bldg_path) if missing_bldg_path.exists() else gpd.GeoDataFrame()
paths_gdf = gpd.read_file(paths_path)

# Combine building layers
all_buildings = None
if not infra_gdf.empty and not buildings_gdf.empty:
    all_buildings = infra_gdf.geometry.union(buildings_gdf.geometry.unary_union)
elif not infra_gdf.empty:
    all_buildings = infra_gdf.geometry.unary_union
elif not buildings_gdf.empty:
    all_buildings = buildings_gdf.geometry.unary_union

# Remove dots inside building polygons
if all_buildings is not None:
    initial_count = len(gdf)
    gdf = gdf[~gdf.geometry.within(all_buildings.unary_union)].copy()
    print(f"Removed {initial_count - len(gdf)} grid dots overlapping infrastructure.")

# 3. Buffer paths (5 meters) and check point proximity
paths_projected = paths_gdf.to_crs(epsg=3857)
paths_buffer = paths_projected.geometry.buffer(5).unary_union  # 5-meter path zone

gdf_projected = gdf.to_crs(epsg=3857)
gdf["is_path"] = gdf_projected.geometry.within(paths_buffer)

# 4. Assign intervention types and customized recommendations
def assign_intervention(row):
    score = row["priority_score"]
    
    if row["is_path"]:
        return (
            "Mist Sprayer",
            "High heat exposure walking path: Install mist sprayers for pedestrian cooling."
        )
    elif score >= 80:
        return (
            "Tree Planting",
            "Very high priority for tree planting or vegetation canopy implementation."
        )
    elif score >= 60:
        return (
            "Tree Planting",
            "High priority for tree planting or additional vegetation."
        )
    elif score >= 40:
        return (
            "Tree Planting",
            "Moderate priority; consider vegetation enhancement where feasible."
        )
    return (
        "Tree Planting",
        "Low priority for immediate planting."
    )

intervention_results = gdf.apply(assign_intervention, axis=1)
gdf["intervention_type"] = [r[0] for r in intervention_results]
gdf["recommendation"] = [r[1] for r in intervention_results]

# Clean up spatial object back to standard DataFrame
priority_df = pd.DataFrame(gdf.drop(columns=["geometry", "is_path"])).sort_values("priority_score", ascending=False)

# ============================================================
# SAVE OUTPUT DATASETS
# ============================================================

OUTPUT_DIR = PROJECT_ROOT / "public" / "data"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

priority_path = OUTPUT_DIR / "SOA_ITER_10m_Planting_Priority_2026.csv"
priority_df.to_csv(priority_path, index=False)

# Top Tree Recommendations (Non-path points)
tree_candidates = priority_df[priority_df["intervention_type"] == "Tree Planting"]
tree_recommendations = tree_candidates.head(250).copy()
tree_recommendations["planting_rank"] = np.arange(1, len(tree_recommendations) + 1)
tree_path = OUTPUT_DIR / "tree_recommendations_250_2026.csv"
tree_recommendations.to_csv(tree_path, index=False)

# Top Mist Sprayer Recommendations (Path-only points)
sprayer_candidates = priority_df[priority_df["intervention_type"] == "Mist Sprayer"]
sprayer_recommendations = sprayer_candidates.head(50).copy()
sprayer_recommendations["sprayer_rank"] = np.arange(1, len(sprayer_recommendations) + 1)
sprayer_path = OUTPUT_DIR / "mist_sprayer_recommendations_50_2026.csv"
sprayer_recommendations.to_csv(sprayer_path, index=False)

print("\n" + "=" * 70)
print("PRIORITY & INTERVENTION SUMMARY")
print("=" * 70)
print(f"Total Valid Grid Cells: {len(priority_df)}")
print(f"Tree Planting Candidates: {len(tree_candidates)}")
print(f"Mist Sprayer Path Candidates: {len(sprayer_candidates)}")
print(f"Saved Priority CSV: {priority_path}")
print(f"Saved 250 Tree Scenario: {tree_path}")
print(f"Saved 50 Mist Sprayer Scenario: {sprayer_path}")