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
    PROJECT_ROOT / 'data' / 'vulnerability',
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
rh_csv = resolve_input('POWER_Point_Hourly_20260301_20260531_020d25N_085d80E_LST.csv')

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

# ---------------------------------------------------------
# 3. Load Hourly Meteorological Data
# ---------------------------------------------------------

def load_hourly_weather():
    """
    Load and merge hourly:
      - NASA POWER RH2M + T2M (LST)
      - NASA POWER WS2M (LST)
      - Solar radiation (UTC)

    The final dataframe uses the RH/T2M NASA POWER LST timestamp
    as the master time axis.
    """

    # -----------------------------------------------------
    # Load files
    # -----------------------------------------------------

    df_met = pd.read_csv(rh_csv, skiprows=10)
    df_wind = pd.read_csv(wind_speed_csv)
    df_solar = pd.read_csv(solar_rad_csv)

    # -----------------------------------------------------
    # RH + Temperature
    # -----------------------------------------------------

    df_met['datetime'] = pd.to_datetime(
        dict(
            year=df_met['YEAR'],
            month=df_met['MO'],
            day=df_met['DY'],
            hour=df_met['HR']
        ),
        errors='coerce'
    )

    weather = df_met[
        ['datetime', 'RH2M', 'T2M']
    ].rename(
        columns={
            'RH2M': 'rel_humidity',
            'T2M': 'air_temp'
        }
    )

    # -----------------------------------------------------
    # Wind speed
    # -----------------------------------------------------

    df_wind['datetime'] = pd.to_datetime(
        dict(
            year=df_wind['YEAR'],
            month=df_wind['MO'],
            day=df_wind['DY'],
            hour=df_wind['HR']
        ),
        errors='coerce'
    )

    wind = df_wind[
        ['datetime', 'WS2M']
    ].rename(
        columns={
            'WS2M': 'wind_speed'
        }
    )

    # -----------------------------------------------------
    # Solar radiation
    # -----------------------------------------------------

    df_solar['datetime'] = pd.to_datetime(
        df_solar['datetime_UTC'],
        errors='coerce'
    )

    solar = df_solar[
        ['datetime', 'solar_radiation_J_m2']
    ].rename(
        columns={
            'solar_radiation_J_m2': 'solar_rad_J_m2'
        }
    )

    # -----------------------------------------------------
    # Merge temperature/RH + wind
    # -----------------------------------------------------

    weather = weather.merge(
        wind,
        on='datetime',
        how='inner'
    )

    # -----------------------------------------------------
    # IMPORTANT:
    # Solar timestamps are UTC while the NASA POWER
    # temperature/RH/wind timestamps are LST.
    #
    # Convert solar UTC to the local time used by the
    # meteorological datasets before merging.
    #
    # Bhubaneswar/your study area is IST = UTC + 5:30.
    # -----------------------------------------------------

    solar['datetime'] = (
        solar['datetime']
        + pd.Timedelta(hours=5, minutes=30)
    )

    # -----------------------------------------------------
    # Merge solar with NASA POWER LST data.
    #
    # Solar becomes :30 after UTC → IST conversion,
    # while NASA POWER is hourly (:00).
    # Therefore use nearest hourly observation.
    # -----------------------------------------------------

    weather = pd.merge_asof(
        weather.sort_values('datetime'),
        solar.sort_values('datetime'),
        on='datetime',
        direction='nearest',
        tolerance=pd.Timedelta(minutes=30)
    )

    # -----------------------------------------------------
    # Remove NASA POWER missing-data values
    # -----------------------------------------------------

    weather = weather.replace(
        -999,
        np.nan
    )

    weather = weather.replace(
        [np.inf, -np.inf],
        np.nan
    )

    weather = weather.dropna(
        subset=[
            'datetime',
            'air_temp',
            'rel_humidity',
            'wind_speed'
        ]
    )

    weather = weather.sort_values(
        'datetime'
    ).reset_index(drop=True)

    print(
        f"Loaded {len(weather)} hourly meteorological records."
    )

    print(
        f"Weather period: "
        f"{weather['datetime'].min()} → "
        f"{weather['datetime'].max()}"
    )

    print(
        f"Temperature range: "
        f"{weather['air_temp'].min():.2f} → "
        f"{weather['air_temp'].max():.2f} °C"
    )

    print(
        f"Relative humidity range: "
        f"{weather['rel_humidity'].min():.2f} → "
        f"{weather['rel_humidity'].max():.2f} %"
    )

    print(
        f"Wind speed range: "
        f"{weather['wind_speed'].min():.2f} → "
        f"{weather['wind_speed'].max():.2f} m/s"
    )

    return weather


weather_df = load_hourly_weather()

