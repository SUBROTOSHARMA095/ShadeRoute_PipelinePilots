"""
heat_risk_classification.py
============================

Human Heat Index (HHI) zone classifier for the campus digital-twin map.

DATA SHAPE (matches your actual files)
----------------------------------------
- SOA_Neighbour_LST_Summer_2026.tif   -> Land Surface Temperature raster (deg C),
                                          already processed, EPSG:4326, 75x47 px.
- SOA_Neighbour_NDVI_Summer_2026.tif  -> NDVI raster, same grid as LST.
- POWER_Point_Hourly_..._LST.csv      -> hourly RH2M (%) and T2M (deg C) for ONE
                                          representative point (NASA POWER, in Local
                                          Solar Time), Mar-May 2026.
- SOA_ITER_Neighbour_Wind_Speed_..._NASA_POWER.csv -> hourly WS2M (m/s), same point,
                                          same local-time convention.
- Hourly_Solar_Radiation_..._2026.csv -> hourly solar radiation (J/m^2), same point,
                                          but timestamped in UTC.

IMPORTANT DESIGN NOTE — why the weather CSVs don't vary spatially
--------------------------------------------------------------------
Every weather CSV here is a SINGLE representative point for the whole
neighbourhood (not a station network), so air temperature, humidity, wind
and solar radiation are treated as uniform across campus for a given time
window. Spatial variation in the final risk map comes entirely from LST
and NDVI (which genuinely differ block-to-block: concrete quads vs. tree
cover). This is actually the right model at this scale — weather doesn't
meaningfully change over ~2km, but surface temperature and vegetation do.

Because the weather values are constant across the grid, they CANNOT be
min-max normalized locally (that always collapses to the same value
everywhere and would contribute nothing). Instead they're normalized
against fixed, physically-meaningful reference ranges (see CONFIG below),
so a genuinely dangerous heat index/solar load raises the risk baseline
for the whole map, while LST/NDVI reshape WHERE the hot and cool pockets
are within that baseline.

WHAT THIS SCRIPT DOES
----------------------
1. Reads the LST and NDVI rasters.
2. Reads the three weather CSVs and averages each over a configurable
   "peak heat exposure" window (default: 12:00-15:00 local) across the
   whole Mar-May period — i.e. "what's a typical dangerous afternoon like
   here". The solar file is UTC-stamped, so it's time-aligned to the same
   local window before averaging.
3. Computes NOAA's "feels-like" Heat Index from the averaged air temp + RH.
4. Builds a composite 0-1 risk score per pixel:
      risk = w_lst   * local_normalize(LST)
           + w_hi    * absolute_normalize(HeatIndex)
           + w_solar * absolute_normalize(SolarRadiation)
           - w_wind  * absolute_normalize(WindSpeed)      (relief)
           - w_ndvi  * local_normalize(NDVI)               (relief)
5. Classifies every pixel into Low / Moderate / High risk (tertiles by
   default).
6. Polygonizes the classified raster into clean zone polygons and writes:
      heat_risk_zones.geojson   -> for the map
      heat_zone_legend.json     -> per-class advisory text, for the sidebar

REQUIRED PACKAGES
------------------
    pip install rasterio numpy pandas geopandas shapely

USAGE
------
Defaults already point at your actual filenames in data/satellite83/, so
a plain run works as-is:

    python heat_risk_classification.py

Override anything if needed, e.g. a different peak window:

    python heat_risk_classification.py --peak-start 13 --peak-end 16
"""

import argparse
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from rasterio.features import shapes
from rasterio.warp import reproject, Resampling
import geopandas as gpd
from shapely.geometry import shape as shapely_shape

warnings.filterwarnings("ignore", category=RuntimeWarning)


# ============================================================
# CONFIG — tune these once you've looked at real output
# ============================================================

