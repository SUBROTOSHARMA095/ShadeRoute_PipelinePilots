"""
build_nwp_training_data.py
==========================
Constructs the historical NWP-vs-Observation training dataset for the ShadeRoute
heatwave prediction upgrade.

Coordinates: SOA ITER Campus / Bhubaneswar (20.25°N, 85.80°E)
Observation Source: data/ShadeRoute_FULL_Hourly_20150102_20260512.csv
NWP Source: Open-Meteo Historical Forecast API (ECMWF-based model archive)
Period: 2022-01-01 to 2026-05-12

This aligns historical forecast variables (including atmospheric pressure, CAPE,
precipitation, humidity, wind) with ground truth heatwave occurrences.
"""

import os
import sys
import time
import requests
import numpy as np
import pandas as pd
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = DATA_DIR / "heatwave_prediction"
RAW_OBS_CSV = DATA_DIR / "ShadeRoute_FULL_Hourly_20150102_20260512.csv"
RAW_NWP_CACHE_CSV = OUTPUT_DIR / "raw_historical_nwp_hourly_2022_2026.csv"
FINAL_TRAINING_CSV = OUTPUT_DIR / "nwp_training_dataset.csv"

LATITUDE = 20.25
LONGITUDE = 85.80
START_DATE = "2022-01-01"
END_DATE = "2026-05-12"
VH_MIN_HOURS = 3  # V1 definition: >=3 hours of Heat Index >= 41°C

NWP_VARS = [
    "temperature_2m",
    "dew_point_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation",
    "rain",
    "showers",
    "surface_pressure",
    "pressure_msl",
    "cloud_cover",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "direct_normal_irradiance",
    "cape"
]


def fetch_historical_nwp_hourly(start_date: str, end_date: str) -> pd.DataFrame:
    """Fetches historical NWP forecasts from Open-Meteo Historical Forecast API in annual chunks."""
    if RAW_NWP_CACHE_CSV.exists():
        print(f"[NWP] Loading cached historical NWP data from {RAW_NWP_CACHE_CSV}...")
        df_cached = pd.read_csv(RAW_NWP_CACHE_CSV)
        df_cached["time"] = pd.to_datetime(df_cached["time"])
        return df_cached

    print(f"[NWP] Downloading historical NWP forecast archive ({start_date} to {end_date}) for ({LATITUDE}, {LONGITUDE})...")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    start_dt = pd.to_datetime(start_date)
    end_dt = pd.to_datetime(end_date)
    all_chunks = []

    # Fetch year-by-year
    for year in range(start_dt.year, end_dt.year + 1):
        y_start = max(pd.Timestamp(f"{year}-01-01"), start_dt).strftime("%Y-%m-%d")
        y_end = min(pd.Timestamp(f"{year}-12-31"), end_dt).strftime("%Y-%m-%d")
        
        url = (
            f"https://historical-forecast-api.open-meteo.com/v1/forecast"
            f"?latitude={LATITUDE}&longitude={LONGITUDE}"
            f"&start_date={y_start}&end_date={y_end}"
            f"&hourly={','.join(NWP_VARS)}"
            f"&timezone=auto"
        )
        print(f"  Fetching NWP chunk for {year} ({y_start} to {y_end})...")
        resp = requests.get(url, timeout=45)
        if resp.status_code != 200:
            raise RuntimeError(f"Open-Meteo Historical Forecast API error {resp.status_code}: {resp.text[:300]}")
        
        data = resp.json().get("hourly", {})
        chunk_df = pd.DataFrame(data)
        chunk_df["time"] = pd.to_datetime(chunk_df["time"])
        all_chunks.append(chunk_df)
        time.sleep(0.5)

    nwp_df = pd.concat(all_chunks, ignore_index=True).drop_duplicates(subset=["time"]).sort_values("time").reset_index(drop=True)
    nwp_df.to_csv(RAW_NWP_CACHE_CSV, index=False)
    print(f"[NWP] Successfully downloaded and cached {len(nwp_df)} hourly NWP records to {RAW_NWP_CACHE_CSV}")
    return nwp_df


