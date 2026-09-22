"""
expand_heat_risk_timeline.py
============================
Expands ShadeRoute's heat risk mapping from simulated 12th May 2026
up to actual today/yesterday, plus the next 3-day forecast window.

Uses the EXACT SAME mathematical formulation, sector grid (30m x 30m),
vulnerability weights, and hazard thresholds as `ml/heat_risk_model.py`:
- IMD Heat Index equation: HI_IMD
- Human Heat Stress Index: HHSI = HI_IMD * (1 + 0.30 * vulnerability_index)
- IMD 5-Tier Hazard Classification (Normal, Caution, Extreme Caution, Danger, Extreme Danger)
- Overall Risk Mapping (Low, Moderate, High, Critical)

Automates meteorological data fetching dynamically from Open-Meteo Archive & Forecast APIs
so manual CSV maintenance is never required.
"""

import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import json
import time
import requests
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DATA_DIR = BASE_DIR / "public" / "data"
TIMELINE_DIR = PUBLIC_DATA_DIR / "timeline"
MANIFEST_PATH = TIMELINE_DIR / "manifest.json"
TEMPLATE_GEOJSON_PATH = TIMELINE_DIR / "heat_risk_zones_2026-05-12.geojson"

# Coordinates: SOA ITER Campus / Bhubaneswar
LATITUDE = 20.25
LONGITUDE = 85.80
HHSI_MAX_BOOST = 0.30

# IMD 5-Tier Hazard Classification (exact match with heat_risk_model.py)
def classify_heat_hazard(hi: float) -> str:
    if hi >= 55.0:
        return "Extreme Danger"
    elif hi >= 46.0:
        return "Danger"
    elif hi >= 41.0:
        return "Extreme Caution"
    elif hi >= 35.0:
        return "Caution"
    else:
        return "Normal / Safe"

_OVERALL_RISK_MAP = {
    "Extreme Danger": ("Critical", "🔴"),
    "Danger": ("High", "🟠"),
    "Extreme Caution": ("Moderate", "🟡"),
    "Caution": ("Moderate", "🟡"),
    "Normal / Safe": ("Low", "🟢"),
}


def calculate_imd_heat_index(temp_c: np.ndarray, rh: np.ndarray) -> np.ndarray:
    """Exact IMD heat index polynomial used in ml/heat_risk_model.py."""
    hi = (
        -8.784695
        + 1.61139411 * temp_c
        + 2.33854900 * rh
        - 0.14611605 * temp_c * rh
        - 0.012308094 * (temp_c ** 2)
        - 0.016424828 * (rh ** 2)
        + 0.002211732 * (temp_c ** 2) * rh
        + 0.00072546 * temp_c * (rh ** 2)
        - 0.000003582 * (temp_c ** 2) * (rh ** 2)
    )
    return np.round(hi, 2)