print(
    f"✅ Loaded {len(weather_df)} hourly weather records "
    f"from {weather_df['datetime'].min()} "
    f"to {weather_df['datetime'].max()}"
)

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
gdf_sectors['area_m2'] = (
    gdf_sectors.geometry.area.round(2)
)
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

# ---------------------------------------------------------
# 5b. Prepare Spatial Environmental Features
# ---------------------------------------------------------
# Meteorological variables are handled separately as hourly
# observations. Only spatial variables are attached directly
# to the 30m x 30m sectors here.

gdf_sectors['LST'] = np.round(
    gdf_sectors['LST'],
    1
)

gdf_sectors['NDVI'] = np.round(
    gdf_sectors['NDVI'],
    2
)

# Diagnostic Check
print(f"LST Range: Min {gdf_sectors['LST'].min():.2f}°C | Max {gdf_sectors['LST'].max():.2f}°C | Unique: {gdf_sectors['LST'].nunique()}")
print(f"NDVI Range: Min {gdf_sectors['NDVI'].min():.2f} | Max {gdf_sectors['NDVI'].max():.2f} | Unique: {gdf_sectors['NDVI'].nunique()}")

# ---------------------------------------------------------
# 5c. Vulnerability Inputs — Sensitive Facilities, Green Space, Population
# ---------------------------------------------------------

hospitals_path = resolve_input('Hospitals.geojson')
schools_path = resolve_input('Schools.geojson')
parks_path = resolve_input('parks.geojson')
population_csv = resolve_input('SOA_ITER_Neighbour_Population_Density_2025.csv')
thermal_stress_csv = resolve_input('SOA_ITER_Thermal_Stress_Mar_May_2026_NASA_POWER.csv')

# Distance-decay radii (m). Hospital/school values match config.json's
# distance_decay_m. config.json has no 'park' radius, so we reuse its
# bus_stop radius (300m) as a walkable-access assumption — flag this if
# you want a different number.
DECAY_M = {'hospital': 500, 'school': 300, 'park': 300}


def load_facility_gdf(path, label, max_area_m2=None):
    """Load a facility polygon layer, reproject to the sector CRS, and drop
    any feature whose footprint is implausibly large for that facility
    type. This guards against boundary/placeholder polygons accidentally
    exported into the file — e.g. parks.geojson's 4th feature is a 2.82
    million m² polygon that's actually a duplicate of the study-area
    boundary (matches the neighbour_poly fallback coords exactly), not a
    real park. Left in, it would put every sector within a few hundred
    metres of a 'park' and flatten the low_greenery component."""
    if not path.exists():
        print(f"⚠️  WARNING: {label} file not found at {path} — that vulnerability component will be skipped (treated as no facilities present, i.e. no proximity benefit/penalty anywhere).")
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:32645")

    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    gdf = gdf.to_crs(epsg=32645)

    if max_area_m2 is not None:
        areas = gdf.geometry.area
        bad = areas > max_area_m2
        if bad.any():
            print(f"⚠️  WARNING: dropping {int(bad.sum())} {label} feature(s) with area > {max_area_m2:,.0f} m² "
                  f"— almost certainly a boundary artifact, not a real {label.lower()}. "
                  f"Dropped area(s): {[f'{a:,.0f} m2' for a in areas[bad]]}")
        gdf = gdf[~bad].reset_index(drop=True)

    print(f"✅ Loaded {len(gdf)} {label} feature(s) from {path.name}")
    return gdf


# The study area is ~2.84 km² (2,840,000 m²). A real park/school/hospital
# footprint on this campus tops out around 12.4 ha (124,000 m²) based on
# the largest legitimate park polygon observed in this data — 500,000 m²
# gives comfortable headroom above that while still catching anything
# that's actually the whole study-area boundary.
hospitals_gdf = load_facility_gdf(hospitals_path, 'Hospital', max_area_m2=500_000)
schools_gdf = load_facility_gdf(schools_path, 'School', max_area_m2=500_000)
parks_gdf = load_facility_gdf(parks_path, 'Park', max_area_m2=500_000)


def nearest_distance_m(points, facility_gdf):
    """Distance in metres from each point to the nearest facility polygon
    boundary/interior. Returns a large distance (effectively 'no proximity
    benefit') for every point if the facility layer is empty or missing."""
    if len(facility_gdf) == 0:
        return np.full(len(points), 10_000.0)
    union = facility_gdf.geometry.union_all() if hasattr(facility_gdf.geometry, 'union_all') else facility_gdf.geometry.unary_union
    return np.array([pt.distance(union) for pt in points])


sector_centroids = gdf_sectors.geometry.centroid

