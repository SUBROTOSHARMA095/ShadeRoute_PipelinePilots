"""
live_nwp_forecast.py
====================
Live NWP Forecast & Post-Processing Engine for ShadeRoute.

Responsibilities:
1. Ingests live ECMWF-backed NWP forecast from Open-Meteo for (20.25°N, 85.80°E).
2. Computes direct hourly biometeorological human thermal stress (Heat Index).
3. Computes hourly atmospheric pressure tendencies (3h, 6h, 12h, 24h).
4. Employs the trained V2 NWP post-processing model to predict calibrated +1, +2, +3
   day heatwave probabilities without hard-coded calendar dates.
5. Generates NWP-aware Early Warnings (NORMAL / WATCH / HEAT WARNING / SEVERE HEAT WARNING).
6. Issues rapid barometric pressure drop & convective storm advisories.
7. Drives dynamic patient surge forecasting for campus & referral facilities.
8. Writes live output artifacts to `public/data/live_*.json`.
"""

import os
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import json
import math
import pickle
import requests
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
PUBLIC_DATA_DIR = BASE_DIR / "public" / "data"
MODEL_PKL_PATH = BASE_DIR / "ml" / "models" / "nwp_heatwave_v2.pkl"
OBS_CSV_PATH = BASE_DIR / "data" / "ShadeRoute_FULL_Hourly_20150102_20260512.csv"
TRAINING_CSV_PATH = BASE_DIR / "data" / "heatwave_prediction" / "nwp_training_dataset.csv"

# Target Coordinates: Bhubaneswar / SOA ITER
LATITUDE = 20.25
LONGITUDE = 85.80
TIMEZONE = "Asia/Kolkata"

# Output files
PREDICTIONS_JSON = PUBLIC_DATA_DIR / "live_predictions.json"
HOURLY_JSON = PUBLIC_DATA_DIR / "live_hourly_forecast.json"
WEATHER_JSON = PUBLIC_DATA_DIR / "live_weather.json"
SURGE_JSON = PUBLIC_DATA_DIR / "live_surge.json"

# Fallback V1 files
V1_PREDICTIONS_JSON = PUBLIC_DATA_DIR / "predictions_may2026.json"
V1_HOURLY_JSON = PUBLIC_DATA_DIR / "hourly_predictions_may2026.json"
V1_SURGE_JSON = PUBLIC_DATA_DIR / "hospital_surge_predictions_may2026.json"

NWP_API_URL = "https://api.open-meteo.com/v1/forecast"


def calculate_heat_index(t_c: float, rh: float) -> float:
    """Calculates apparent Heat Index (°C) using NOAA / Rothfusz equation."""
    if t_c < 20.0 or rh <= 0:
        return t_c

    # Convert to Fahrenheit for standard NOAA polynomial
    t_f = t_c * 9.0 / 5.0 + 32.0
    r = min(max(rh, 1.0), 100.0)

    # NOAA's preliminary value is averaged with air temperature before deciding
    # whether the Rothfusz regression applies.  Omitting this average biases
    # apparent temperature upward around the transition to the regression.
    simple_hi_f = 0.5 * (t_f + 61.0 + ((t_f - 68.0) * 1.2) + (r * 0.094))
    hi_f = (simple_hi_f + t_f) / 2.0
    
    if hi_f >= 80.0:
        # Full Rothfusz polynomial
        hi_f = (
            -42.379
            + 2.04901523 * t_f
            + 10.14333127 * r
            - 0.22475541 * t_f * r
            - 0.00683783 * (t_f ** 2)
            - 0.05481717 * (r ** 2)
            + 0.00122874 * (t_f ** 2) * r
            + 0.00072546 * t_f * (r ** 2)
            - 0.00000199 * (t_f ** 2) * (r ** 2)
        )
        if r < 13.0 and 80.0 <= t_f <= 112.0:
            adj = ((13.0 - r) / 4.0) * math.sqrt((17.0 - abs(t_f - 95.0)) / 17.0)
            hi_f -= adj
        elif r > 85.0 and 80.0 <= t_f <= 87.0:
            adj = ((r - 85.0) / 10.0) * ((87.0 - t_f) / 5.0)
            hi_f += adj

    hi_c = (hi_f - 32.0) * 5.0 / 9.0
    return round(hi_c, 2)


def calculate_effective_hourly_heat_index(
    t_c: float,
    rh: float,
    precip_mm: float = 0.0,
    cloud_pct: float = 0.0,
    solar_rad: float = None
) -> float:
    """
    Calculates biometeorologically calibrated apparent heat index (°C) for hourly NWP forecast.
    Considers:
    - Base NOAA/Rothfusz heat index equation.
    - Coastal Temperature Floor Calibration: In coastal Odisha, if ambient air temperature is
      mild (< 33°C), high humidity represents tropical mugginess, not clinical heatstroke emergency.
    - Active Precipitation Cooling: Rain converts sensible heat into latent heat, immediately cooling
      both ambient air and wet human skin.
    - Cloud Cover & Solar Attenuation: Thick overcast clouds suppress direct solar irradiance (DNI)
      and Mean Radiant Temperature (T_mrt).
    """
    raw_hi = calculate_heat_index(t_c, rh)
    
    # 1. Coastal Temperature Calibration
    if t_c < 37.0:
        if t_c <= 30.0:
            max_infl = 5.0
        elif t_c <= 33.0:
            max_infl = 5.0 + (t_c - 30.0) * (4.0 / 3.0)
        else:
            max_infl = 9.0 + (t_c - 33.0) * 1.25
        capped_hi = min(raw_hi, t_c + max_infl)
    else:
        capped_hi = raw_hi
        
    # 2. Solar Radiation / Cloud Attenuation
    if cloud_pct is not None and cloud_pct > 30.0:
        f_solar = 1.0 - 0.15 * min(1.0, (cloud_pct - 30.0) / 70.0)
    elif solar_rad is not None and solar_rad < 500.0:
        f_solar = 0.85 + 0.15 * max(0.0, solar_rad / 500.0)
    else:
        f_solar = 1.0
        
    # 3. Active Precipitation Cooling
    p = float(precip_mm or 0.0)
    if p >= 2.0:
        f_rain = 0.84
    elif p >= 0.5:
        f_rain = 0.90
    elif p > 0.0:
        f_rain = 0.95
    else:
        f_rain = 1.0
        
    effective_hi = capped_hi * f_solar * f_rain
    return round(max(float(effective_hi), float(t_c)), 2)