def calculate_effective_heat_index(
    temp_c,
    rh,
    precip_sum_mm=0.0,
    cloud_cover_pct=30.0,
    solar_rad_W_m2=None,
    precip_lag1_mm=0.0
):
    """
    Calculates biometeorologically calibrated Effective Heat Index (°C) for Bhubaneswar/coastal Odisha.
    Exact match with ml/heat_risk_model.py:
    1. Base Rothfusz / IMD Heat Index polynomial.
    2. Coastal Temperature Floor Calibration: In coastal stations (IMD criteria), true heatwave hazard
       requires elevated ambient dry-bulb temperature (threshold in BBSR >= 37°C coastal / 40°C plains).
       When ambient air temperature is mild (< 33°C), high humidity represents tropical mugginess,
       not clinical heatstroke emergency. We prevent exponential polynomial runaway below 33°C.
    3. Solar Radiation / Cloud Cover Attenuation:
       Overcast skies (cloud cover >= 60% or direct solar < 250 W/m²) significantly reduce
       downwelling shortwave radiation and Mean Radiant Temperature (T_mrt), dampening thermal hazard.
    4. Rainfall & Antecedent Precipitation Cooling:
       Active rain (precip >= 2mm) provides direct evaporative and convective cooling.
       Antecedent rainfall (past 24h precip >= 5mm) maintains wet surfaces, shifting the Bowen ratio
       to latent cooling and suppressing heat risk.
    """
    raw_hi = calculate_imd_heat_index(temp_c, rh)
    is_series = isinstance(temp_c, (pd.Series, np.ndarray))

    # 1. Coastal Temperature Calibration Factor
    if is_series:
        temp_arr = np.array(temp_c, dtype=float)
        raw_hi_arr = np.array(raw_hi, dtype=float)
        coastal_cap = temp_arr + np.where(
            temp_arr <= 30.0,
            5.0,
            np.where(
                temp_arr <= 33.0,
                5.0 + (temp_arr - 30.0) * (4.0 / 3.0),
                9.0 + (temp_arr - 33.0) * (5.0 / 4.0)
            )
        )
        capped_hi = np.where(temp_arr < 37.0, np.minimum(raw_hi_arr, coastal_cap), raw_hi_arr)
    else:
        t_val = float(temp_c)
        raw_val = float(raw_hi)
        if t_val < 37.0:
            if t_val <= 30.0:
                max_infl = 5.0
            elif t_val <= 33.0:
                max_infl = 5.0 + (t_val - 30.0) * (4.0 / 3.0)
            else:
                max_infl = 9.0 + (t_val - 33.0) * (5.0 / 4.0)
            capped_hi = min(raw_val, t_val + max_infl)
        else:
            capped_hi = raw_val

    # 2. Solar Radiation & Cloud Cover Attenuation (F_solar)
    if cloud_cover_pct is not None:
        if isinstance(cloud_cover_pct, (pd.Series, np.ndarray)):
            cc_arr = np.array(cloud_cover_pct, dtype=float)
            f_solar = np.where(cc_arr > 30.0, 1.0 - 0.15 * np.clip((cc_arr - 30.0) / 70.0, 0.0, 1.0), 1.0)
        else:
            cc = float(cloud_cover_pct)
            f_solar = 1.0 - 0.15 * min(1.0, (cc - 30.0) / 70.0) if cc > 30.0 else 1.0
    elif solar_rad_W_m2 is not None:
        if isinstance(solar_rad_W_m2, (pd.Series, np.ndarray)):
            s_arr = np.array(solar_rad_W_m2, dtype=float)
            f_solar = 0.85 + 0.15 * np.clip(s_arr / 500.0, 0.0, 1.0)
        else:
            s_val = float(solar_rad_W_m2)
            f_solar = 0.85 + 0.15 * max(0.0, min(1.0, s_val / 500.0))
    else:
        f_solar = 1.0

    # 3. Rainfall & Antecedent Precipitation Cooling (F_rain)
    if isinstance(precip_sum_mm, (pd.Series, np.ndarray)):
        p_arr = np.array(precip_sum_mm, dtype=float)
        f_rain_active = np.where(
            p_arr >= 5.0,
            0.84,
            np.where(
                p_arr >= 1.0,
                1.0 - 0.16 * (p_arr / 5.0),
                np.where(p_arr >= 0.2, 0.96, 1.0)
            )
        )
    else:
        p_curr = float(precip_sum_mm or 0.0)
        if p_curr >= 5.0:
            f_rain_active = 0.84
        elif p_curr >= 1.0:
            f_rain_active = 1.0 - 0.16 * (p_curr / 5.0)
        elif p_curr >= 0.2:
            f_rain_active = 0.96
        else:
            f_rain_active = 1.0

    p_lag = float(precip_lag1_mm or 0.0)
    if p_lag >= 10.0:
        f_rain_ante = 0.92
    elif p_lag >= 3.0:
        f_rain_ante = 0.96
    else:
        f_rain_ante = 1.0

    if is_series:
        f_rain = np.minimum(f_rain_active, f_rain_ante)
    else:
        f_rain = min(float(f_rain_active), f_rain_ante)

    effective_hi = capped_hi * f_solar * f_rain
    if is_series:
        effective_hi = np.maximum(effective_hi, temp_arr)
        return np.round(effective_hi, 2)
    else:
        return round(max(float(effective_hi), float(temp_c)), 2)


