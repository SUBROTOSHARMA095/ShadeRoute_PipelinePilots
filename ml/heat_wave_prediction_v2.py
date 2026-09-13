"""
heat_wave_prediction_v2.py
==========================
V2 NWP Post-Processing Machine Learning Model for ShadeRoute.

Predicts 1-day, 2-day, and 3-day ahead heatwave probability for the SOA ITER
campus (Bhubaneswar, Odisha) by combining:
1. Live/Forecasted NWP variables (Temperature, RH, Wind, Precipitation,
   Atmospheric Pressure, CAPE, Cloud Cover, Pressure Tendencies)
2. Recent ground observations & lagged thermal history
3. Synoptic pressure drop & convective instability indicators
4. Calendar seasonality

Compares out-of-sample performance directly against the V1 baseline and
persists calibrated models to `ml/models/nwp_heatwave_v2.pkl`.
"""

import os
import json
import pickle
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    brier_score_loss,
    average_precision_score,
    confusion_matrix,
)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "heatwave_prediction"
MODELS_DIR = BASE_DIR / "ml" / "models"
TRAINING_CSV = DATA_DIR / "nwp_training_dataset.csv"
MODEL_OUTPUT_PKL = MODELS_DIR / "nwp_heatwave_v2.pkl"
COMPARISON_CSV = DATA_DIR / "v1_vs_v2_comparison.csv"

SPLIT_YEAR = 2024  # Train on <= 2024, Test on 2025-2026 forward-in-time
HORIZONS = [1, 2, 3]


def get_feature_list_for_horizon(h: int) -> list:
    """Returns the comprehensive feature set for forecast horizon h."""
    nwp_forecast_features = [
        f"forecast_tmax_target_h{h}",
        f"forecast_tmin_target_h{h}",
        f"forecast_tmean_target_h{h}",
        f"forecast_rh_mean_target_h{h}",
        f"forecast_precip_sum_target_h{h}",
        f"forecast_rain_sum_target_h{h}",
        f"forecast_showers_sum_target_h{h}",
        f"forecast_surface_pressure_mean_target_h{h}",
        f"forecast_cape_max_target_h{h}",
        f"forecast_cloud_mean_target_h{h}",
        f"forecast_wind_max_target_h{h}",
        f"pressure_change_24h_target_h{h}",
        f"rapid_pressure_drop_target_h{h}",
    ]

    obs_features = [
        "obs_tmax_lag1",
        "obs_tmax_lag2",
        "obs_tmax_lag3",
        "obs_heatidx_lag1",
        "obs_heatidx_lag2",
        "obs_vh_hours_lag1",
        "obs_precip_lag1",
        "obs_pressure_lag1",
        "obs_rh_lag1",
        "obs_cloud_lag1",
        "obs_tmax_roll3",
        "obs_tmax_roll5",
        "obs_tmax_roll7",
        "obs_heatidx_roll3",
        "obs_heatidx_roll7",
        "obs_vh_hours_roll3",
        "obs_vh_hours_roll7",
        "obs_tmax_trend_3d",
        "obs_tmax_trend_7d",
    ]

    atmospheric_trends = [
        "pressure_change_24h",
        "pressure_change_3h_min",
        "convective_storm_proxy",
    ]

    seasonal_features = [
        f"DOY_sin_target_h{h}",
        f"DOY_cos_target_h{h}",
        "MONTH",
    ]

    return nwp_forecast_features + obs_features + atmospheric_trends + seasonal_features