gdf_sectors['dist_hospital_m'] = np.round(nearest_distance_m(sector_centroids, hospitals_gdf), 1)
gdf_sectors['dist_school_m'] = np.round(nearest_distance_m(sector_centroids, schools_gdf), 1)
gdf_sectors['dist_park_m'] = np.round(nearest_distance_m(sector_centroids, parks_gdf), 1)


def exp_decay(distance_m, decay_m):
    """Exponential distance decay: 1.0 at distance 0, ~0.37 at the decay
    radius, approaching 0 further out."""
    return np.exp(-distance_m / decay_m)


# Proximity to hospitals and schools stands in for age-based sensitivity.
# Your population file (Population_Count / Population_Density_per_km2) has
# no age breakdown, so there's no real "20 vs 60 year old" signal to
# compute from your actual data. Proximity to schools is used as a proxy
# for concentrations of children; proximity to hospitals is a proxy for
# concentrations of elderly/immunocompromised people (patients, outpatient
# visitors, staff). This is a standard proxy used in heat-vulnerability-
# index literature when age-disaggregated census data isn't available —
# it IS a proxy, not measured age data, and should be labeled as such
# wherever these results are presented (e.g. in the popup/legend copy).
school_proximity = exp_decay(gdf_sectors['dist_school_m'], DECAY_M['school'])
hospital_proximity = exp_decay(gdf_sectors['dist_hospital_m'], DECAY_M['hospital'])
sensitive_facility_score = np.maximum(school_proximity, hospital_proximity)

# Further from a park = less shade/cooling refuge access = MORE vulnerable,
# so this component is the inverse of proximity.
park_proximity = exp_decay(gdf_sectors['dist_park_m'], DECAY_M['park'])
low_greenery_score = 1.0 - park_proximity

gdf_sectors['sensitive_facility_score'] = np.round(sensitive_facility_score, 3)
gdf_sectors['low_greenery_score'] = np.round(low_greenery_score, 3)

# ---------------------------------------------------------
# Population density x age → sensitivity component
# ---------------------------------------------------------
# WHO/CDC define heat-vulnerable age groups as infants/children under 5
# and adults 65+ (plus pregnant women and people with chronic conditions,
# which we have no data to locate spatially). The closest AGE-BRACKETED
# figures actually available for this region are Census of India brackets,
# which don't line up exactly with the clinical 5/65 cutoffs:
#   - Children 0-6 yrs: 10.67% of Odisha's URBAN population (2011 Census)
#   - Adults 60+ yrs: ~11.5% of Odisha's population (2021 projection;
#     2011 Census had it at 9.5%, trending upward)
# HHSI's age-sensitivity component targets these two Census brackets
# (0-6 and 60+) as the closest available proxy for the WHO/CDC-defined
# high-risk ages (<5 and 65+) — flagged here explicitly since the two
# don't mean quite the same thing, and Census brackets are what your data
# can actually support.
#
# These are Odisha-wide averages, not sourced separately for children vs.
# elderly, and — importantly — this study area is a UNIVERSITY CAMPUS
# plus its surrounding neighbourhood, not a representative residential
# population. A campus dominated by 18-25 year old students/staff will
# have a much lower share of young children and elderly than the general
# Odisha average. Applying the general average uniformly across campus
# sectors would overstate age-vulnerability there. If campus.geojson has
# a feature distinguishing the campus footprint from the wider
# "neighbour" boundary, we use it to apply a separate (assumption-based,
# not census-sourced) lower share on campus; otherwise we fall back to
# applying the neighbourhood-wide share everywhere and print a warning,
# since there's no way to spatially separate the two without that
# boundary.
CENSUS_CHILD_SHARE = 0.107   # 0-6 yrs, urban Odisha, 2011 Census
CENSUS_ELDERLY_SHARE = 0.115  # 60+ yrs, Odisha, 2021 projection
AGE_VULNERABLE_SHARE_NEIGHBOURHOOD = CENSUS_CHILD_SHARE + CENSUS_ELDERLY_SHARE  # ~0.222

# ASSUMPTION, not sourced: university campus population skews heavily
# toward working-age students/staff. This value is a placeholder — if you
# have actual campus demographic data (student/staff headcounts by age),
# replace it.
AGE_VULNERABLE_SHARE_CAMPUS = 0.03

campus_feature = None
if campus_geojson_path.exists():
    with open(campus_geojson_path, 'r') as f:
        _campus_geojson_data = json.load(f)
    campus_feature = next(
        (f for f in _campus_geojson_data['features'] if f['properties'].get('name') == 'campus'),
        None
    )