def aggregate_nwp_daily(nwp_df: pd.DataFrame) -> pd.DataFrame:
    """Aggregates hourly NWP into daily features and pressure tendencies."""
    df = nwp_df.copy()
    df["DATE"] = df["time"].dt.date

    # Hourly pressure differences (3h, 6h, 12h)
    df = df.sort_values("time").reset_index(drop=True)
    df["pressure_diff_3h"] = df["surface_pressure"].diff(3)
    df["pressure_diff_6h"] = df["surface_pressure"].diff(6)
    df["pressure_diff_12h"] = df["surface_pressure"].diff(12)

    daily = df.groupby("DATE").agg(
        forecast_tmax=("temperature_2m", "max"),
        forecast_tmin=("temperature_2m", "min"),
        forecast_tmean=("temperature_2m", "mean"),
        forecast_dewpt_mean=("dew_point_2m", "mean"),
        forecast_rh_mean=("relative_humidity_2m", "mean"),
        forecast_rh_min=("relative_humidity_2m", "min"),
        forecast_apptemp_max=("apparent_temperature", "max"),
        forecast_precip_sum=("precipitation", "sum"),
        forecast_rain_sum=("rain", "sum"),
        forecast_showers_sum=("showers", "sum"),
        forecast_surface_pressure_mean=("surface_pressure", "mean"),
        forecast_surface_pressure_min=("surface_pressure", "min"),
        forecast_pressure_msl_mean=("pressure_msl", "mean"),
        forecast_cloud_mean=("cloud_cover", "mean"),
        forecast_wind_mean=("wind_speed_10m", "mean"),
        forecast_wind_max=("wind_speed_10m", "max"),
        forecast_gust_max=("wind_gusts_10m", "max"),
        forecast_radiation_sum=("direct_normal_irradiance", "sum"),
        forecast_cape_max=("cape", "max"),
        forecast_cape_mean=("cape", "mean"),
        pressure_change_3h_min=("pressure_diff_3h", "min"),
        pressure_change_6h_min=("pressure_diff_6h", "min"),
        pressure_change_12h_min=("pressure_diff_12h", "min"),
    ).reset_index()

    daily["DATE"] = pd.to_datetime(daily["DATE"])
    daily = daily.sort_values("DATE").reset_index(drop=True)

    # 24h pressure tendency (day-over-day mean pressure change)
    daily["pressure_change_24h"] = daily["forecast_surface_pressure_mean"].diff(1)
    
    # Rapid pressure drop indicator (e.g. falling by > 3 hPa / 0.3 kPa in 24h)
    daily["rapid_pressure_drop"] = (daily["pressure_change_24h"] < -3.0).astype(int)
    
    # Convective storm risk proxy: CAPE * Rain / Pressure
    daily["convective_storm_proxy"] = (
        (daily["forecast_cape_max"] * (daily["forecast_showers_sum"] + 0.1)) / 
        (daily["forecast_surface_pressure_mean"] + 1e-5)
    )

    return daily


def load_and_process_observations(raw_csv: Path) -> pd.DataFrame:
    """Loads NASA POWER ground truth observations and calculates heatwave labels and lags."""
    print(f"[OBS] Loading ground truth observations from {raw_csv}...")
    df = pd.read_csv(raw_csv)
    df["DateTime_LST"] = pd.to_datetime(df["DateTime_LST"])
    df["DATE"] = df["DateTime_LST"].dt.date

    # Heat Index >= 41°C or Thermal_Stress == 'Very High'
    vh_mask = (df["Thermal_Stress"] == "Very High") | (df["Heat_Index_C"] >= 41.0)
    vh_hours = df[vh_mask].groupby("DATE").size().reset_index(name="OBS_VH_HOURS")

    daily = df.groupby("DATE").agg(
        OBS_TMAX=("Air_Temperature_C", "max"),
        OBS_TMIN=("Air_Temperature_C", "min"),
        OBS_TMEAN=("Air_Temperature_C", "mean"),
        OBS_RH_MEAN=("Relative_Humidity_pct", "mean"),
        OBS_WS_MEAN=("Wind_Speed_m_s", "mean"),
        OBS_SOLAR_SUM=("Solar_Radiation", "sum"),
        OBS_CLOUD_MEAN=("Cloud_Cover_pct", "mean"),
        OBS_DEWPT_MEAN=("Dew_Point_C", "mean"),
        OBS_HEATIDX_MAX=("Heat_Index_C", "max"),
        OBS_APPTEMP_MAX=("Apparent_Temperature_C", "max"),
        OBS_PRECIP_SUM=("PRECTOTCORR", "sum"),
        OBS_PRESSURE_MEAN=("Surface_Pressure_kPa", "mean"),
    ).reset_index()

    daily["DATE"] = pd.to_datetime(daily["DATE"])
    vh_hours["DATE"] = pd.to_datetime(vh_hours["DATE"])
    daily = daily.merge(vh_hours, on="DATE", how="left")
    daily["OBS_VH_HOURS"] = daily["OBS_VH_HOURS"].fillna(0).astype(int)

    # Standard V1 definition: >=3 hours of Very High heat index
    daily["HEATWAVE_DAY"] = (daily["OBS_VH_HOURS"] >= VH_MIN_HOURS).astype(int)
    daily = daily.sort_values("DATE").reset_index(drop=True)

    # Observation lags & rolling metrics
    for lag in [1, 2, 3, 5, 7]:
        daily[f"obs_tmax_lag{lag}"] = daily["OBS_TMAX"].shift(lag)
        daily[f"obs_heatidx_lag{lag}"] = daily["OBS_HEATIDX_MAX"].shift(lag)
        daily[f"obs_vh_hours_lag{lag}"] = daily["OBS_VH_HOURS"].shift(lag)
        daily[f"obs_precip_lag{lag}"] = daily["OBS_PRECIP_SUM"].shift(lag)

    daily["obs_pressure_lag1"] = daily["OBS_PRESSURE_MEAN"].shift(1)
    daily["obs_rh_lag1"] = daily["OBS_RH_MEAN"].shift(1)
    daily["obs_cloud_lag1"] = daily["OBS_CLOUD_MEAN"].shift(1)

    daily["obs_tmax_roll3"] = daily["OBS_TMAX"].shift(1).rolling(3).mean()
    daily["obs_tmax_roll5"] = daily["OBS_TMAX"].shift(1).rolling(5).mean()
    daily["obs_tmax_roll7"] = daily["OBS_TMAX"].shift(1).rolling(7).mean()
    daily["obs_heatidx_roll3"] = daily["OBS_HEATIDX_MAX"].shift(1).rolling(3).mean()
    daily["obs_heatidx_roll7"] = daily["OBS_HEATIDX_MAX"].shift(1).rolling(7).mean()
    daily["obs_vh_hours_roll3"] = daily["OBS_VH_HOURS"].shift(1).rolling(3).sum()
    daily["obs_vh_hours_roll7"] = daily["OBS_VH_HOURS"].shift(1).rolling(7).sum()

    daily["obs_tmax_trend_3d"] = daily["obs_tmax_lag1"] - daily["obs_tmax_lag3"]
    daily["obs_tmax_trend_7d"] = daily["obs_tmax_lag1"] - daily["obs_tmax_lag7"]

    return daily