CONFIG = {
    "weights": {
        "lst": 0.35,
        "heat_index": 0.30,
        "solar": 0.15,
        "wind": 0.10,     # relief term (subtracted)
        "ndvi": 0.10,     # relief term (subtracted)
    },

    "classification_method": "quantile",   # "quantile" or "fixed"
    "fixed_thresholds": {
        "low_moderate": 0.33,
        "moderate_high": 0.66,
    },

    # "Peak heat exposure" window, in LOCAL hours (24h clock), averaged
    # across every day in the CSV period. This is what drives the
    # heat-index / solar / wind baseline. 12:00-15:00 = typical worst
    # afternoon exposure window; change to study mornings, evenings, etc.
    "peak_start_hour": 12,
    "peak_end_hour": 15,

    # NASA POWER's "LST" (Local Solar Time) is treated as equivalent to
    # India Standard Time (UTC+5:30) here — accurate to within a few
    # minutes at this longitude, fine at hourly resolution. Only used to
    # align the UTC-stamped solar radiation file to the same local window.
    "utc_offset_hours": 5.5,

    # Fixed reference ranges used to normalize the spatially-uniform
    # weather scalars (since local min-max normalization doesn't apply
    # to a constant field). Adjust if your region's real extremes differ.
    "heat_index_range_c": (25, 50),      # comfortable -> extreme danger
    "solar_radiation_range_wm2": (0, 1000),  # night -> peak tropical noon sun
    "wind_speed_range_ms": (0, 8),       # calm -> strong breeze (cooling)

    "simplify_tolerance_deg": 0.000015,
    "min_polygon_area_m2": 25,
    "zone_labels": ["Low Risk", "Moderate Risk", "High Risk"],
}

ADVISORY_TEXT = {
    "Low Risk": {
        "color": "#16a34a",
        "summary": "Comfortable thermal conditions. Safe for normal outdoor activity.",
        "advisory": [
            "No special precautions needed for most people.",
            "Still carry water during peak afternoon hours (12-3 PM).",
            "Good zone for outdoor gatherings, sports, and events.",
        ],
    },
    "Moderate Risk": {
        "color": "#f59e0b",
        "summary": "Elevated heat stress, especially for prolonged exposure.",
        "advisory": [
            "Limit continuous outdoor activity to under 45 minutes without shade breaks.",
            "Stay hydrated; avoid strenuous activity between 12-3 PM.",
            "Vulnerable groups (elderly, young children, those with health conditions) should take extra breaks.",
        ],
    },
    "High Risk": {
        "color": "#b91c1c",
        "summary": "Significant heat stress. Prolonged exposure can be dangerous.",
        "advisory": [
            "Avoid strenuous outdoor activity, especially between 11 AM - 4 PM.",
            "Seek shade or air-conditioned spaces frequently.",
            "Watch for signs of heat exhaustion: dizziness, nausea, excessive sweating.",
            "Vulnerable individuals should avoid this zone during peak hours entirely.",
        ],
    },
}


# ============================================================
# STEP 1 — RASTER HELPERS
# ============================================================

def read_raster(path):
    with rasterio.open(path) as src:
        arr = src.read(1).astype("float64")
        profile = src.profile.copy()
        if src.nodata is not None:
            arr[arr == src.nodata] = np.nan
    return arr, profile


def raw_band10_to_lst_celsius(band10_dn, ml=3.8000e-04, al=0.1,
                                k1=774.8853, k2=1321.0789, emissivity=0.99):
    """Only needed if you ever swap in a RAW Landsat thermal band instead
    of a precomputed LST tif. Not used with your current data."""
    radiance = ml * band10_dn + al
    radiance = np.where(radiance <= 0, np.nan, radiance)
    brightness_temp_k = k2 / np.log((k1 / radiance) + 1)
    wavelength_m = 10.895e-6
    c2 = 1.4388e-2
    lst_k = brightness_temp_k / (
        1 + (wavelength_m * brightness_temp_k / c2) * np.log(emissivity)
    )
    return lst_k - 273.15


def reproject_to_match(src_path, ref_profile):
    """Resample a raster onto the LST raster's exact grid. A no-op in
    practice for your files since NDVI already shares the LST grid, but
    kept so mismatched grids still work safely."""
    with rasterio.open(src_path) as src:
        if (src.crs == ref_profile["crs"] and src.transform == ref_profile["transform"]
                and src.width == ref_profile["width"] and src.height == ref_profile["height"]):
            return src.read(1).astype("float64")

        dst_array = np.empty((ref_profile["height"], ref_profile["width"]), dtype="float64")
        reproject(
            source=rasterio.band(src, 1),
            destination=dst_array,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=ref_profile["transform"],
            dst_crs=ref_profile["crs"],
            resampling=Resampling.bilinear,
        )
    return dst_array


