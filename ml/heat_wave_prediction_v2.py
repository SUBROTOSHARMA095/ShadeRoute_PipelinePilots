"""
heat_wave_prediction_v2.py
==========================
V2 NWP Multi-Horizon Ensemble Machine Learning Model for ShadeRoute.

Predicts same-day nowcast (H0) and 1-day (H1), 2-day (H2), and 3-day (H3) ahead
heatwave probability for the SOA ITER campus (Bhubaneswar, Odisha) by combining:
1. Live/Forecasted NWP variables (Temperature, Apparent Temperature / Heat Index,
   RH, Dew Point, Radiation, Wind, Precipitation, Atmospheric Pressure, CAPE,
   Cloud Cover, Pressure Tendencies)
2. Recent ground observations & lagged thermal history (lags 1-7d, rolling 3-7d)
3. Synoptic barometric drop & convective storm proxy indicators
4. Calendar seasonality (diurnal solar geometry encoding)

Persists calibrated ensemble models (RandomForest + HistGradientBoosting soft voting)
to `ml/models/nwp_heatwave_v2.pkl`.
"""

import os
import json
import pickle
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier, VotingClassifier
from sklearn.model_selection import StratifiedKFold
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    brier_score_loss,
    roc_auc_score,
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
HORIZONS = [0, 1, 2, 3]  # H0=Nowcast (Today), H1=+1d, H2=+2d, H3=+3d


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
        f"forecast_apptemp_max_target_h{h}",
        f"forecast_dewpt_mean_target_h{h}",
        f"forecast_radiation_sum_target_h{h}",
        f"forecast_rh_min_target_h{h}",
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