if campus_feature is not None:
    campus_poly = gpd.GeoDataFrame(
        [{'geometry': shape(campus_feature['geometry'])}], crs="EPSG:4326"
    ).to_crs(epsg=32645).geometry.iloc[0]
    is_campus = sector_centroids.within(campus_poly)
    gdf_sectors['zone_type'] = np.where(is_campus, 'campus', 'neighbourhood')
    print(f"✅ campus.geojson has a distinct 'campus' feature — split {int(is_campus.sum())} campus sectors from {int((~is_campus).sum())} neighbourhood sectors for age weighting.")
else:
    gdf_sectors['zone_type'] = 'neighbourhood'
    print("⚠️  WARNING: campus.geojson has no feature named 'campus' (only 'neighbour', the whole study boundary) — "
          "can't spatially separate campus population from surrounding neighbourhood population. "
          "Applying the neighbourhood-wide age-vulnerable share to ALL sectors, which likely OVERSTATES "
          "age-vulnerability on the campus itself. Add a 'campus' feature to campus.geojson to fix this.")

gdf_sectors['age_vulnerable_share'] = np.where(
    gdf_sectors['zone_type'] == 'campus',
    AGE_VULNERABLE_SHARE_CAMPUS,
    AGE_VULNERABLE_SHARE_NEIGHBOURHOOD
)

if population_csv.exists():
    pop_df = pd.read_csv(population_csv)
    pop_gdf = gpd.GeoDataFrame(
        pop_df,
        geometry=gpd.points_from_xy(pop_df['Longitude'], pop_df['Latitude']),
        crs="EPSG:4326"
    ).to_crs(epsg=32645)

    # Nearest population sample point per sector centroid.
    joined_pop = gpd.sjoin_nearest(
        gpd.GeoDataFrame({'sector_id': gdf_sectors['sector_id']}, geometry=sector_centroids, crs="EPSG:32645"),
        pop_gdf[['Population_Density_per_km2', 'geometry']],
        how='left'
    )
    pop_density = joined_pop['Population_Density_per_km2'].fillna(0).values
    print(f"✅ Loaded population density from {population_csv.name} ({len(pop_df)} sample points)")
else:
    print(f"⚠️  WARNING: population density file not found at {population_csv} — population_sensitivity will be 0 for all sectors.")
    pop_density = np.zeros(len(gdf_sectors))

gdf_sectors['population_density_per_km2'] = np.round(pop_density, 1)

# Vulnerable population density = total density x the locally-applicable
# age-vulnerable share. This is what actually incorporates age into the
# formula — the school/hospital proximity scores computed above stay as a
# complementary SPATIAL signal for where children/medically-vulnerable
# people concentrate specifically, not a substitute for this.
vulnerable_pop_density = pop_density * gdf_sectors['age_vulnerable_share'].values
gdf_sectors['vulnerable_population_density_per_km2'] = np.round(vulnerable_pop_density, 1)

# Min-max normalize across this study area's own sectors (relative
# vulnerability within the campus+neighbourhood, not an absolute
# city-wide scale).
vpop_max = vulnerable_pop_density.max()
population_sensitivity = (vulnerable_pop_density / vpop_max) if vpop_max > 0 else np.zeros(len(gdf_sectors))
gdf_sectors['population_sensitivity'] = np.round(population_sensitivity, 3)

# ---------------------------------------------------------
# Combined Vulnerability Index (VI), 0–1
# ---------------------------------------------------------
# config.json's hvi_weights include age_sensitivity, outdoor_exposure, and
# built_environment components we have no data to compute. We keep the
# *relative* weighting of the three components we CAN compute
# (population_sensitivity : sensitive_facilities : low_greenery =
# 0.25 : 0.20 : 0.10 per config.json) and renormalize so they sum to 1,
# rather than silently dropping 45% of the weight on the floor.
_raw_weights = {
    'population_sensitivity': 0.25,
    'sensitive_facilities': 0.20,
    'low_greenery': 0.10,
}
_w_sum = sum(_raw_weights.values())
VULN_WEIGHTS = {k: v / _w_sum for k, v in _raw_weights.items()}

vulnerability_index = (
    VULN_WEIGHTS['population_sensitivity'] * population_sensitivity
    + VULN_WEIGHTS['sensitive_facilities'] * sensitive_facility_score
    + VULN_WEIGHTS['low_greenery'] * low_greenery_score
)
gdf_sectors['vulnerability_index'] = np.round(vulnerability_index, 3)


def classify_vulnerability(vi):
    if vi >= 0.66:
        return 'High'
    elif vi >= 0.33:
        return 'Moderate'
    else:
        return 'Low'


gdf_sectors['vulnerability_class'] = gdf_sectors['vulnerability_index'].apply(classify_vulnerability)