def fetch_dynamic_weather(start_date: str, yesterday_date: str, forecast_end_date: str) -> pd.DataFrame:
    """Fetches historical archive data up to yesterday, and live forecast for next 3 days."""
    headers = {
        "User-Agent": "ShadeRoute-PipelinePilots/1.0 (https://github.com/SUBROTOSHARMA095/ShadeRoute_PipelinePilots; contact@shaderoute.org)"
    }
    print(f"[FETCH] Ingesting archive weather from {start_date} to {yesterday_date}...")
    
    # 1. Historical Archive (fetching temperature, humidity, wind, solar radiation, precipitation, rain, cloud cover)
    archive_url = (
        f"https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={LATITUDE}&longitude={LONGITUDE}"
        f"&start_date={start_date}&end_date={yesterday_date}"
        f"&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,direct_normal_irradiance,precipitation,rain,cloud_cover"
        f"&timezone=auto"
    )
    df_arch = pd.DataFrame()
    for attempt in range(1, 4):
        try:
            r_arch = requests.get(archive_url, headers=headers, timeout=25)
            r_arch.raise_for_status()
            d_arch = r_arch.json().get("hourly", {})
            df_arch = pd.DataFrame(d_arch)
            break
        except Exception as err:
            print(f"[WARN] Archive fetch attempt {attempt}/3 failed: {err}")
            if attempt < 3:
                time.sleep(2)
            else:
                print(f"[WARN] Proceeding without fresh archive data: {err}")

    # 2. Live Forecast for Today + Next 2-3 Days
    print(f"[FETCH] Ingesting live forecast from Open-Meteo for next 3 days...")
    forecast_url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={LATITUDE}&longitude={LONGITUDE}"
        f"&forecast_days=4"
        f"&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,direct_normal_irradiance,precipitation,rain,cloud_cover"
        f"&timezone=auto"
    )
    df_fore = pd.DataFrame()
    for attempt in range(1, 4):
        try:
            r_fore = requests.get(forecast_url, headers=headers, timeout=20)
            r_fore.raise_for_status()
            d_fore = r_fore.json().get("hourly", {})
            df_fore = pd.DataFrame(d_fore)
            break
        except Exception as err:
            print(f"[WARN] Forecast fetch attempt {attempt}/3 failed: {err}")
            if attempt < 3:
                time.sleep(2)
            else:
                raise

    # Combine & harmonize
    df_all = pd.concat([df_arch, df_fore], ignore_index=True)
    df_all["time"] = pd.to_datetime(df_all["time"])
    df_all = df_all.drop_duplicates(subset=["time"]).sort_values("time").reset_index(drop=True)

    df_all = df_all.rename(columns={
        "temperature_2m": "air_temp",
        "relative_humidity_2m": "rel_humidity",
        "wind_speed_10m": "wind_speed",
        "direct_normal_irradiance": "solar_rad_W_m2",
        "precipitation": "precipitation_mm",
        "cloud_cover": "cloud_cover_pct"
    })

    if "precipitation_mm" not in df_all.columns:
        df_all["precipitation_mm"] = 0.0
    if "cloud_cover_pct" not in df_all.columns:
        df_all["cloud_cover_pct"] = 30.0

    # Compute baseline hourly IMD Heat Index
    df_all["HI_IMD_raw"] = calculate_imd_heat_index(df_all["air_temp"].values, df_all["rel_humidity"].values)
    df_all["date"] = df_all["time"].dt.date
    return df_all