def build_ensemble_model():
    """Builds a balanced VotingClassifier combining Random Forest and HistGradientBoosting."""
    rf = RandomForestClassifier(
        n_estimators=350,
        max_depth=8,
        min_samples_leaf=3,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    hgb = HistGradientBoostingClassifier(
        max_iter=150,
        max_depth=5,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
    )
    return VotingClassifier(
        estimators=[("rf", rf), ("hgb", hgb)],
        voting="soft",
        weights=[0.55, 0.45],
    )


def evaluate_models(df: pd.DataFrame):
    """Run temporal out-of-sample evaluation on held-out 2025-2026 data."""
    print("=" * 80)
    print(f"=== Multi-Horizon NWP Model Validation (Train <= {SPLIT_YEAR}, Test > {SPLIT_YEAR}) ===")
    print("=" * 80)

    results = []
    thresholds = {}

    for h in HORIZONS:
        feats = get_feature_list_for_horizon(h)
        target = f"TARGET_h{h}"

        sub = df.dropna(subset=feats + [target]).copy()
        train = sub[sub["YEAR"] <= SPLIT_YEAR]
        test = sub[sub["YEAR"] > SPLIT_YEAR]

        X_train, y_train = train[feats], train[target].astype(int)
        X_test, y_test = test[feats], test[target].astype(int)

        # 3-Fold Cross-Validation on Train to select optimal decision threshold (strictly on training folds)
        skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
        oof_probs = np.zeros(len(y_train))
        for tr_idx, val_idx in skf.split(X_train, y_train):
            m_fold = build_ensemble_model()
            m_fold.fit(X_train.iloc[tr_idx], y_train.iloc[tr_idx])
            oof_probs[val_idx] = m_fold.predict_proba(X_train.iloc[val_idx])[:, 1]

        best_th, best_train_f1 = 0.40, 0.0
        for th in np.linspace(0.20, 0.60, 41):
            f = f1_score(y_train, (oof_probs >= th).astype(int), zero_division=0)
            if f > best_train_f1:
                best_train_f1 = f
                best_th = float(th)

        thresholds[h] = best_th

        # Fit model on full training set
        model = build_ensemble_model()
        model.fit(X_train, y_train)

        y_prob = model.predict_proba(X_test)[:, 1]
        y_pred = (y_prob >= best_th).astype(int)

        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        roc_auc = roc_auc_score(y_test, y_prob)
        pr_auc = average_precision_score(y_test, y_prob)
        brier = brier_score_loss(y_test, y_prob)

        cm = confusion_matrix(y_test, y_pred)
        tn, fp, fn, tp = cm.ravel()
        far = fp / (fp + tn) if (fp + tn) > 0 else 0.0
        miss_rate = fn / (fn + tp) if (fn + tp) > 0 else 0.0

        lead_label = "NOWCAST (Same Day)" if h == 0 else f"+{h} DAY(S) AHEAD"
        print(f"\n[HORIZON H{h}: {lead_label}] Test Set: N={len(y_test)}, Positives={y_test.sum()} (Optimal Thresh={best_th:.2f})")
        print(f"  Ensemble Model: Accuracy={acc:.3f} | ROC-AUC={roc_auc:.3f} | Precision={prec:.3f} | Recall={rec:.3f} | F1={f1:.3f} | PR-AUC={pr_auc:.3f} | Brier={brier:.3f}")
        print(f"  Confusion Matrix: TP={tp}, FP={fp}, FN={fn}, TN={tn} (FAR={far:.1%}, Miss Rate={miss_rate:.1%})")

        results.append({
            "horizon": h,
            "horizon_label": "H0_Nowcast" if h == 0 else f"H{h}_Forecast",
            "optimal_threshold": round(best_th, 2),
            "v2_accuracy": round(acc, 4),
            "v2_roc_auc": round(roc_auc, 4),
            "v2_precision": round(prec, 4),
            "v2_recall": round(rec, 4),
            "v2_f1": round(f1, 4),
            "v2_pr_auc": round(pr_auc, 4),
            "v2_brier": round(brier, 4),
            "v2_far": round(far, 4),
            "v2_miss_rate": round(miss_rate, 4),
            "evaluation_scope": "temporal holdout validation (Train <= 2024, Test 2025-2026)",
        })

    comp_df = pd.DataFrame(results)
    comp_df.to_csv(COMPARISON_CSV, index=False)
    print(f"\n[OK] Comparison saved to {COMPARISON_CSV}")
    return comp_df, thresholds


def train_production_models(df: pd.DataFrame, thresholds: dict):
    """Trains production models on ALL available data (2022-2026) and saves bundle."""
    print("\n" + "=" * 80)
    print("=== Training Production NWP Models on Full Dataset (2022-2026) ===")
    print("=" * 80)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    models_bundle = {
        "version": "2.2.0",
        "description": "ShadeRoute Calibrated NWP Multi-Horizon Heatwave Ensemble Model",
        "validation_status": "temporal holdout validated (2025-2026 test set)",
        "coordinates": {"lat": 20.25, "lon": 85.80},
        "horizons": {},
    }

    for h in HORIZONS:
        feats = get_feature_list_for_horizon(h)
        target = f"TARGET_h{h}"
        sub = df.dropna(subset=feats + [target]).copy()

        X = sub[feats]
        y = sub[target].astype(int)

        lead_label = "Nowcast (Same-Day)" if h == 0 else f"+{h}d Ahead"
        print(f"  Fitting production ensemble for Horizon H{h} ({lead_label}) [N={len(y)}, HW days={y.sum()}]...")
        model = build_ensemble_model()
        model.fit(X, y)

        models_bundle["horizons"][h] = {
            "model": model,
            "features": feats,
            "feature_medians": {name: float(X[name].median()) for name in feats},
            "optimal_threshold": thresholds.get(h, 0.40),
            "train_samples": len(y),
            "train_positives": int(y.sum()),
        }

    with open(MODEL_OUTPUT_PKL, "wb") as f:
        pickle.dump(models_bundle, f)

    print(f"[OK] Production model bundle saved to {MODEL_OUTPUT_PKL}")
    return models_bundle


if __name__ == "__main__":
    if not TRAINING_CSV.exists():
        print(f"[ERROR] {TRAINING_CSV} not found! Run ml/build_nwp_training_data.py first.")
        exit(1)

    df = pd.read_csv(TRAINING_CSV)
    comp_df, thresholds = evaluate_models(df)
    train_production_models(df, thresholds)