print(f"\nVulnerability Index range: {gdf_sectors['vulnerability_index'].min():.3f} – {gdf_sectors['vulnerability_index'].max():.3f}")
print(gdf_sectors['vulnerability_class'].value_counts().to_string())

# ---------------------------------------------------------
# 6. Hourly Heat Hazard Calculation
# ---------------------------------------------------------

def calculate_heat_index(temp_c, rh):
    """
    IMD heat-index equation.

    temp_c : air temperature in Celsius
    rh     : relative humidity in %

    Returns heat index in Celsius.
    """

    temp_c = pd.to_numeric(
        temp_c,
        errors="coerce"
    )

    rh = pd.to_numeric(
        rh,
        errors="coerce"
    )

    hi = (
        -8.784695
        + 1.61139411 * temp_c
        + 2.33854900 * rh
        - 0.14611605 * temp_c * rh
        - 0.012308094 * temp_c**2
        - 0.016424828 * rh**2
        + 0.002211732 * temp_c**2 * rh
        + 0.00072546 * temp_c * rh**2
        - 0.000003582 * temp_c**2 * rh**2
    )

    return hi

weather_df["HI_IMD"] = calculate_heat_index(
    weather_df["air_temp"],
    weather_df["rel_humidity"]
)

weather_df["HI_IMD"] = (
    weather_df["HI_IMD"].round(2)
)

# ---------------------------------------------------------
# Heat hazard score: 0–100
# ---------------------------------------------------------

weather_df['heat_hazard_score'] = (
    100
    * (weather_df['HI_IMD'] - 30.0)
    / (55.0 - 30.0)
).clip(
    lower=0,
    upper=100
).round(2)


# ---------------------------------------------------------
# Heat hazard classification
# ---------------------------------------------------------

def classify_heat_hazard(hi):
    if hi >= 55:
        return 'Extreme Danger'
    elif hi >= 46:
        return 'Danger'
    elif hi >= 41:
        return 'Extreme Caution'
    elif hi >= 35:
        return 'Caution'
    else:
        return 'Normal / Safe'


weather_df['heat_hazard_class'] = (
    weather_df['HI_IMD']
    .apply(classify_heat_hazard)
)

print("\nDEBUG — Heat Index:")
print(
    weather_df[
        [
            "datetime",
            "rel_humidity",
            "air_temp",
            "wind_speed",
            "solar_rad_J_m2",
            "HI_IMD",
            "heat_hazard_score",
            "heat_hazard_class"
        ]
    ].head(20).to_string(index=False)
)

print(
    "\nHI statistics:"
)

print(
    weather_df['HI_IMD'].describe()
)

print(
    "\nHeat hazard score statistics:"
)

print(
    weather_df['heat_hazard_score'].describe()
)

print(
    "\nHourly heat-hazard distribution:"
)

print(
    weather_df['heat_hazard_class']
    .value_counts()
    .to_string()
)

# ---------------------------------------------------------
# 7. Static per-sector environmental & vulnerability fields
# ---------------------------------------------------------
# LST/NDVI come from a single seasonal composite raster
# (SOA_Neighbour_LST_Summer_2026.tif / NDVI...tif), not daily imagery, so
# these — and everything derived from them below — are the same for every
# date in the timeline. Only the weather-driven fields (air_temp, HI_IMD,
# HHSI, risk class, etc.) computed in the loop below vary day to day.

# Fractional Vegetation Cover (%) from NDVI — standard remote-sensing
# formula: FVC = ((NDVI - NDVI_min) / (NDVI_max - NDVI_min))^2
ndvi_min, ndvi_max = gdf_sectors['NDVI'].min(), gdf_sectors['NDVI'].max()
if ndvi_max > ndvi_min:
    fvc = ((gdf_sectors['NDVI'] - ndvi_min) / (ndvi_max - ndvi_min)).clip(0, 1) ** 2
else:
    fvc = pd.Series(0.0, index=gdf_sectors.index)
gdf_sectors['vegetation_cover_pct'] = np.round(fvc * 100, 1)

# Outdoor Exposure (High/Medium/Low) — proxy from LST + NDVI: hot, bare/
# paved sectors (high LST, low vegetation) are treated as high outdoor
# exposure. There's no direct exposure measurement in your data (e.g.
# shade cover, building height, sky-view factor) — like the sensitive-
# facility proxy earlier, this is a stand-in, not a measured quantity.
lst_min, lst_max = gdf_sectors['LST'].min(), gdf_sectors['LST'].max()
lst_norm = ((gdf_sectors['LST'] - lst_min) / (lst_max - lst_min)).clip(0, 1) if lst_max > lst_min else pd.Series(0.0, index=gdf_sectors.index)
ndvi_norm = ((gdf_sectors['NDVI'] - ndvi_min) / (ndvi_max - ndvi_min)).clip(0, 1) if ndvi_max > ndvi_min else pd.Series(0.0, index=gdf_sectors.index)
exposure_score = lst_norm * (1 - ndvi_norm)
gdf_sectors['outdoor_exposure_score'] = np.round(exposure_score, 3)