def get_thermal_stress_category(hi_c: float) -> str:
    """Classifies Heat Index into standard thermal stress tiers."""
    if hi_c >= 54.0:
        return "Extreme"
    elif hi_c >= 41.0:
        return "Very High"
    elif hi_c >= 38.0:
        return "High"
    elif hi_c >= 32.0:
        return "Caution"
    else:
        return "OK"


REQUIRED_HOURLY_FIELDS = {
    "time", "temperature_2m", "relative_humidity_2m", "apparent_temperature",
    "precipitation_probability", "precipitation", "rain", "showers",
    "surface_pressure", "cloud_cover", "wind_speed_10m", "wind_gusts_10m", "cape",
}


def validate_hourly_forecast(df: pd.DataFrame) -> pd.DataFrame:
    """Reject incomplete or non-finite NWP responses before model inference."""
    missing = REQUIRED_HOURLY_FIELDS.difference(df.columns)
    if missing:
        raise ValueError(f"Forecast response is missing required hourly fields: {sorted(missing)}")
    if len(df) < 72:
        raise ValueError(f"Forecast response has only {len(df)} hourly records; at least 72 are required")

    df = df.copy()
    df["time"] = pd.to_datetime(df["time"], errors="coerce")
    if df["time"].isna().any() or not df["time"].is_monotonic_increasing or df["time"].duplicated().any():
        raise ValueError("Forecast timestamps are invalid, unordered, or duplicated")

    numeric_fields = REQUIRED_HOURLY_FIELDS - {"time"}
    for field in numeric_fields:
        df[field] = pd.to_numeric(df[field], errors="coerce")
    if not np.isfinite(df[list(numeric_fields)].to_numpy(dtype=float)).all():
        raise ValueError("Forecast response contains missing or non-finite meteorological values")
    if not df["relative_humidity_2m"].between(0, 100).all():
        raise ValueError("Forecast relative humidity is outside 0–100%")
    if not df["precipitation_probability"].between(0, 100).all():
        raise ValueError("Forecast precipitation probability is outside 0–100%")
    return df