def build_aligned_nwp_dataset():
    """Builds and saves the final NWP-vs-Observation dataset."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # 1. Fetch & aggregate NWP forecasts
    nwp_hourly = fetch_historical_nwp_hourly(START_DATE, END_DATE)
    nwp_daily = aggregate_nwp_daily(nwp_hourly)

    # 2. Process observations
    obs_daily = load_and_process_observations(RAW_OBS_CSV)

    # 3. Merge NWP daily and Observations daily on DATE
    merged = pd.merge(nwp_daily, obs_daily, on="DATE", how="inner")
    merged = merged.sort_values("DATE").reset_index(drop=True)

    # 4. Add Calendar / Seasonality features
    merged["YEAR"] = merged["DATE"].dt.year
    merged["MONTH"] = merged["DATE"].dt.month
    merged["DOY"] = merged["DATE"].dt.dayofyear
    merged["DOY_sin"] = np.sin(2 * np.pi * merged["DOY"] / 365.25)
    merged["DOY_cos"] = np.cos(2 * np.pi * merged["DOY"] / 365.25)

    # 5. Create multi-horizon targets and forward-looking forecast alignment
    # For day d, predicting d+h:
    for h in [1, 2, 3]:
        merged[f"TARGET_h{h}"] = merged["HEATWAVE_DAY"].shift(-h)
        # Shift forward the NWP forecast corresponding to day d+h
        for col in [
            "forecast_tmax", "forecast_tmin", "forecast_tmean", "forecast_rh_mean",
            "forecast_precip_sum", "forecast_rain_sum", "forecast_showers_sum",
            "forecast_surface_pressure_mean", "forecast_cape_max", "forecast_cloud_mean",
            "forecast_wind_max", "pressure_change_24h", "rapid_pressure_drop"
        ]:
            merged[f"{col}_target_h{h}"] = merged[col].shift(-h)

        # Target day seasonal features
        target_doy = (merged["DOY"] + h - 1) % 365 + 1
        merged[f"DOY_sin_target_h{h}"] = np.sin(2 * np.pi * target_doy / 365.25)
        merged[f"DOY_cos_target_h{h}"] = np.cos(2 * np.pi * target_doy / 365.25)

    merged.to_csv(FINAL_TRAINING_CSV, index=False)
    print("=" * 70)
    print(f"[OK] NWP Training Dataset successfully generated!")
    print(f"     Path: {FINAL_TRAINING_CSV}")
    print(f"     Total Aligned Days: {len(merged)} (from {merged['DATE'].min().date()} to {merged['DATE'].max().date()})")
    print(f"     Observed Heatwave Days in Dataset: {merged['HEATWAVE_DAY'].sum()} ({(merged['HEATWAVE_DAY'].mean()*100):.1f}%)")
    print("=" * 70)
    return merged


if __name__ == "__main__":
    build_aligned_nwp_dataset()