def add_tercile_class(gdf, source_col, out_col):
    """Classify a continuous column into High/Medium/Low by tercile within
    this study area (relative to the campus's own sectors, not an
    absolute city-wide scale)."""
    q1, q2 = gdf[source_col].quantile([1 / 3, 2 / 3])

    def classify(v):
        if v >= q2:
            return 'High'
        elif v >= q1:
            return 'Medium'
        else:
            return 'Low'

    gdf[out_col] = gdf[source_col].apply(classify)


add_tercile_class(gdf_sectors, 'outdoor_exposure_score', 'outdoor_exposure')
add_tercile_class(gdf_sectors, 'population_density_per_km2', 'population_density_class')
gdf_sectors['dist_hospital_km'] = np.round(gdf_sectors['dist_hospital_m'] / 1000, 2)

# Combined "overall_risk" for the popup: collapses the 5-level hazard
# class into the 4-level Critical/High/Moderate/Low scale app.js already
# expects (OVERALL_RISK_STYLE). Caution and Extreme Caution both map to
# Moderate since there's no 5th bucket on that scale.
_OVERALL_RISK_MAP = {
    'Extreme Danger': ('Critical', '🔴'),
    'Danger': ('High', '🟠'),
    'Extreme Caution': ('Moderate', '🟡'),
    'Caution': ('Moderate', '🟡'),
    'Normal / Safe': ('Low', '🟢'),
}

# HHSI = Rothfusz heat index (HI_IMD, Celsius form) scaled up by the
# sector's Vulnerability Index. A sector at VI=0 keeps HHSI == HI_IMD; a
# sector at VI=1 gets its heat index boosted by up to HHSI_MAX_BOOST.
# This is a modeling assumption, not derived from your data — tune it if
# you get real health-outcome data to calibrate against later.
#
# AGE GROUPS HHSI IS MODELING FOR: children 0-6 years and adults 60+
# years (Census of India age brackets — the closest available data for
# this region), used as a proxy for the WHO/CDC clinically-defined
# high-risk ages of <5 and 65+. These two groups drive the
# population_sensitivity component via vulnerable_population_density
# above. Medically vulnerable people of ANY age (patients, chronic
# conditions) are separately captured via hospital-proximity in
# sensitive_facility_score. HHSI does NOT separately account for outdoor
# workers, pregnant women, or people without home cooling — there's no
# data in this pipeline to locate those groups spatially.
HHSI_MAX_BOOST = 0.30

# ---------------------------------------------------------
# 8. Daily Heat Hazard & HHSI — one classification per (sector, date)
# ---------------------------------------------------------
# PREVIOUS BUG: heat_hazard_class was set from
# classify_heat_hazard(weather_df['HI_IMD'].max()) — the single hottest
# hour across the ENTIRE Mar–May dataset, broadcast as one class to every
# sector. Peak May heat index in Bhubaneswar comfortably clears the 55°C
# 'Extreme Danger' threshold, so every sector inherited that one worst
# hour's classification regardless of date or location — hence "every
# zone is Danger". Fix: classify per DAY using that day's own HI_IMD, not
# once for the whole season.

TIMELINE_START = pd.Timestamp('2026-03-01')
TIMELINE_END = pd.Timestamp('2026-05-12')  # "today" — no data beyond this is used

weather_df['date'] = pd.to_datetime(weather_df['datetime']).dt.normalize()
weather_daily = weather_df[
    (weather_df['date'] >= TIMELINE_START) & (weather_df['date'] <= TIMELINE_END)
].copy()

if weather_daily.empty:
    raise ValueError(
        f"No rows in weather_df fall between {TIMELINE_START.date()} and {TIMELINE_END.date()}. "
        f"weather_df's actual date range is {weather_df['date'].min().date()} to {weather_df['date'].max().date()} — "
        f"check your CSVs actually cover the timeline dates before re-running."
    )

available_dates = sorted(weather_daily['date'].unique())
print(f"\nBuilding daily timeline for {len(available_dates)} dates: {pd.Timestamp(available_dates[0]).date()} -> {pd.Timestamp(available_dates[-1]).date()}")