def fetch_live_nwp_forecast(test_storm_mode: bool = False) -> pd.DataFrame:
    """Fetches live Open-Meteo NWP forecast for Bhubaneswar."""
    print(f"[NWP] Fetching live ECMWF-based forecast from Open-Meteo for ({LATITUDE}, {LONGITUDE})...")
    
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "hourly": [
            "temperature_2m",
            "relative_humidity_2m",
            "dew_point_2m",
            "apparent_temperature",
            "precipitation_probability",
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
            "cape",
        ],
        "past_days": 7,
        "forecast_days": 5,
        "timezone": "auto",
    }

    try:
        resp = requests.get(NWP_API_URL, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json().get("hourly", {})
        df = validate_hourly_forecast(pd.DataFrame(data))
        print(f"[NWP] Successfully received {len(df)} hourly forecast records.")
    except Exception as err:
        print(f"[NWP ERROR] Failed to fetch live forecast from Open-Meteo: {err}")
        if HOURLY_JSON.exists():
            print("[NWP] Falling back to existing cached forecast.")
            return None
        raise

    if test_storm_mode:
        print("[TEST MODE] Injecting convective low-pressure storm scenario on Day 2...")
        # Artificially drop pressure by 5.5 hPa on Day 2 and add convective rainfall & CAPE
        dates = df["time"].dt.date.unique()
        if len(dates) >= 3:
            storm_date = dates[2]  # +2 days
            mask = df["time"].dt.date == storm_date
            df.loc[mask, "surface_pressure"] -= 5.5
            df.loc[mask, "precipitation_probability"] = 85.0
            df.loc[mask, "showers"] = 14.5
            df.loc[mask, "precipitation"] = 18.0
            df.loc[mask, "cape"] = 1850.0
            df.loc[mask, "cloud_cover"] = 92.0
            df.loc[mask, "temperature_2m"] -= 4.5  # evaporative cooling

    # Compute direct hourly heat index & thermal stress with rain and cloud attenuation
    solar_vals = df["direct_normal_irradiance"] if "direct_normal_irradiance" in df.columns else [None] * len(df)
    precip_vals = df["precipitation"] if "precipitation" in df.columns else [0.0] * len(df)
    cloud_vals = df["cloud_cover"] if "cloud_cover" in df.columns else [30.0] * len(df)

    df["heat_index"] = [
        calculate_effective_hourly_heat_index(t, rh, p, c, sol)
        for t, rh, p, c, sol in zip(df["temperature_2m"], df["relative_humidity_2m"], precip_vals, cloud_vals, solar_vals)
    ]
    df["thermal_stress"] = [get_thermal_stress_category(hi) for hi in df["heat_index"]]

    # Derive pressure differences
    df["pressure_diff_3h"] = df["surface_pressure"].diff(3).bfill()
    df["pressure_diff_6h"] = df["surface_pressure"].diff(6).bfill()
    df["pressure_diff_12h"] = df["surface_pressure"].diff(12).bfill()
    df["pressure_diff_24h"] = df["surface_pressure"].diff(24).bfill()

    return df


def load_recent_observations(forecast_base_date, hourly_df=None):
    """Load lag features dynamically from recent NWP hourly history or historical observations.

    When running live forecasts, the Open-Meteo API supplies past_days=7 of hourly
    reanalysis/historical data. We extract genuine recent observations dynamically
    from those hours, ensuring the lag memory features are authentic and up-to-date.
    If unavailable or stale, fallback to historical CSV or training distribution medians.
    """
    # 1. Compute directly from live hourly_df if past days are present
    if hourly_df is not None and "DATE" in hourly_df.columns:
        past_hourly = hourly_df[hourly_df["DATE"] < forecast_base_date].copy()
        if len(past_hourly) >= 48:  # At least 2 full past days
            daily = past_hourly.groupby("DATE").agg(
                TMAX=("temperature_2m", "max"),
                HEATIDX_MAX=("heat_index", "max"),
                VH_HOURS=("thermal_stress", lambda s: int(s.isin(["Very High", "Extreme"]).sum())),
                PRECIP=("precipitation", "sum"),
                PRESSURE=("surface_pressure", "mean"),
                RH=("relative_humidity_2m", "mean"),
                CLOUD=("cloud_cover", "mean"),
            ).reset_index().sort_values("DATE")

            if len(daily) >= 2:
                latest_observation = daily["DATE"].iloc[-1]
                age_days = (forecast_base_date - latest_observation).days
                if age_days <= 2:
                    n_days = len(daily)
                    tmax_arr = daily["TMAX"].values
                    hi_arr = daily["HEATIDX_MAX"].values
                    vh_arr = daily["VH_HOURS"].values
                    recent = {
                        "obs_tmax_lag1": float(tmax_arr[-1]),
                        "obs_tmax_lag2": float(tmax_arr[-2]) if n_days >= 2 else float(tmax_arr[-1]),
                        "obs_tmax_lag3": float(tmax_arr[-3]) if n_days >= 3 else float(tmax_arr[-1]),
                        "obs_heatidx_lag1": float(hi_arr[-1]),
                        "obs_heatidx_lag2": float(hi_arr[-2]) if n_days >= 2 else float(hi_arr[-1]),
                        "obs_vh_hours_lag1": float(vh_arr[-1]),
                        "obs_precip_lag1": float(daily["PRECIP"].iloc[-1]),
                        "obs_pressure_lag1": float(daily["PRESSURE"].iloc[-1]),
                        "obs_rh_lag1": float(daily["RH"].iloc[-1]),
                        "obs_cloud_lag1": float(daily["CLOUD"].iloc[-1]),
                        "obs_tmax_roll3": float(tmax_arr[-min(3, n_days):].mean()),
                        "obs_tmax_roll5": float(tmax_arr[-min(5, n_days):].mean()),
                        "obs_tmax_roll7": float(tmax_arr.mean()),
                        "obs_heatidx_roll3": float(hi_arr[-min(3, n_days):].mean()),
                        "obs_heatidx_roll7": float(hi_arr.mean()),
                        "obs_vh_hours_roll3": float(vh_arr[-min(3, n_days):].sum()),
                        "obs_vh_hours_roll7": float(vh_arr.sum()),
                        "obs_tmax_trend_3d": float(tmax_arr[-1] - (tmax_arr[-min(3, n_days)] if n_days >= 3 else tmax_arr[0])),
                        "obs_tmax_trend_7d": float(tmax_arr[-1] - (tmax_arr[-min(7, n_days)] if n_days >= 7 else tmax_arr[0])),
                    }
                    return recent, {
                        "status": "recent",
                        "source": "live_nwp_recent_history",
                        "latest_observation_date": str(latest_observation),
                        "age_days": age_days,
                    }

    # 2. Fallback to historical CSV if present and valid
    if OBS_CSV_PATH.exists():
        df = pd.read_csv(OBS_CSV_PATH)
        df["DateTime_LST"] = pd.to_datetime(df["DateTime_LST"])
        df["DATE"] = df["DateTime_LST"].dt.date
        
        daily = df.groupby("DATE").agg(
            TMAX=("Air_Temperature_C", "max"),
            HEATIDX_MAX=("Heat_Index_C", "max"),
            PRESSURE=("Surface_Pressure_kPa", "mean"),
            RH=("Relative_Humidity_pct", "mean"),
            PRECIP=("PRECTOTCORR", "sum"),
            CLOUD=("Cloud_Cover_pct", "mean"),
        ).reset_index().sort_values("DATE")
        daily = daily[daily["DATE"] < forecast_base_date].tail(14)
        if len(daily) >= 7:
            latest_observation = daily["DATE"].iloc[-1]
            age_days = (forecast_base_date - latest_observation).days
            if age_days <= 2:
                recent = {
                    "obs_tmax_lag1": float(daily["TMAX"].iloc[-1]),
                    "obs_tmax_lag2": float(daily["TMAX"].iloc[-2]),
                    "obs_tmax_lag3": float(daily["TMAX"].iloc[-3]),
                    "obs_heatidx_lag1": float(daily["HEATIDX_MAX"].iloc[-1]),
                    "obs_heatidx_lag2": float(daily["HEATIDX_MAX"].iloc[-2]),
                    "obs_vh_hours_lag1": 0.0,
                    "obs_precip_lag1": float(daily["PRECIP"].iloc[-1]),
                    "obs_pressure_lag1": float(daily["PRESSURE"].iloc[-1] * 10.0),  # kPa -> hPa approx
                    "obs_rh_lag1": float(daily["RH"].iloc[-1]),
                    "obs_cloud_lag1": float(daily["CLOUD"].iloc[-1]),
                    "obs_tmax_roll3": float(daily["TMAX"].tail(3).mean()),
                    "obs_tmax_roll5": float(daily["TMAX"].tail(5).mean()),
                    "obs_tmax_roll7": float(daily["TMAX"].tail(7).mean()),
                    "obs_heatidx_roll3": float(daily["HEATIDX_MAX"].tail(3).mean()),
                    "obs_heatidx_roll7": float(daily["HEATIDX_MAX"].tail(7).mean()),
                    "obs_vh_hours_roll3": 0.0,
                    "obs_vh_hours_roll7": 0.0,
                    "obs_tmax_trend_3d": float(daily["TMAX"].iloc[-1] - daily["TMAX"].iloc[-3]),
                    "obs_tmax_trend_7d": float(daily["TMAX"].iloc[-1] - daily["TMAX"].iloc[-7]),
                }
                return recent, {
                    "status": "recent",
                    "source": "historical_csv",
                    "latest_observation_date": str(latest_observation),
                    "age_days": age_days,
                }

    # 3. If observations are missing or stale, return metadata indicating fallback
    return {}, {
        "status": "stale",
        "source": "training_distribution_medians",
        "reason": "recent observations unavailable; calibrated training medians applied safely",
    }


def apply_feature_fallbacks(feature_dict, feature_names, model_info):
    """Fill absent lag features with training medians, never stale observations."""
    fallbacks = model_info.get("feature_medians", {})
    missing = [name for name in feature_names if name not in feature_dict]
    unavailable = [name for name in missing if name not in fallbacks]
    # Compatibility for an already-trained bundle.  This is intentionally a
    # training-distribution fallback, not a proxy for current observations.
    if unavailable and TRAINING_CSV_PATH.exists():
        historical = pd.read_csv(TRAINING_CSV_PATH, usecols=lambda c: c in unavailable)
        fallbacks = {
            **fallbacks,
            **{name: float(historical[name].median()) for name in unavailable if name in historical},
        }
        unavailable = [name for name in missing if name not in fallbacks]
    if unavailable:
        raise ValueError(
            "Model bundle has no safe fallback for required features: " + ", ".join(unavailable)
        )
    feature_dict = {**feature_dict, **{name: fallbacks[name] for name in missing}}
    return pd.DataFrame([feature_dict]).reindex(columns=feature_names)


def generate_live_predictions(hourly_df: pd.DataFrame):
    """Predicts heatwave probabilities, builds advisories, and generates JSON files."""
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    
    # Load V2 model bundle
    if not MODEL_PKL_PATH.exists():
        raise FileNotFoundError(f"Trained model not found at {MODEL_PKL_PATH}. Run heat_wave_prediction_v2.py first.")
    
    with open(MODEL_PKL_PATH, "rb") as f:
        model_bundle = pickle.load(f)

    now_iso = datetime.now(timezone(timedelta(hours=5, minutes=30))).isoformat()

    # Current IST datetime
    now_ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    today_date = now_ist.date()

    # Split hourly by calendar date
    hourly_df["DATE"] = hourly_df["time"].dt.date
    dates = sorted(hourly_df["DATE"].unique())
    
    # Active today is base date; forecast targets are Today (H0) plus next 3 days (H1, H2, H3)
    base_date = today_date if today_date in dates else dates[-4]
    target_dates = [d for d in dates if d >= base_date][:4]
    obs_recent, observation_context = load_recent_observations(base_date, hourly_df)

    daily_predictions = {}
    hourly_forecast_results = {}
    
    for t_date in target_dates:
        day_hourly = hourly_df[hourly_df["DATE"] == t_date]
        if len(day_hourly) == 0:
            continue
        
        date_str = str(t_date)
        doy = t_date.timetuple().tm_yday
        horizon_offset = (t_date - base_date).days
        is_today = (horizon_offset == 0)
        h = horizon_offset
        month = t_date.month

        # Seasonal context label for UI
        if month == 3:
            seasonal_context = "Pre-Monsoon (Early Heat Season)"
        elif month in [4, 5]:
            seasonal_context = "Pre-Monsoon / Peak Summer"
        elif month == 6:
            seasonal_context = "Monsoon Onset / Late Pre-Monsoon"
        elif month in [7, 8, 9]:
            seasonal_context = "Southwest Monsoon Season"
        elif month in [10, 11]:
            seasonal_context = "Post-Monsoon (Retreating Monsoon)"
        elif month in [12, 1, 2]:
            seasonal_context = "Winter (Low Thermal Risk)"
        else:
            seasonal_context = "Seasonal Transition"
        
        # 1. Compute day aggregates
        tmax = float(day_hourly["temperature_2m"].max())
        tmin = float(day_hourly["temperature_2m"].min())
        tmean = float(day_hourly["temperature_2m"].mean())
        rh_mean = float(day_hourly["relative_humidity_2m"].mean())
        precip_sum = float(day_hourly["precipitation"].sum())
        rain_sum = float(day_hourly["rain"].sum())
        showers_sum = float(day_hourly["showers"].sum())

        # PoP is a probability for a stated location and time window.  Means of
        # hourly PoP are not a valid daily PoP, so publish the source's maximum
        # hourly PoP with its hour rather than inventing a daily probability.
        peak_idx = day_hourly["precipitation_probability"].idxmax()
        peak_hour_val = int(day_hourly.loc[peak_idx]["time"].hour)
        peak_hour_str = f"{peak_hour_val:02d}:00"

        rain_prob_peak = float(day_hourly["precipitation_probability"].max())
        rain_prob_display = int(round(rain_prob_peak))
        rain_prob_max = rain_prob_peak

        pressure_mean = float(day_hourly["surface_pressure"].mean())
        pressure_min = float(day_hourly["surface_pressure"].min())
        cape_max = float(day_hourly["cape"].max())
        cloud_mean = float(day_hourly["cloud_cover"].mean())
        wind_max = float(day_hourly["wind_speed_10m"].max())
        wind_mean = float(day_hourly["wind_speed_10m"].mean())
        p_drop_24h = float(day_hourly["pressure_diff_24h"].min())
        rapid_drop = 1 if p_drop_24h < -3.0 else 0

        # Apparent temperature (feels-like heat index)
        apparent_temp_max = float(day_hourly["apparent_temperature"].max()) if "apparent_temperature" in day_hourly.columns else tmax
        apparent_temp_mean = float(day_hourly["apparent_temperature"].mean()) if "apparent_temperature" in day_hourly.columns else tmean

        # Monsoon suppression: high humidity + active precip suppresses heatwave risk
        is_monsoon_suppressed = (rh_mean >= 70.0) and (precip_sum > 1.0 or rain_prob_max >= 40.0)

        # Humidity discomfort label (relevant even without heatwave risk)
        if apparent_temp_max >= 54:
            humidity_discomfort = f"Extreme Danger (feels like {apparent_temp_max:.0f}\u00b0C)"
        elif apparent_temp_max >= 46:
            humidity_discomfort = f"Danger \u2013 Heat exhaustion likely ({apparent_temp_max:.0f}\u00b0C feels-like)"
        elif apparent_temp_max >= 40:
            humidity_discomfort = f"Extreme Caution ({apparent_temp_max:.0f}\u00b0C feels-like)"
        elif apparent_temp_max >= 33:
            humidity_discomfort = f"Muggy / Uncomfortable (feels like {apparent_temp_max:.0f}\u00b0C)"
        elif apparent_temp_max >= 27:
            humidity_discomfort = f"Slightly humid but tolerable (feels like {apparent_temp_max:.0f}\u00b0C)"
        else:
            humidity_discomfort = f"Comfortable (feels like {apparent_temp_max:.0f}\u00b0C)"

        # 2. Build multi-horizon feature vector including key biometeorological predictors
        feature_dict = {
            f"forecast_tmax_target_h{h}": tmax,
            f"forecast_tmin_target_h{h}": tmin,
            f"forecast_tmean_target_h{h}": tmean,
            f"forecast_rh_mean_target_h{h}": rh_mean,
            f"forecast_precip_sum_target_h{h}": precip_sum,
            f"forecast_rain_sum_target_h{h}": rain_sum,
            f"forecast_showers_sum_target_h{h}": showers_sum,
            f"forecast_surface_pressure_mean_target_h{h}": pressure_mean,
            f"forecast_cape_max_target_h{h}": cape_max,
            f"forecast_cloud_mean_target_h{h}": cloud_mean,
            f"forecast_wind_max_target_h{h}": wind_max,
            f"pressure_change_24h_target_h{h}": p_drop_24h,
            f"rapid_pressure_drop_target_h{h}": rapid_drop,
            f"forecast_apptemp_max_target_h{h}": apparent_temp_max,
            f"forecast_dewpt_mean_target_h{h}": float(day_hourly["dew_point_2m"].mean()) if "dew_point_2m" in day_hourly.columns else (tmean - 2.0),
            f"forecast_radiation_sum_target_h{h}": float(day_hourly["direct_normal_irradiance"].sum()) if "direct_normal_irradiance" in day_hourly.columns else 0.0,
            f"forecast_rh_min_target_h{h}": float(day_hourly["relative_humidity_2m"].min()),
            "pressure_change_24h": p_drop_24h,
            "pressure_change_3h_min": float(day_hourly["pressure_diff_3h"].min()),
            "convective_storm_proxy": (cape_max * (showers_sum + 0.1)) / (pressure_mean + 1e-5),
            f"DOY_sin_target_h{h}": np.sin(2 * np.pi * doy / 365.25),
            f"DOY_cos_target_h{h}": np.cos(2 * np.pi * doy / 365.25),
            "MONTH": t_date.month,
            **obs_recent,
        }

        model_info = model_bundle["horizons"][h]
        feature_names = model_info["features"]
        X_vec = apply_feature_fallbacks(feature_dict, feature_names, model_info)
        proba = float(model_info["model"].predict_proba(X_vec)[0, 1])
        optimal_th = float(model_info.get("optimal_threshold", 0.40))
        is_hw = (proba >= optimal_th)
        risk_score = proba
        prediction = "HEATWAVE" if is_hw else "No heatwave"
        forecast_kind = "same_day_nowcast" if is_today else "day_ahead_probability"

        # 3. Direct hourly analysis (08:00 - 20:00)
        day_daytime = day_hourly[(day_hourly["time"].dt.hour >= 8) & (day_hourly["time"].dt.hour <= 20)]
        vh_mask = day_daytime["thermal_stress"].isin(["Very High", "Extreme"])
        vh_hours_count = int(vh_mask.sum())
        unsafe_hours_indices = day_daytime[vh_mask]["time"].dt.hour.tolist()
        ok_hours_indices = day_daytime[day_daytime["thermal_stress"] == "OK"]["time"].dt.hour.tolist()

        if unsafe_hours_indices:
            danger_window = f"{unsafe_hours_indices[0]:02d}:00-{unsafe_hours_indices[-1]+1:02d}:00"
            unsafe_duration = f"{len(unsafe_hours_indices)} hour(s)"
        else:
            danger_window = None
            unsafe_duration = "0 hours"

        # Outdoor safe windows
        def build_hour_ranges(hours):
            if not hours:
                return []
            ranges, start = [], hours[0]
            for a, b in zip(hours, hours[1:] + [None]):
                if b != a + 1:
                    ranges.append(f"{start:02d}:00-{a+1:02d}:00")
                    start = b
            return ranges

        # 4. Atmospheric / Storm Advisory logic
        has_storm_risk = (p_drop_24h < -3.0) and (rain_prob_max >= 30.0 or showers_sum > 0.5 or cape_max > 800.0)
        advisory_msg = None
        if has_storm_risk:
            advisory_msg = (
                f"Atmospheric pressure falling rapidly ({p_drop_24h:.1f} hPa/24h). "
                f"Rain/thunderstorm activity may suppress daytime heat intensity."
            )

        # Narrative weather summary
        if is_today and is_monsoon_suppressed and risk_score < 0.35:
            if vh_hours_count >= 1:
                weather_summary = (
                    f"Today's weather: High of {tmax:.1f}°C (feels like {apparent_temp_max:.0f}°C). "
                    f"NWP hourly analysis shows a {vh_hours_count}-hour heat stress window around {danger_window} "
                    f"before afternoon monsoon rain arrives ({rain_prob_peak:.0f}% peak probability). "
                    f"Calibrated heatwave risk remains low ({risk_score*100:.1f}%)."
                )
            else:
                weather_summary = (
                    f"Today's weather: High of {tmax:.1f}°C, feels like {apparent_temp_max:.0f}°C with {rh_mean:.0f}% humidity. "
                    f"Cloud cover and active monsoon moisture suppress heatwave risk ({risk_score*100:.1f}% probability). "
                    f"Peak precipitation probability is {rain_prob_peak:.0f}% around {peak_hour_str}."
                )
        elif is_monsoon_suppressed and risk_score < 0.35:
            if vh_hours_count >= 1:
                # Key case: brief heat stress window before rain despite overall high rain probability
                weather_summary = (
                    f"Despite afternoon precipitation probability peaking at {rain_prob_peak:.0f}%, NWP hourly analysis shows a "
                    f"{vh_hours_count}-hour heat stress window around {danger_window} where the heat index "
                    f"briefly spikes to dangerous levels before afternoon monsoon rain arrives. "
                    f"Model heatwave risk remains low ({risk_score*100:.1f}%) — avoid outdoor exposure during {danger_window}."
                )
            elif precip_sum > 50:
                weather_summary = (
                    f"Heavy monsoon rainfall ({precip_sum:.0f} mm). Cloud cover and rain actively "
                    f"suppress heatwave risk. Humid and muggy conditions persist ({rh_mean:.0f}% RH)."
                )
            elif precip_sum > 5:
                weather_summary = (
                    f"Monsoon showers ({precip_sum:.1f} mm) with {rh_mean:.0f}% humidity. "
                    f"Overcast skies limit solar heating — thermal risk low."
                )
            else:
                weather_summary = (
                    f"High monsoon humidity ({rh_mean:.0f}%) with peak hourly precipitation probability "
                    f"of {rain_prob_peak:.0f}% around {peak_hour_str}. "
                    f"Cloud cover and rainfall suppress daytime heating."
                )
        elif risk_score >= 0.60:
            weather_summary = (
                f"Dangerous heat conditions. Peak {tmax:.1f}°C feels like {apparent_temp_max:.0f}°C "
                f"with {rh_mean:.0f}% humidity — heatstroke risk elevated ({risk_score*100:.1f}% probability)."
            )
        elif risk_score >= optimal_th:
            weather_summary = (
                f"Moderate thermal stress. High of {tmax:.1f}°C feels like {apparent_temp_max:.0f}°C "
                f"with {rh_mean:.0f}% humidity — heatwave watch active ({risk_score*100:.1f}% probability)."
            )
        else:
            weather_summary = (
                f"Low heatwave risk ({risk_score*100:.1f}%). High of {tmax:.1f}°C, feels like {apparent_temp_max:.0f}°C, "
                f"{rh_mean:.0f}% humidity, and peak hourly precipitation probability of {rain_prob_peak:.0f}%."
            )

        # 5. Early Warning determination
        if is_monsoon_suppressed or precip_sum >= 2.0 or rain_prob_peak >= 60.0:
            # Active rain or monsoon conditions suppress synoptic heatwave risk
            if vh_hours_count >= 4 and tmax >= 38.0 and risk_score >= 0.60:
                warning_level = "Severe Heat Warning"
                warning_class = "critical"
            elif (vh_hours_count >= 3 or risk_score >= optimal_th) and tmax >= 37.0:
                warning_level = "Heat Warning"
                warning_class = "warning"
            elif vh_hours_count >= 1 and tmax >= 34.0:
                warning_level = "Humidity-Heat Window"
                warning_class = "caution"
            else:
                warning_level = "Normal"
                warning_class = "safe"
        else:
            if vh_hours_count >= 4 or (risk_score >= 0.70 and vh_hours_count >= 3):
                warning_level = "Severe Heat Warning"
                warning_class = "critical"
            elif vh_hours_count >= 3 or risk_score >= optimal_th:
                warning_level = "Heat Warning"
                warning_class = "warning"
            elif vh_hours_count >= 1 or risk_score >= (optimal_th * 0.75):
                warning_level = "Watch"
                warning_class = "caution"
            else:
                warning_level = "Normal"
                warning_class = "safe"

        # Contributing factors breakdown
        factors = []
        if tmax >= 38.0:
            factors.append(f"🌡️ High temperature ({tmax:.1f}°C)")
        if is_monsoon_suppressed:
            factors.append(f"🌧️ Monsoon moisture ({rh_mean:.0f}% RH) + rain suppressing heatwave risk")
        elif rh_mean >= 60.0:
            factors.append(f"💧 Elevated humidity ({rh_mean:.0f}%) — muggy conditions")
        if precip_sum >= 1.0:
            factors.append(f"🌧️ Active rainfall ({precip_sum:.1f} mm) cooling surface temperatures")
        elif rain_prob_peak >= 40:
            factors.append(f"⛈️ Peak hourly precipitation probability ({rain_prob_peak:.0f}% at {peak_hour_str})")
        if cloud_mean >= 50.0:
            factors.append(f"☁️ Cloud cover ({cloud_mean:.0f}%) attenuating solar radiation")
        elif cloud_mean < 30.0:
            factors.append(f"☀️ Clear skies / high solar radiation")
        if wind_mean < 3.0 and not is_monsoon_suppressed:
            factors.append(f"🍃 Low wind ({wind_mean:.1f} m/s) — poor ventilation")
        if has_storm_risk:
            factors.append(f"⚡ Convective instability (CAPE {cape_max:.0f} J/kg)")
        if not factors:
            factors.append("Standard seasonal conditions")

        # Confidence Estimation
        if is_today:
            confidence = "High (Hourly Nowcast + Model)"
        elif observation_context["status"] == "stale":
            confidence = "Medium (observation fallback)"
        elif has_storm_risk or rain_prob_max > 45.0:
            confidence = "Medium"  # precipitation uncertainty
        elif h == 1 and (risk_score > 0.70 or risk_score < 0.20):
            confidence = "High"
        elif h == 3:
            confidence = "Medium" if risk_score > 0.6 else "Low"
        else:
            confidence = "Medium"

        # Map hourly status to dict
        hourly_status_dict = {}
        hourly_detail_list = []
        for _, row in day_hourly.iterrows():
            hr = int(row["time"].hour)
            status = "UNSAFE" if row["thermal_stress"] in ["Very High", "Extreme"] else (
                "CAUTION" if row["thermal_stress"] == "High" else "OK"
            )
            if 8 <= hr <= 20:
                hourly_status_dict[str(hr)] = status
            
            hourly_detail_list.append({
                "datetime": row["time"].strftime("%Y-%m-%dT%H:00"),
                "hour": hr,
                "temperature": round(float(row["temperature_2m"]), 1),
                "relative_humidity": round(float(row["relative_humidity_2m"]), 0),
                "wind_speed": round(float(row["wind_speed_10m"]), 1),
                "precipitation": round(float(row["precipitation"]), 1),
                "precipitation_probability": int(row["precipitation_probability"]),
                "cloud_cover": int(row["cloud_cover"]),
                "surface_pressure": round(float(row["surface_pressure"]), 1),
                "heat_index": round(float(row["heat_index"]), 1),
                "thermal_stress": row["thermal_stress"],
            })

        # Assemble daily result
        daily_predictions[date_str] = {
            "date": date_str,
            "horizon": horizon_offset,
            "forecast_kind": forecast_kind,
            "observation_context": observation_context,
            "probability_of_heatwave": round(proba, 3),
            "prediction": prediction,
            "risk_level": (
                "Low" if ((is_monsoon_suppressed or precip_sum >= 2.0 or rain_prob_max >= 60.0) and tmax < 36.0 and risk_score < 0.35) else (
                    "High" if (vh_hours_count >= 3 or risk_score >= 0.60) else (
                        "Moderate" if (vh_hours_count >= 1 or risk_score >= optimal_th) else "Low"
                    )
                )
            ),
            "confidence": confidence,
            # Peak hourly PoP; this is deliberately not presented as a daily PoP.
            "rain_probability": rain_prob_display,
            "rain_probability_peak_pct": round(rain_prob_peak, 1),
            "rain_probability_peak_hour": peak_hour_str,
            "rain_probability_note": f"Peak hourly precipitation probability from the NWP forecast: {rain_prob_peak:.0f}% at {peak_hour_str} IST. It is not a daily precipitation probability.",
            "precipitation_mm": round(precip_sum, 1),
            "pressure_hpa": round(pressure_mean, 1),
            "pressure_change_24h": round(p_drop_24h, 1),
            "tmax_c": round(tmax, 1),
            "tmin_c": round(tmin, 1),
            "tmean_c": round(tmean, 1),
            "rh_mean_pct": round(rh_mean, 1),
            "cloud_cover_pct": round(cloud_mean, 1),
            "wind_speed_ms": round(wind_mean, 1),
            "apparent_temp_max": round(apparent_temp_max, 1),
            "monsoon_suppression": is_monsoon_suppressed,
            "seasonal_context": seasonal_context,
            "humidity_discomfort": humidity_discomfort,
            "weather_summary": weather_summary,

            "warning": {
                "level": warning_level,
                "class": warning_class,
                "danger_window": danger_window,
                "unsafe_duration": unsafe_duration,
                "reasons": factors,
            },
            "advisory": advisory_msg,
            "expected_unsafe_duration": unsafe_duration,
            "danger_window": danger_window,
            "recommended_go_out_windows": build_hour_ranges(ok_hours_indices),
            "hourly_status": hourly_status_dict,
        }

        hourly_forecast_results[date_str] = {
            "heatwave_probability": round(proba, 3),
            "forecast_kind": forecast_kind,
            "expected_unsafe_duration": unsafe_duration,
            "danger_window": danger_window,
            "recommended_go_out_windows": build_hour_ranges(ok_hours_indices),
            "hourly_status": hourly_status_dict,
            "hourly_timeline": hourly_detail_list,
            "warning": warning_level,
            "advisory": advisory_msg,
        }

    # Current weather snapshot — use the row nearest to current IST time
    now_ist = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    curr_target = pd.Timestamp(now_ist.replace(minute=0, second=0, microsecond=0, tzinfo=None))
    time_diffs = (hourly_df["time"] - curr_target).abs()
    curr_idx = time_diffs.idxmin()
    curr = hourly_df.loc[curr_idx]
    curr_weather = {
        "generated_at": now_iso,
        "source": "Open-Meteo forecast API (model selection supplied by Open-Meteo)",
        "location": {"latitude": LATITUDE, "longitude": LONGITUDE, "name": "Bhubaneswar / SOA ITER Campus"},
        "current": {
            "time": curr["time"].strftime("%Y-%m-%d %H:%M"),
            "temperature_c": round(float(curr["temperature_2m"]), 1),
            "relative_humidity_pct": int(curr["relative_humidity_2m"]),
            "heat_index_c": round(float(curr["heat_index"]), 1),
            "wind_speed_ms": round(float(curr["wind_speed_10m"]), 1),
            "wind_gusts_ms": round(float(curr["wind_gusts_10m"]), 1),
            "precipitation_probability": int(curr["precipitation_probability"]),
            "precipitation_mm": round(float(curr["precipitation"]), 1),
            "cloud_cover_pct": int(curr["cloud_cover"]),
            "surface_pressure_hpa": round(float(curr["surface_pressure"]), 1),
            "pressure_tendency_3h": round(float(curr["pressure_diff_3h"]), 1),
            "thermal_stress": curr["thermal_stress"],
        }
    }

    # 6. Recalibrate previous predictions & merge with fresh NWP forecast
    # This preserves historical predictions (e.g. yesterday, past days) across midnight rollovers
    merged_predictions = {}
    if PREDICTIONS_JSON.exists():
        try:
            with open(PREDICTIONS_JSON, "r", encoding="utf-8") as f:
                existing_preds = json.load(f)
                for d_str, d_info in existing_preds.items():
                    try:
                        d_obj = datetime.strptime(d_str, "%Y-%m-%d").date()
                        if d_obj < base_date:
                            past_offset = (d_obj - base_date).days
                            if past_offset == -1:
                                d_info["horizon"] = past_offset
                                d_info["is_historical"] = True
                                d_info["is_today"] = False
                                d_info["history_label"] = "Yesterday (Observed & Verified)"
                                merged_predictions[d_str] = d_info
                    except Exception:
                        pass
        except Exception as err:
            print(f"[WARN] Could not parse existing predictions: {err}")

    # Add fresh daily predictions (today and forward forecast)
    for d_str, d_info in daily_predictions.items():
        d_info["is_historical"] = False
        d_info["is_today"] = (d_info["horizon"] == 0)
        merged_predictions[d_str] = d_info

    # Sort merged predictions chronologically
    merged_predictions = dict(sorted(merged_predictions.items(), key=lambda x: x[0]))

    # Merge hourly timelines similarly (keeping only yesterday for historical reference)
    merged_hourly = {}
    if HOURLY_JSON.exists():
        try:
            with open(HOURLY_JSON, "r", encoding="utf-8") as f:
                existing_hourly = json.load(f)
                for d_str, h_info in existing_hourly.items():
                    try:
                        d_obj = datetime.strptime(d_str, "%Y-%m-%d").date()
                        if d_obj < base_date:
                            past_offset = (d_obj - base_date).days
                            if past_offset == -1:
                                merged_hourly[d_str] = h_info
                    except Exception:
                        pass
        except Exception:
            pass
    merged_hourly.update(hourly_forecast_results)
    merged_hourly = dict(sorted(merged_hourly.items(), key=lambda x: x[0]))

    # Save merged predictions so patient surge model can ingest both historical and fresh dates
    with open(PREDICTIONS_JSON, "w", encoding="utf-8") as f:
        json.dump(merged_predictions, f, indent=2)
    with open(HOURLY_JSON, "w", encoding="utf-8") as f:
        json.dump(merged_hourly, f, indent=2)
    with open(WEATHER_JSON, "w", encoding="utf-8") as f:
        json.dump(curr_weather, f, indent=2)

    # 7. Run Patient Surge Model for these dynamic forecast dates
    from ml.patient_surge_model import calculate_surge_predictions
    print("[SURGE] Generating patient surge predictions for calibrated dates...")
    surge_results = calculate_surge_predictions(
        predictions_json_path=PREDICTIONS_JSON,
        hourly_json_path=HOURLY_JSON,
        output_json_path=SURGE_JSON,
    )

    # 8. Update spatial heat risk danger zones & timeline manifest for live dates
    try:
        from ml.expand_heat_risk_timeline import run_timeline_expansion
        print("[SPATIAL] Updating dynamic campus heat risk zones for live dates...")
        run_timeline_expansion()
    except Exception as err:
        print(f"[WARN] Spatial timeline update skipped: {err}")
    print(f"[OK] Live NWP Forecast generated successfully at {now_iso}")
    for d, info in merged_predictions.items():
        hist_str = f" [HISTORICAL: {info.get('history_label')}]" if info.get("is_historical") else ""
        adv = f" | Advisory: {info.get('advisory')}" if info.get('advisory') else ""
        probability = info.get("probability_of_heatwave")
        probability_label = "N/A (hourly nowcast)" if probability is None else f"{probability:.2f}"
        print(f"  * {d} ({info.get('horizon', 0):+d}d): P(HW)={probability_label} ({info.get('prediction', 'N/A')}) | "
              f"{info.get('warning', {}).get('level', 'Normal')} ({info.get('expected_unsafe_duration', '0 hours')}){hist_str}{adv}")
    print("=" * 70)
    return merged_predictions


def run_live_forecast(test_storm_mode: bool = False):
    """Main execution function with fallback to cached files if offline."""
    try:
        hourly_df = fetch_live_nwp_forecast(test_storm_mode=test_storm_mode)
        if hourly_df is not None:
            return generate_live_predictions(hourly_df)
    except Exception as e:
        print(f"[ERROR] Live NWP execution failed: {e}")
        # If files already exist, don't crash
        if PREDICTIONS_JSON.exists():
            print(f"[FALLBACK] Retaining existing {PREDICTIONS_JSON}.")
            return None
        else:
            raise


if __name__ == "__main__":
    test_mode = "--test-storm" in sys.argv
    run_live_forecast(test_storm_mode=test_mode)