# ============================================================
# STEP 2 — WEATHER SCALARS (single representative point, averaged
# over the peak exposure window across the whole period)
# ============================================================

def average_local_hourly(csv_path, value_column, peak_start, peak_end):
    """Average a NASA-POWER-style hourly CSV (YEAR,MO,DY,HR,<value>) over
    an inclusive local-hour window, across every day in the file."""
    # POWER_Point_Hourly files have a text metadata block ending in
    # '-END HEADER-' before the real CSV header row; detect and skip it.
    with open(csv_path) as f:
        lines = f.readlines()
    header_idx = next((i for i, l in enumerate(lines) if l.startswith("YEAR")), 0)
    df = pd.read_csv(csv_path, skiprows=header_idx)

    window = df[(df["HR"] >= peak_start) & (df["HR"] <= peak_end)]
    if window.empty:
        raise ValueError(f"No rows found in {csv_path} for HR {peak_start}-{peak_end}")
    return float(window[value_column].mean())


def average_solar_utc(csv_path, peak_start_local, peak_end_local, utc_offset_hours):
    """Solar file is timestamped in UTC while the exposure window is
    defined in local time, so shift the window before filtering."""
    df = pd.read_csv(csv_path)
    df["hour_utc"] = pd.to_datetime(df["datetime_UTC"]).dt.hour + \
        pd.to_datetime(df["datetime_UTC"]).dt.minute / 60.0

    utc_start = peak_start_local - utc_offset_hours
    utc_end = peak_end_local - utc_offset_hours
    # normalize into 0-24 range
    utc_start %= 24
    utc_end %= 24

    if utc_start <= utc_end:
        window = df[(df["hour_utc"] >= utc_start) & (df["hour_utc"] <= utc_end)]
    else:
        # window wraps past midnight UTC
        window = df[(df["hour_utc"] >= utc_start) | (df["hour_utc"] <= utc_end)]

    if window.empty:
        raise ValueError(f"No solar rows found for UTC window {utc_start:.1f}-{utc_end:.1f}h")

    mean_j_per_m2_per_hour = window["solar_radiation_J_m2"].mean()
    # Convert J/m^2 accumulated over an hour -> average W/m^2 for that hour
    return float(mean_j_per_m2_per_hour / 3600.0)


def compute_heat_index_celsius(air_temp_c, rh_percent):
    """NOAA Rothfusz regression 'feels-like' Heat Index. Formula is
    defined in Fahrenheit; converted in/out. Below 80F it degrades
    gracefully to just the air temperature."""
    t_f = air_temp_c * 9 / 5 + 32
    rh = rh_percent

    hi_f = (
        -42.379 + 2.04901523 * t_f + 10.14333127 * rh
        - 0.22475541 * t_f * rh - 0.00683783 * t_f ** 2
        - 0.05481717 * rh ** 2 + 0.00122874 * t_f ** 2 * rh
        + 0.00085282 * t_f * rh ** 2 - 0.00000199 * t_f ** 2 * rh ** 2
    )
    if t_f < 80:
        hi_f = t_f

    return (hi_f - 32) * 5 / 9


# ============================================================
# STEP 3 — NORMALIZATION
# ============================================================

def normalize_local(arr):
    """Min-max normalize a SPATIAL raster (LST, NDVI) against its own
    range across the campus. Highlights relative hot/cool pockets."""
    valid = arr[~np.isnan(arr)]
    if valid.size == 0:
        return np.zeros_like(arr)
    lo, hi = np.nanmin(arr), np.nanmax(arr)
    if hi - lo == 0:
        return np.zeros_like(arr)
    return (arr - lo) / (hi - lo)


def normalize_absolute(value, value_range):
    """Normalize a single SCALAR weather value against a fixed,
    physically-meaningful reference range (not local min-max, since a
    constant field has no local range to normalize against)."""
    lo, hi = value_range
    return float(np.clip((value - lo) / (hi - lo), 0, 1))