# Optional: per-date spatial heat index from the thermal-stress CSV — same
# spatial-variation idea as before, now keyed by date too. Falls back to
# the single-station weather pipeline (still varies day to day, just not
# by sector) for any date without station coverage.
ts_lookup = {}
if thermal_stress_csv.exists():
    ts_df = pd.read_csv(thermal_stress_csv)
    ts_df['date'] = pd.to_datetime(dict(year=ts_df['YEAR'], month=ts_df['MO'], day=ts_df['DY']))
    n_stations = ts_df[['Latitude', 'Longitude']].drop_duplicates().shape[0]

    if n_stations > 1 and 'Heat_Index_C' in ts_df.columns:
        print(f"✅ {thermal_stress_csv.name} has {n_stations} station locations — using per-date spatial heat index where available.")
        for d, grp in ts_df.groupby('date'):
            station_summary = grp.groupby(['Latitude', 'Longitude']).agg(
                HI_ts_mean=('Heat_Index_C', 'mean'),
                HI_ts_max=('Heat_Index_C', 'max')
            ).reset_index()
            ts_lookup[pd.Timestamp(d)] = gpd.GeoDataFrame(
                station_summary,
                geometry=gpd.points_from_xy(station_summary['Longitude'], station_summary['Latitude']),
                crs="EPSG:4326"
            ).to_crs(epsg=32645)
    else:
        print(f"ℹ️  {thermal_stress_csv.name} has only {n_stations} distinct station location — HI_IMD stays uniform per sector on every date (it still varies day to day, just not spatially).")
else:
    print(f"⚠️  WARNING: thermal stress file not found at {thermal_stress_csv} — HI_IMD stays uniform per sector on every date.")

public_data_dir = PROJECT_ROOT / 'public' / 'data'
public_data_dir.mkdir(parents=True, exist_ok=True)
timeline_dir = public_data_dir / 'timeline'
timeline_dir.mkdir(parents=True, exist_ok=True)

STATIC_EXPORT_COLUMNS = [
    'sector_id', 'area_m2',
    'LST', 'NDVI', 'vegetation_cover_pct',
    'vulnerability_index', 'vulnerability_class',
    'zone_type', 'age_vulnerable_share',
    'population_density_per_km2', 'vulnerable_population_density_per_km2',
    'population_density_class', 'population_sensitivity',
    'dist_hospital_m', 'dist_hospital_km', 'dist_school_m', 'dist_park_m',
    'sensitive_facility_score', 'low_greenery_score',
    'outdoor_exposure_score', 'outdoor_exposure',
]

manifest = {'today': TIMELINE_END.strftime('%Y-%m-%d'), 'dates': []}
daily_records = []

for d in available_dates:
    d = pd.Timestamp(d)
    day_weather = weather_daily[weather_daily['date'] == d]

    day_gdf = gdf_sectors.copy()
    day_gdf['air_temp'] = round(float(day_weather['air_temp'].mean()), 2)
    day_gdf['rel_humidity'] = round(float(day_weather['rel_humidity'].mean()), 2)
    day_gdf['wind_speed'] = round(float(day_weather['wind_speed'].mean()), 2)
    # solar_rad_J_m2 is an hourly energy total; divide by 3600s to express
    # the day's average irradiance in W/m² for the popup.
    day_gdf['solar_rad_W_m2'] = round(float(day_weather['solar_rad_J_m2'].mean()) / 3600, 1)
    day_gdf['HI_IMD_mean'] = round(float(day_weather['HI_IMD'].mean()), 2)
    day_gdf['HI_IMD_max'] = round(float(day_weather['HI_IMD'].max()), 2)

    if d in ts_lookup:
        joined_ts = gpd.sjoin_nearest(
            gpd.GeoDataFrame({'sector_id': day_gdf['sector_id']}, geometry=sector_centroids, crs="EPSG:32645"),
            ts_lookup[d][['HI_ts_mean', 'HI_ts_max', 'geometry']],
            how='left'
        )
        day_gdf['HI_IMD_mean'] = np.round(joined_ts['HI_ts_mean'].values, 2)
        day_gdf['HI_IMD_max'] = np.round(joined_ts['HI_ts_max'].values, 2)

    day_gdf['risk_class'] = day_gdf['HI_IMD_max'].apply(classify_heat_hazard)

    day_gdf['HHSI_mean'] = np.round(day_gdf['HI_IMD_mean'] * (1 + HHSI_MAX_BOOST * day_gdf['vulnerability_index']), 2)
    day_gdf['HHSI_max'] = np.round(day_gdf['HI_IMD_max'] * (1 + HHSI_MAX_BOOST * day_gdf['vulnerability_index']), 2)
    day_gdf['hhsi_class'] = day_gdf['HHSI_max'].apply(classify_heat_hazard)

    day_gdf['overall_risk'] = day_gdf['hhsi_class'].map(lambda c: _OVERALL_RISK_MAP[c][0])
    day_gdf['overall_risk_emoji'] = day_gdf['hhsi_class'].map(lambda c: _OVERALL_RISK_MAP[c][1])

    daily_records.append(day_gdf[['sector_id', 'HHSI_mean', 'HHSI_max', 'hhsi_class']].assign(date=d.strftime('%Y-%m-%d')))

    export_cols = STATIC_EXPORT_COLUMNS + [
        'air_temp', 'rel_humidity', 'wind_speed', 'solar_rad_W_m2',
        'HI_IMD_mean', 'HI_IMD_max', 'HHSI_mean', 'HHSI_max',
        'risk_class', 'hhsi_class', 'overall_risk', 'overall_risk_emoji',
        'geometry',
    ]
    day_export = day_gdf[export_cols].copy().to_crs(epsg=4326)
    day_export = day_export.rename(columns={'HI_IMD_max': 'HI_IMD'})

    date_str = d.strftime('%Y-%m-%d')
    day_path = timeline_dir / f'heat_risk_zones_{date_str}.geojson'
    day_export.to_file(day_path, driver='GeoJSON')

    manifest['dates'].append({
        'date': date_str,
        'file': f'timeline/heat_risk_zones_{date_str}.geojson',
        'hhsi_max_overall': round(float(day_gdf['HHSI_max'].max()), 2),
        'danger_or_worse_sectors': int(day_gdf['hhsi_class'].isin(['Danger', 'Extreme Danger']).sum()),
    })

    if d == pd.Timestamp(available_dates[-1]):
        # Alias "today" (the latest date) to the plain heat_risk_zones.geojson
        # path so anything already fetching that exact URL keeps working
        # without needing the date-timeline UI wired in first.
        day_export.to_file(public_data_dir / 'heat_risk_zones.geojson', driver='GeoJSON')