def run_timeline_expansion():
    """Main expansion routine."""
    if not TEMPLATE_GEOJSON_PATH.exists():
        raise FileNotFoundError(f"Template GeoJSON not found at {TEMPLATE_GEOJSON_PATH}")

    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(f"Manifest not found at {MANIFEST_PATH}")

    with open(MANIFEST_PATH, "r") as f:
        manifest = json.load(f)

    existing_dates = set(entry["date"] for entry in manifest.get("dates", []))
    print(f"[TIMELINE] Currently {len(existing_dates)} dates registered in manifest (last: {max(existing_dates)}).")

    # Load 3,213 sector template
    print(f"[TEMPLATE] Loading sector spatial properties from {TEMPLATE_GEOJSON_PATH.name}...")
    with open(TEMPLATE_GEOJSON_PATH, "r", encoding="utf-8") as f:
        template_data = json.load(f)

    features_template = template_data["features"]
    n_sectors = len(features_template)
    print(f"[TEMPLATE] Loaded {n_sectors} sectors with static LST, NDVI, and Vulnerability Indices.")

    # Cache sector vulnerability indices and static properties
    vulnerability_indices = np.array([
        f["properties"].get("vulnerability_index", 0.25) for f in features_template
    ], dtype=float)

    # Dates to fetch: sliding active window (2 days prior to ensure continuous lag, plus today and next 3 days forecast).
    # All earlier historical dates are already cached and preserved in manifest.json and public/data/timeline/.
    now = datetime.now(timezone(timedelta(hours=5, minutes=30)))
    today_str = now.strftime("%Y-%m-%d")
    yesterday_str = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    start_fetch_date = (now - timedelta(days=2)).strftime("%Y-%m-%d")
    forecast_end_str = (now + timedelta(days=3)).strftime("%Y-%m-%d")

    weather_df = fetch_dynamic_weather(start_fetch_date, yesterday_str, forecast_end_str)
    weather_df["date_str"] = weather_df["date"].astype(str)

    target_dates = sorted(weather_df["date_str"].unique())
    print(f"[PROCESS] Generating heat risk maps for {len(target_dates)} dates ({target_dates[0]} to {target_dates[-1]})...")

    new_manifest_entries = []
    generated_count = 0

    t_start = time.time()
    for date_str in target_dates:
        day_path = TIMELINE_DIR / f"heat_risk_zones_{date_str}.geojson"
        
        day_weather = weather_df[weather_df["date_str"] == date_str]
        if len(day_weather) == 0:
            continue

        # Daily weather statistics
        t_mean = round(float(day_weather["air_temp"].mean()), 2)
        rh_mean = round(float(day_weather["rel_humidity"].mean()), 2)
        ws_mean = round(float(day_weather["wind_speed"].mean()), 2)
        sol_mean = round(float(day_weather["solar_rad_W_m2"].mean()), 1)
        day_precip = round(float(day_weather["precipitation_mm"].sum()), 2) if "precipitation_mm" in day_weather.columns else 0.0
        day_cloud = round(float(day_weather["cloud_cover_pct"].mean()), 1) if "cloud_cover_pct" in day_weather.columns else 30.0

        # Antecedent precipitation (yesterday's rain)
        curr_d = pd.to_datetime(date_str)
        prev_str = (curr_d - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        prev_w = weather_df[weather_df["date_str"] == prev_str]
        precip_lag1 = round(float(prev_w["precipitation_mm"].sum()), 2) if len(prev_w) > 0 and "precipitation_mm" in prev_w.columns else 0.0

        # Calculate biometeorologically calibrated effective heat index across hours of the day
        hi_eff_vals = calculate_effective_heat_index(
            day_weather["air_temp"].values,
            day_weather["rel_humidity"].values,
            precip_sum_mm=day_precip,
            cloud_cover_pct=day_cloud,
            solar_rad_W_m2=sol_mean,
            precip_lag1_mm=precip_lag1
        )
        hi_imd_mean = round(float(np.mean(hi_eff_vals)), 2)
        hi_imd_max = round(float(np.max(hi_eff_vals)), 2)
        day_risk_class = classify_heat_hazard(hi_imd_max)

        # Per-sector HHSI calculations (vectorized for speed)
        hhsi_means = np.round(hi_imd_mean * (1.0 + HHSI_MAX_BOOST * vulnerability_indices), 2)
        hhsi_maxs = np.round(hi_imd_max * (1.0 + HHSI_MAX_BOOST * vulnerability_indices), 2)

        # Update features
        new_features = []
        danger_sectors_count = 0
        max_hhsi_overall = float(np.max(hhsi_maxs))

        for idx, feat in enumerate(features_template):
            props = dict(feat["properties"])
            h_mean = float(hhsi_means[idx])
            h_max = float(hhsi_maxs[idx])
            h_class = classify_heat_hazard(h_max)
            ov_risk, ov_emoji = _OVERALL_RISK_MAP[h_class]

            if h_class in ["Danger", "Extreme Danger"]:
                danger_sectors_count += 1

            props["air_temp"] = t_mean
            props["rel_humidity"] = rh_mean
            props["wind_speed"] = ws_mean
            props["solar_rad_W_m2"] = sol_mean
            props["precipitation_mm"] = day_precip
            props["cloud_cover_pct"] = day_cloud
            props["HI_IMD_mean"] = hi_imd_mean
            props["HI_IMD"] = hi_imd_max
            props["HHSI_mean"] = h_mean
            props["HHSI_max"] = h_max
            props["risk_class"] = day_risk_class
            props["hhsi_class"] = h_class
            props["overall_risk"] = ov_risk
            props["overall_risk_emoji"] = ov_emoji

            new_features.append({
                "type": "Feature",
                "properties": props,
                "geometry": feat["geometry"]
            })

        out_geojson = {
            "type": "FeatureCollection",
            "name": f"heat_risk_zones_{date_str}",
            "crs": template_data.get("crs"),
            "features": new_features
        }

        with open(day_path, "w", encoding="utf-8") as f:
            json.dump(out_geojson, f)

        manifest_entry = {
            "date": date_str,
            "file": f"timeline/heat_risk_zones_{date_str}.geojson",
            "hhsi_max_overall": max_hhsi_overall,
            "danger_or_worse_sectors": danger_sectors_count
        }

        # Append or replace in manifest
        existing_idx = next((i for i, d in enumerate(manifest["dates"]) if d["date"] == date_str), None)
        if existing_idx is not None:
            manifest["dates"][existing_idx] = manifest_entry
        else:
            manifest["dates"].append(manifest_entry)

        generated_count += 1
        if generated_count % 15 == 0 or date_str == target_dates[-1]:
            print(f"  [+] Generated {date_str} (HHSI Max: {max_hhsi_overall}°C, Danger Sectors: {danger_sectors_count})")

    # Sort manifest chronologically
    manifest["dates"] = sorted(manifest["dates"], key=lambda x: x["date"])
    
    # Set "today" in manifest to actual today (fallback to yesterday if today not in target dates)
    manifest["today"] = today_str if today_str in [d["date"] for d in manifest["dates"]] else (
        yesterday_str if yesterday_str in [d["date"] for d in manifest["dates"]] else target_dates[-1]
    )

    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Alias latest today GeoJSON to public/data/heat_risk_zones.geojson
    today_file = TIMELINE_DIR / f"heat_risk_zones_{manifest['today']}.geojson"
    if today_file.exists():
        with open(today_file, "r", encoding="utf-8") as f_in, open(PUBLIC_DATA_DIR / "heat_risk_zones.geojson", "w", encoding="utf-8") as f_out:
            f_out.write(f_in.read())
        print(f"[OK] Aliased {manifest['today']} to public/data/heat_risk_zones.geojson")

    elapsed = round(time.time() - t_start, 2)
    print("=" * 80)
    print(f"[COMPLETE] Heat risk mapping expanded successfully in {elapsed}s!")
    print(f"           New Total Dates: {len(manifest['dates'])} (from {manifest['dates'][0]['date']} to {manifest['dates'][-1]['date']})")
    print(f"           Active 'Today' in digital twin: {manifest['today']}")
    print("=" * 80)
    return manifest


if __name__ == "__main__":
    run_timeline_expansion()
