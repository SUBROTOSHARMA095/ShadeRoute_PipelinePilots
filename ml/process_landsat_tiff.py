import os
import numpy as np
import pandas as pd
import rasterio
from rasterio.warp import transform

# Ensure output directory exists
os.makedirs('public/data', exist_ok=True)

# 1. Define File Paths
data_dir = 'data/satellite83'
power_file = os.path.join(data_dir, 'POWER_Point_Hourly_20260301_20260531_020d25N_085d80E_LST.csv')
solar_file = os.path.join(data_dir, 'Hourly_Solar_Radiation_March_to_May_2026.csv')

# 2. Extract Landsat TIFF Pixel Data & Coordinates
# Adjust filenames below to match your dataset (e.g., LST.tif or B4.tif/B5.tif)
lst_tiff_path = os.path.join(data_dir, 'SOA_Neighbour_LST_Summer_2026.tif') 
ndvi_tiff_path = os.path.join(data_dir, 'SOA_Neighbour_NDVI_Summer_2026.tif') 

def extract_raster_pixels(tiff_path, value_col_name='pixel_value'):
    with rasterio.open(tiff_path) as src:
        band = src.read(1)
        transform_affine = src.transform
        crs = src.crs

        # Get non-null pixel row and column indices
        rows, cols = np.where(~np.isnan(band) & (band != src.nodata))
        values = band[rows, cols]

        # Convert pixel indices to native spatial coordinates
        xs, ys = rasterio.transform.xy(transform_affine, rows, cols)

        # Reproject coordinates to WGS84 (EPSG:4326) if necessary
        if crs and crs.to_string() != 'EPSG:4326':
            lons, lats = transform(crs, 'EPSG:4326', xs, ys)
        else:
            lons, lats = xs, ys

        return pd.DataFrame({
            'longitude': np.round(lons, 6),
            'latitude': np.round(lats, 6),
            value_col_name: values
        })

# Load raster data
if os.path.exists(lst_tiff_path) and os.path.exists(ndvi_tiff_path):
    df_lst = extract_raster_pixels(lst_tiff_path, 'LST')
    df_ndvi = extract_raster_pixels(ndvi_tiff_path, 'NDVI')
    df_grid = pd.merge(df_lst, df_ndvi, on=['latitude', 'longitude'], how='inner')
else:
    # Fallback: Compute NDVI from Band 4 (Red) & Band 5 (NIR) TIFFs
    b4_path = os.path.join(data_dir, 'B4.tif')
    b5_path = os.path.join(data_dir, 'B5.tif')
    b10_path = os.path.join(data_dir, 'B10.tif')

    df_b4 = extract_raster_pixels(b4_path, 'B4')
    df_b5 = extract_raster_pixels(b5_path, 'B5')
    df_b10 = extract_raster_pixels(b10_path, 'LST')

    df_grid = pd.merge(df_b4, df_b5, on=['latitude', 'longitude'])
    df_grid = pd.merge(df_grid, df_b10, on=['latitude', 'longitude'])

    # Compute Spectral Indices
    # NDVI = (NIR - Red) / (NIR + Red)
    df_grid['NDVI'] = (df_grid['B5'] - df_grid['B4']) / (df_grid['B5'] + df_grid['B4'] + 1e-6)
    df_grid['NDBI'] = 0.15  # Default baseline if SWIR band not present

# 3. Fuse Meteorology & Thermal Stress (sWBGT)
df_power = pd.read_csv(power_file, skiprows=10)
df_solar = pd.read_csv(solar_file)

avg_temp = df_power['T2M'].max()
avg_rh = df_power['RH2M'].mean()
avg_solar = (df_solar['solar_radiation_J_m2'] / 3600.0).max()

# Calculate Vapor pressure e (hPa) & sWBGT (°C)
e = (avg_rh / 100.0) * 6.105 * np.exp((17.27 * avg_temp) / (237.7 + avg_temp))
swbgt = 0.567 * avg_temp + 0.393 * e + 3.94 + (avg_solar * 0.002) - 0.2

df_grid['sWBGT'] = np.round(swbgt, 1)

# 4. Priority Score & Intervention Categorization
df_grid['priority_score'] = np.round(
    ((1.0 - df_grid['NDVI']) * 0.5 + (df_grid['LST'] / df_grid['LST'].max()) * 0.5) * 100, 1
)

def classify_priority(score):
    if score >= 80: return 'Very High'
    elif score >= 60: return 'High'
    elif score >= 40: return 'Moderate'
    elif score >= 20: return 'Low'
    else: return 'Very Low'

df_grid['priority_class'] = df_grid['priority_score'].apply(classify_priority)
df_grid['intervention_type'] = np.where(df_grid['priority_score'] >= 75, 'Mist Sprayer', 'Tree Planting')
df_grid['recommendation'] = np.where(
    df_grid['intervention_type'] == 'Mist Sprayer',
    'High thermal load detected. Install high-pressure mist cooling corridor.',
    'Dense urban heat spot. Priority zone for native shade canopy tree planting.'
)

# 5. Export Processed Grid to public/data/
output_csv = 'public/data/SOA_ITER_Processed_HeatRisk_2026.csv'
df_grid.to_csv(output_csv, index=False)
print(f"Extracted {len(df_grid)} Landsat pixel nodes -> Saved to {output_csv}")