def evaluate_models(df: pd.DataFrame):
    """Evaluates V2 model against V1 baseline on held-out out-of-sample data."""
    print("=" * 80)
    print(f"=== V2 NWP Model Validation (Train <= {SPLIT_YEAR}, Test > {SPLIT_YEAR}) ===")
    print("=" * 80)

    # V1 historical benchmark numbers (from ml/heat_wave_prediction.py docstring)
    v1_benchmarks = {
        1: {"accuracy": 0.923, "precision": 0.632, "recall": 0.741, "f1": 0.680},
        2: {"accuracy": 0.911, "precision": 0.577, "recall": 0.741, "f1": 0.650},
        3: {"accuracy": 0.893, "precision": 0.514, "recall": 0.704, "f1": 0.590},
    }

    results = []

    for h in HORIZONS:
        feats = get_feature_list_for_horizon(h)
        target = f"TARGET_h{h}"

        sub = df.dropna(subset=feats + [target]).copy()
        train = sub[sub["YEAR"] <= SPLIT_YEAR]
        test = sub[sub["YEAR"] > SPLIT_YEAR]

        X_train, y_train = train[feats], train[target].astype(int)
        X_test, y_test = test[feats], test[target].astype(int)

        # Base RF classifier with class balancing
        base_rf = RandomForestClassifier(
            n_estimators=300,
            max_depth=7,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=42,
        )

        # Calibrated classifier for reliable probabilities
        calibrated_model = CalibratedClassifierCV(estimator=base_rf, method="sigmoid", cv=3)
        calibrated_model.fit(X_train, y_train)

        y_pred = calibrated_model.predict(X_test)
        y_prob = calibrated_model.predict_proba(X_test)[:, 1]

        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        brier = brier_score_loss(y_test, y_prob)
        pr_auc = average_precision_score(y_test, y_prob)
        cm = confusion_matrix(y_test, y_pred)
        tn, fp, fn, tp = cm.ravel()
        far = fp / (fp + tn) if (fp + tn) > 0 else 0.0  # False Alarm Rate
        miss_rate = fn / (fn + tp) if (fn + tp) > 0 else 0.0

        v1 = v1_benchmarks[h]
        print(f"\n[HORIZON +{h} DAY(S)] Test Set: N={len(y_test)}, Positives={y_test.sum()}")
        print(f"  V2 Model: Accuracy={acc:.3f} | Precision={prec:.3f} | Recall={rec:.3f} | F1={f1:.3f} | PR-AUC={pr_auc:.3f} | Brier={brier:.3f}")
        print(f"  V1 Base : Accuracy={v1['accuracy']:.3f} | Precision={v1['precision']:.3f} | Recall={v1['recall']:.3f} | F1={v1['f1']:.3f}")
        print(f"  Confusion Matrix: TP={tp}, FP={fp}, FN={fn}, TN={tn} (FAR={far:.1%}, Miss Rate={miss_rate:.1%})")

        results.append({
            "horizon": h,
            "v2_accuracy": round(acc, 4),
            "v2_precision": round(prec, 4),
            "v2_recall": round(rec, 4),
            "v2_f1": round(f1, 4),
            "v2_pr_auc": round(pr_auc, 4),
            "v2_brier": round(brier, 4),
            "v2_far": round(far, 4),
            "v2_miss_rate": round(miss_rate, 4),
            "v1_accuracy": v1["accuracy"],
            "v1_precision": v1["precision"],
            "v1_recall": v1["recall"],
            "v1_f1": v1["f1"],
        })

    comp_df = pd.DataFrame(results)
    comp_df.to_csv(COMPARISON_CSV, index=False)
    print(f"\n[OK] Comparison saved to {COMPARISON_CSV}")
    return comp_df


def train_production_models(df: pd.DataFrame):
    """Trains production models on ALL available data with probability calibration."""
    print("\n" + "=" * 80)
    print("=== Training Production V2 NWP Models on Full Dataset (2022-2026) ===")
    print("=" * 80)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    models_bundle = {
        "version": "2.0.0",
        "description": "ShadeRoute NWP Post-Processing Heatwave Model",
        "coordinates": {"lat": 20.25, "lon": 85.80},
        "horizons": {},
    }

    for h in HORIZONS:
        feats = get_feature_list_for_horizon(h)
        target = f"TARGET_h{h}"
        sub = df.dropna(subset=feats + [target]).copy()

        X = sub[feats]
        y = sub[target].astype(int)

        print(f"  Fitting production model for +{h} day horizon (N={len(y)}, HW days={y.sum()})...")
        base_rf = RandomForestClassifier(
            n_estimators=400,
            max_depth=8,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=42,
        )

        calibrated = CalibratedClassifierCV(estimator=base_rf, method="sigmoid", cv=3)
        calibrated.fit(X, y)

        models_bundle["horizons"][h] = {
            "model": calibrated,
            "features": feats,
            "train_samples": len(y),
            "train_positives": int(y.sum()),
        }

    with open(MODEL_OUTPUT_PKL, "wb") as f:
        pickle.dump(models_bundle, f)

    print(f"[OK] Production V2 model bundle saved to {MODEL_OUTPUT_PKL}")
    return models_bundle


if __name__ == "__main__":
    if not TRAINING_CSV.exists():
        print(f"[ERROR] {TRAINING_CSV} not found! Run ml/build_nwp_training_data.py first.")
        exit(1)

    df = pd.read_csv(TRAINING_CSV)
    evaluate_models(df)
    train_production_models(df)