# ============================================================
# STEP 4 — COMPOSITE RISK SCORE
# ============================================================

def compute_risk_score(lst_arr, ndvi_arr, heat_index_c, solar_wm2, wind_ms):
    w = CONFIG["weights"]

    lst_n = normalize_local(lst_arr)
    ndvi_n = normalize_local(ndvi_arr)
    hi_n = normalize_absolute(heat_index_c, CONFIG["heat_index_range_c"])
    solar_n = normalize_absolute(solar_wm2, CONFIG["solar_radiation_range_wm2"])
    wind_n = normalize_absolute(wind_ms, CONFIG["wind_speed_range_ms"])

    score = (
        w["lst"] * lst_n
        + w["heat_index"] * hi_n          # scalar, broadcasts across grid
        + w["solar"] * solar_n            # scalar, broadcasts across grid
        - w["wind"] * wind_n              # scalar relief, broadcasts
        - w["ndvi"] * ndvi_n
    )
    return np.clip(score, 0, 1)


# ============================================================
# STEP 5 — CLASSIFY INTO 3 ZONES
# ============================================================

def classify_risk(risk_score):
    valid_mask = ~np.isnan(risk_score)
    classified = np.full(risk_score.shape, -1, dtype="int16")

    if CONFIG["classification_method"] == "quantile":
        t1, t2 = np.quantile(risk_score[valid_mask], [1 / 3, 2 / 3])
    else:
        t1 = CONFIG["fixed_thresholds"]["low_moderate"]
        t2 = CONFIG["fixed_thresholds"]["moderate_high"]

    classified[valid_mask & (risk_score <= t1)] = 0
    classified[valid_mask & (risk_score > t1) & (risk_score <= t2)] = 1
    classified[valid_mask & (risk_score > t2)] = 2

    return classified, (t1, t2)


# ============================================================
# STEP 6 — POLYGONIZE + REPROJECT TO WGS84
# ============================================================

def polygonize_zones(classified, ref_profile):
    transform = ref_profile["transform"]
    src_crs = ref_profile["crs"]

    mask = classified != -1
    features = list(shapes(classified, mask=mask, transform=transform))
    geoms = [shapely_shape(geom) for geom, _ in features]
    class_ids = [int(val) for _, val in features]

    gdf = gpd.GeoDataFrame({"class_id": class_ids, "geometry": geoms}, crs=src_crs)
    gdf = gdf.to_crs(epsg=4326)

    gdf_m = gdf.to_crs(epsg=3857)
    gdf["area_m2"] = gdf_m.geometry.area
    gdf = gdf[gdf["area_m2"] >= CONFIG["min_polygon_area_m2"]].reset_index(drop=True)

    gdf["geometry"] = gdf["geometry"].simplify(
        CONFIG["simplify_tolerance_deg"], preserve_topology=True
    )

    gdf = gdf.dissolve(by="class_id", as_index=False)
    gdf = gdf.explode(index_parts=False).reset_index(drop=True)

    labels = CONFIG["zone_labels"]
    gdf["risk_class"] = gdf["class_id"].apply(lambda i: labels[i])
    gdf["zone_name"] = gdf.apply(
        lambda row: f"{row['risk_class']} Zone {row.name + 1}", axis=1
    )
    gdf["color"] = gdf["risk_class"].apply(lambda c: ADVISORY_TEXT[c]["color"])

    # Compute centroids in a projected CRS (accurate), then bring back to WGS84
    centroids_proj = gdf.to_crs(epsg=3857).geometry.centroid.to_crs(epsg=4326)
    gdf["centroid_lat"] = centroids_proj.y
    gdf["centroid_lon"] = centroids_proj.x

    return gdf


