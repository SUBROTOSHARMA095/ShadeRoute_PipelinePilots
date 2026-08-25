from pathlib import Path
import json
import pandas as pd
import geopandas as gpd
import numpy as np

try:
    import rasterio
    from rasterstats import zonal_stats
except ImportError:
    raise ImportError("Please run 'pip install rasterstats rasterio' to process GeoTIFF rasters.")

from shapely.geometry import shape, box

# 1. Resolve dynamic project paths
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent if SCRIPT_DIR.name == 'ml' else SCRIPT_DIR

ML_DIR = PROJECT_ROOT / 'ml'

# The repo layout doesn't keep all inputs in one folder (rasters/CSVs live under
# data/satellite83/, the campus boundary lives under public/data/), so search
# the known locations in priority order instead of hard-coding a single dir.
SEARCH_DIRS = [
    ML_DIR,
    PROJECT_ROOT / 'data' / 'satellite83',
    PROJECT_ROOT / 'data' / 'satellite',
    PROJECT_ROOT / 'data',
    PROJECT_ROOT / 'public' / 'data',
    PROJECT_ROOT,
]

def resolve_input(filename):
    """Return the first existing path for filename across SEARCH_DIRS, printing
    where it was found. If not found anywhere, returns the ML_DIR path so the
    existing 'not found' warnings downstream still fire with a sensible path."""
    for d in SEARCH_DIRS:
        candidate = d / filename
        if candidate.exists():
            print(f"✅ Found {filename} at {candidate}")
            return candidate
    print(f"⚠️  {filename} not found in any of: {[str(d) for d in SEARCH_DIRS]}")
    return ML_DIR / filename

campus_geojson_path = resolve_input('campus.geojson')
lst_tif_path = resolve_input('SOA_Neighbour_LST_Summer_2026.tif')
ndvi_tif_path = resolve_input('SOA_Neighbour_NDVI_Summer_2026.tif')

air_temp_csv = resolve_input('SOA_ITER_Neighbour_Air_Temperature_Mar_May_2026_NASA_POWER.csv')
wind_speed_csv = resolve_input('SOA_ITER_Neighbour_Wind_Speed_Mar_May_2026_NASA_POWER.csv')
solar_rad_csv = resolve_input('Hourly_Solar_Radiation_March_to_May_2026.csv')

# 2. Extract Neighborhood Boundary (2.84 km²)
if campus_geojson_path.exists():
    with open(campus_geojson_path, 'r') as f:
        geojson_data = json.load(f)
    neighbour_feature = next(
        f for f in geojson_data['features'] 
        if f['properties'].get('name') == 'neighbour'
    )
    neighbour_poly = shape(neighbour_feature['geometry'])
else:
    # Fallback coordinates if campus.geojson is missing
    neighbourhood_geojson = {
        "type": "Polygon",
        "coordinates": [[
            [85.78932047476331, 20.24101644951945],
            [85.8092859817088, 20.24113078992095],
            [85.80898561709778, 20.25333823468424],
            [85.78943569969834, 20.25348283303776],
            [85.78932047476331, 20.24101644951945]
        ]]
    } #[cite: 2]
    neighbour_poly = shape(neighbourhood_geojson)

gdf_boundary = gpd.GeoDataFrame([{'name': 'neighbour', 'geometry': neighbour_poly}], crs="EPSG:4326").to_crs(epsg=32645)

# 3. Load Meteorological Inputs
def get_weather_baselines():
    t_air, u_wind, s_rad, rh = 36.5, 2.4, 850.0, 55.0  # Summer defaults
    
    if air_temp_csv.exists():
        df_temp = pd.read_csv(air_temp_csv)
        cols = [c for c in df_temp.columns if 'temp' in c.lower() or 't2m' in c.lower() or 'value' in c.lower()]
        if cols: t_air = float(df_temp[cols[0]].mean())

    if wind_speed_csv.exists():
        df_wind = pd.read_csv(wind_speed_csv)
        cols = [c for c in df_wind.columns if 'wind' in c.lower() or 'ws2m' in c.lower() or 'value' in c.lower()]
        if cols: u_wind = float(df_wind[cols[0]].mean())

    if solar_rad_csv.exists():
        df_solar = pd.read_csv(solar_rad_csv)
        cols = [c for c in df_solar.columns if 'solar' in c.lower() or 'rad' in c.lower() or 'value' in c.lower()]
        if cols: s_rad = float(df_solar[cols[0]].mean())

    return t_air, u_wind, s_rad, rh

t_air, u_wind, s_rad, rh = get_weather_baselines()

# 4. Generate 900 m² Sectors (30m x 30m Grid)
minx, miny, maxx, maxy = gdf_boundary.total_bounds
side_length = 30.0

cols = np.arange(minx, maxx, side_length)
rows = np.arange(miny, maxy, side_length)