manifest_path = timeline_dir / 'manifest.json'
with open(manifest_path, 'w') as f:
    json.dump(manifest, f, indent=2)

print(f"\n✅ Exported {len(available_dates)} daily GeoJSON files to: {timeline_dir}")
print(f"✅ Manifest written to: {manifest_path}")
print(f"✅ Latest date ({pd.Timestamp(available_dates[-1]).date()}) aliased to: {public_data_dir / 'heat_risk_zones.geojson'}")

# ---------------------------------------------------------
# 9. Season-summary CSV (whole Mar 1 - May 12 window, per sector)
# ---------------------------------------------------------
# Replaces the old heat_risk_processed.csv, which had the same broadcast
# bug — HI_IMD_mean/max were single scalars copied onto every row, so
# every sector showed identical season stats. This version aggregates the
# real per-day, per-sector HHSI values computed in the loop above.

output_dir = PROJECT_ROOT / 'ml' / 'outputs'
output_dir.mkdir(parents=True, exist_ok=True)

all_daily_df = pd.concat(daily_records, ignore_index=True)
season_summary = all_daily_df.groupby('sector_id').agg(
    HHSI_season_mean=('HHSI_mean', 'mean'),
    HHSI_season_max=('HHSI_max', 'max'),
    danger_days=('hhsi_class', lambda s: s.isin(['Danger', 'Extreme Danger']).sum()),
).reset_index()

season_csv_df = gdf_sectors[[
    'sector_id', 'area_m2', 'LST', 'NDVI', 'vegetation_cover_pct',
    'vulnerability_index', 'vulnerability_class',
    'population_density_per_km2', 'population_density_class',
    'dist_hospital_km', 'outdoor_exposure',
]].merge(season_summary, on='sector_id')

processed_csv = output_dir / 'heat_risk_processed.csv'
season_csv_df.to_csv(processed_csv, index=False)
print(f"\n✅ Season-summary CSV exported to: {processed_csv}")
print(f"   HHSI_season_max range: {season_csv_df['HHSI_season_max'].min():.2f} - {season_csv_df['HHSI_season_max'].max():.2f}")
print(f"   Sectors with >=1 danger day: {(season_csv_df['danger_days'] > 0).sum()} / {len(season_csv_df)}")

# ---------------------------------------------------------
# 10. Hourly heat-hazard CSV (Mar 1 - May 12 window only)
# ---------------------------------------------------------
hourly_csv = output_dir / "heat_risk_hourly_processed.csv"
hourly_output = weather_daily[[
    "datetime", "rel_humidity", "air_temp", "wind_speed",
    "solar_rad_J_m2", "HI_IMD", "heat_hazard_score", "heat_hazard_class"
]].copy()
hourly_output.to_csv(hourly_csv, index=False)
print(f"\n✅ Hourly CSV (Mar 1 - May 12 only) exported to: {hourly_csv}")

print("\nHeat-risk model completed successfully.")