# ============================================================
# MAIN PIPELINE
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Human Heat Index zone classifier")
    parser.add_argument("--lst", default="data/satellite83/SOA_Neighbour_LST_Summer_2026.tif")
    parser.add_argument("--ndvi", default="data/satellite83/SOA_Neighbour_NDVI_Summer_2026.tif")
    parser.add_argument("--temp-rh", default="data/satellite83/POWER_Point_Hourly_20260301_20260531_020d25N_085d80E_LST.csv",
                         help="NASA POWER hourly file containing both T2M and RH2M")
    parser.add_argument("--wind", default="data/satellite83/SOA_ITER_Neighbour_Wind_Speed_Mar_May_2026_NASA_POWER.csv")
    parser.add_argument("--solar", default="data/satellite83/Hourly_Solar_Radiation_March_to_May_2026.csv")
    parser.add_argument("--out-dir", default="public/data",
                         help="Output directory, matches app.js's /data/ fetch paths")
    parser.add_argument("--raw-thermal", action="store_true",
                         help="Set only if --lst points to a RAW Landsat thermal band, not LST")
    parser.add_argument("--peak-start", type=int, default=CONFIG["peak_start_hour"])
    parser.add_argument("--peak-end", type=int, default=CONFIG["peak_end_hour"])
    args = parser.parse_args()

    CONFIG["peak_start_hour"] = args.peak_start
    CONFIG["peak_end_hour"] = args.peak_end

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Reading LST raster...")
    lst_arr, ref_profile = read_raster(args.lst)
    if args.raw_thermal:
        print("  -> converting raw thermal band to LST (Celsius)...")
        lst_arr = raw_band10_to_lst_celsius(lst_arr)

    print("Reading + aligning NDVI onto LST grid...")
    ndvi_arr = reproject_to_match(args.ndvi, ref_profile)

    print(f"Averaging weather over local peak window {args.peak_start}:00-{args.peak_end}:00...")
    mean_air_temp_c = average_local_hourly(args.temp_rh, "T2M", args.peak_start, args.peak_end)
    mean_rh_percent = average_local_hourly(args.temp_rh, "RH2M", args.peak_start, args.peak_end)
    mean_wind_ms = average_local_hourly(args.wind, "WS2M", args.peak_start, args.peak_end)
    mean_solar_wm2 = average_solar_utc(
        args.solar, args.peak_start, args.peak_end, CONFIG["utc_offset_hours"]
    )
    print(f"  Air Temp: {mean_air_temp_c:.1f} C | RH: {mean_rh_percent:.1f}% | "
          f"Wind: {mean_wind_ms:.1f} m/s | Solar: {mean_solar_wm2:.0f} W/m^2")

    heat_index_c = compute_heat_index_celsius(mean_air_temp_c, mean_rh_percent)
    print(f"  Heat Index (feels-like): {heat_index_c:.1f} C")

    print("Computing composite risk score...")
    risk_score = compute_risk_score(lst_arr, ndvi_arr, heat_index_c, mean_solar_wm2, mean_wind_ms)

    print("Classifying into Low / Moderate / High risk zones...")
    classified, thresholds = classify_risk(risk_score)
    print(f"  thresholds used: low<= {thresholds[0]:.3f} < moderate <= {thresholds[1]:.3f} < high")

    print("Polygonizing + reprojecting to WGS84...")
    zones_gdf = polygonize_zones(classified, ref_profile)
    print(f"  {len(zones_gdf)} zone polygons generated")

    geojson_path = out_dir / "heat_risk_zones.geojson"
    zones_gdf[[
        "zone_name", "risk_class", "color", "area_m2",
        "centroid_lat", "centroid_lon", "geometry"
    ]].to_file(geojson_path, driver="GeoJSON")
    print(f"Wrote {geojson_path}")

    legend = {
        "generated_thresholds": {"low_moderate": thresholds[0], "moderate_high": thresholds[1]},
        "conditions_used": {
            "peak_window_local": f"{args.peak_start}:00-{args.peak_end}:00",
            "mean_air_temp_c": round(mean_air_temp_c, 1),
            "mean_relative_humidity_pct": round(mean_rh_percent, 1),
            "mean_wind_speed_ms": round(mean_wind_ms, 1),
            "mean_solar_radiation_wm2": round(mean_solar_wm2, 0),
            "heat_index_c": round(heat_index_c, 1),
        },
        "zones": ADVISORY_TEXT,
    }
    legend_path = out_dir / "heat_zone_legend.json"
    with open(legend_path, "w") as f:
        json.dump(legend, f, indent=2)
    print(f"Wrote {legend_path}")

    print("Done.")


if __name__ == "__main__":
    main()