sectors = []
row_labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

for r_idx, y in enumerate(rows):
    row_char = row_labels[r_idx % len(row_labels)] + (str(r_idx // len(row_labels)) if r_idx >= 26 else "")
    for c_idx, x in enumerate(cols):
        sector_box = box(x, y, x + side_length, y + side_length)
        if sector_box.intersects(gdf_boundary.geometry.iloc[0]):
            sector_id = f"SEC-{row_char}{c_idx + 1:02d}"
            sectors.append({'sector_id': sector_id, 'geometry': sector_box})

gdf_sectors = gpd.GeoDataFrame(sectors, crs="EPSG:32645")

# ---------------------------------------------------------
# 5. Extract LST & NDVI Raster Means with Fallback Validation
# ---------------------------------------------------------
def extract_raster_mean(gdf, tif_path, default_val, physical_floor=None, label=''):
    if not tif_path.exists():
        print(f"⚠️  WARNING: {tif_path.name} NOT FOUND at {tif_path} — every sector will get the "
              f"same constant value ({default_val}), which flattens all downstream thermal indices "
              f"and will collapse the risk classification to a single class.")
        return np.full(len(gdf), default_val)

    with rasterio.open(tif_path) as src:
        raster_crs = src.crs
        raster_nodata = src.nodata

    gdf_reprojected = gdf.to_crs(raster_crs)

    if raster_nodata is not None:
        stats = zonal_stats(gdf_reprojected, str(tif_path), stats=['mean'], nodata=raster_nodata)
    else:
        # The raster doesn't declare a nodata value in its metadata, so
        # rasterstats falls back to a datatype-based guess (often -999),
        # which silently fails to mask real invalid pixels (commonly stored
        # as 0). We compute unmasked first, then sanity-filter below.
        stats = zonal_stats(gdf_reprojected, str(tif_path), stats=['mean'])

    extracted = [s['mean'] if (s['mean'] is not None and not np.isnan(s['mean'])) else default_val for s in stats]
    extracted = np.array(extracted, dtype=float)

    if physical_floor is not None:
        bad_mask = extracted < physical_floor
        n_bad = int(bad_mask.sum())
        if n_bad > 0:
            print(f"⚠️  WARNING: {n_bad} sector(s) had a physically implausible {label} mean "
                  f"below {physical_floor} (almost certainly unmasked no-data pixels leaking in, "
                  f"since the raster has no declared nodata value). Replacing those sectors with "
                  f"the default value ({default_val}) instead of letting them skew classification.")
            extracted[bad_mask] = default_val

    if np.nanstd(extracted) < 1e-9:
        print(f"⚠️  WARNING: {tif_path.name} was found but returned an (almost) constant value "
              f"across all sectors (std={np.nanstd(extracted):.6f}). Check that the raster actually "
              f"covers the full sector grid extent and isn't a single-pixel or no-data image.")
    return extracted

# Physical floor: real land-surface temperature in Odisha in summer will never
# be anywhere near 0°C — a mean that low means no-data pixels leaked into the
# zonal average (see nodata handling above). NDVI legitimately ranges down to
# ~0 (bare soil/impervious) or negative (water), so we don't floor-filter it.
gdf_sectors['LST'] = extract_raster_mean(
    gdf_sectors, lst_tif_path, default_val=35.0, physical_floor=10.0, label='LST'
)
gdf_sectors['NDVI'] = extract_raster_mean(gdf_sectors, ndvi_tif_path, default_val=0.2)

# Carry the raw meteorological baselines onto every sector so the frontend can
# render a per-sector "Parameter / Value" table (air temp, RH, wind, LST, NDVI)
# instead of only the derived index. These are area-wide NASA POWER baselines,
# not literally measured at each 30x30m sector, but LST/NDVI still vary per sector.
gdf_sectors['air_temp'] = np.round(t_air, 1)
gdf_sectors['rel_humidity'] = np.round(rh, 1)
gdf_sectors['wind_speed'] = np.round(u_wind, 1)
gdf_sectors['solar_rad'] = np.round(s_rad, 1)
gdf_sectors['LST'] = np.round(gdf_sectors['LST'], 1)
gdf_sectors['NDVI'] = np.round(gdf_sectors['NDVI'], 2)

# Diagnostic Check
print(f"LST Range: Min {gdf_sectors['LST'].min():.2f}°C | Max {gdf_sectors['LST'].max():.2f}°C | Unique: {gdf_sectors['LST'].nunique()}")
print(f"NDVI Range: Min {gdf_sectors['NDVI'].min():.2f} | Max {gdf_sectors['NDVI'].max():.2f} | Unique: {gdf_sectors['NDVI'].nunique()}")

# ---------------------------------------------------------
# 6. IMD Tropical Multi-Index Calculation
# ---------------------------------------------------------
# Vapor Pressure (hPa)
e = (rh / 100.0) * 6.105 * np.exp((17.27 * t_air) / (237.7 + t_air))

# Base IMD Heat Index (Rothfusz equation tuned for Indian humidity baselines)
hi_base = (-8.784 + 1.611 * t_air + 2.338 * rh - 0.146 * t_air * rh 
           - 0.012 * (t_air**2) - 0.016 * (rh**2) + 0.002 * (t_air**2) * rh)

# Microclimate adjustments using sector Land Surface Temp (LST) & vegetation (NDVI) cooling
radiant_delta = (gdf_sectors['LST'] - t_air) * 0.25
vegetation_cooling = gdf_sectors['NDVI'] * 1.5

gdf_sectors['HI_IMD'] = np.round(hi_base + radiant_delta - vegetation_cooling, 2)
gdf_sectors['Humidex'] = np.round(t_air + (5.0 / 9.0) * (e - 10.0) + radiant_delta, 2)

# Normalization based on IMD reference range (30°C to 55°C)
gdf_sectors['HHRI_score'] = np.round(
    100 * (gdf_sectors['HI_IMD'] - 30.0) / (55.0 - 30.0), 2
).clip(lower=0, upper=100)

# ---------------------------------------------------------
# 7. IMD Operational Heat Alert Classification
# ---------------------------------------------------------
def classify_imd_hi(hi):
    if hi >= 55.0:
        return 'Extreme Danger'
    elif hi >= 46.0:
        return 'Danger'
    elif hi >= 41.0:
        return 'Extreme Caution'
    elif hi >= 35.0:
        return 'Caution'
    else:
        return 'Normal / Safe'

gdf_sectors['risk_class'] = gdf_sectors['HI_IMD'].apply(classify_imd_hi)

# Fallback to quantiles if regional heat is uniform and falls into a single bin
if gdf_sectors['risk_class'].nunique() <= 1:
    gdf_sectors['risk_class'] = pd.qcut(
        gdf_sectors['HI_IMD'].rank(method='first'),
        q=4,
        labels=['Normal / Safe', 'Caution', 'Extreme Caution', 'Danger']
    ).astype(str)

gdf_sectors['zone_name'] = gdf_sectors['sector_id'] + " (" + gdf_sectors['risk_class'] + ")"
gdf_sectors['area_m2'] = np.round(gdf_sectors.geometry.area, 2)

# ---------------------------------------------------------
# 7b. Human Vulnerability & Overall Heat Risk
# ---------------------------------------------------------
NDVI_VULN_REF = (0.0, 0.55)
ndvi_ref_min, ndvi_ref_max = NDVI_VULN_REF
ndvi_norm = 100 * (gdf_sectors['NDVI'] - ndvi_ref_min) / (ndvi_ref_max - ndvi_ref_min)
ndvi_norm = ndvi_norm.clip(lower=0, upper=100)
gdf_sectors['vulnerability_score'] = np.round(100 - ndvi_norm, 2)

def classify_vulnerability(score):
    if score >= 66:
        return 'High'
    elif score >= 33:
        return 'Moderate'
    else:
        return 'Low'

gdf_sectors['vulnerability_class'] = gdf_sectors['vulnerability_score'].apply(classify_vulnerability)

# Overall Risk = 65% IMD Thermal Hazard + 35% Vegetation Deficit Vulnerability
gdf_sectors['overall_risk_score'] = np.round(
    0.65 * gdf_sectors['HHRI_score'] + 0.35 * gdf_sectors['vulnerability_score'], 2
)

def classify_overall_risk(score):
    if score >= 75:
        return 'Critical', '🔴'
    elif score >= 55:
        return 'High', '🟠'
    elif score >= 35:
        return 'Moderate', '🟡'
    else:
        return 'Low', '🟢'

overall_risk_pairs = gdf_sectors['overall_risk_score'].apply(classify_overall_risk)
gdf_sectors['overall_risk'] = [p[0] for p in overall_risk_pairs]
gdf_sectors['overall_risk_emoji'] = [p[1] for p in overall_risk_pairs]

# 8. Export GeoJSON
output_dir = PROJECT_ROOT / 'public' / 'data'
if not output_dir.exists():
    output_dir = PROJECT_ROOT / 'data'

output_dir.mkdir(parents=True, exist_ok=True)
output_file = output_dir / 'heat_risk_zones.geojson'

final_geojson = gdf_sectors.to_crs(epsg=4326)
final_geojson.to_file(output_file, driver='GeoJSON')

print(f"Successfully generated multi-index human thermal stress map for {len(final_geojson)} sectors.")
print(gdf_sectors['risk_class'].value_counts().to_string())
print(f"Overall risk breakdown:\n{gdf_sectors['overall_risk'].value_counts().to_string()}")
print(f"File exported to: {output_file}")