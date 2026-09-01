"""
heatwave_prediction_model.py
=============================
3-day-ahead heatwave prediction model for the SOA/ITER campus area
(Bhubaneswar, Odisha), trained on the ShadeRoute hourly weather dataset
(2015-01-02 to 2026-05-12).

Goal: predict whether 13, 14 and 15 May 2026 will be "heatwave days",
using only information available up to 12 May 2026 (no future data used).

METHODOLOGY (read this before the code — it's the part that matters)
----------------------------------------------------------------------
1. AGGREGATION
   Hourly records -> daily features (TMAX, TMIN, TMEAN, RH, wind, solar,
   cloud cover, dew point, precipitation, max Heat Index, max Apparent
   Temperature).

2. LABEL DEFINITION ("what counts as a heatwave day?")
   The raw data already classifies every HOUR into a Thermal_Stress
   category from the Heat Index (Safe / Moderate / High / Very High,
   where Very High = Heat Index >= 41 degC, i.e. NWS "Danger" territory).
   A day is labeled HEATWAVE_DAY = 1 if it has >= 3 hours in the
   "Very High" category (sustained dangerous heat, not just a single
   spike). This gave a positive rate of ~8.3% (345/4149 days) — rare,
   but common enough in every year of the record to learn from, unlike
   the IMD absolute-departure definition which produced only 22 events
   in 12 years (too few to model reliably).

   A climatological "normal" TMAX per calendar day is also computed
   (smoothed +/-7 day window, using ONLY 2015-2023 as the baseline, so
   the 2024-2026 evaluation years are never used to build the normal —
   this avoids leaking future information into a "historical average").

3. FEATURES (all computable from data STRICTLY BEFORE the target day)
   - Lagged TMAX / Heat Index / Very-High-hour counts (1, 2, 3, 5, 7
     days back)
   - Rolling 3/5/7-day means of TMAX and Heat Index, rolling sums of
     Very-High hours (captures "heat is building up")
   - Lag-1 humidity, wind, solar radiation, cloud cover, precipitation,
     dew point (pre-heatwave conditions are often clear, dry, low wind)
   - Trend = TMAX_lag1 - TMAX_lag7
   - Seasonal encoding (sin/cos of day-of-year, month)
   - Climatological normal TMAX for the CURRENT day and for the TARGET
     day (the target day's calendar normal is known in advance — this
     is not a leak, just calendar knowledge)

4. MODEL
   Three separate Random Forest classifiers, one per forecast horizon
   (+1, +2, +3 days ahead), each trained to predict HEATWAVE_DAY at
   day (d+h) directly from day-d features. class_weight='balanced' is
   used because positives are a minority class (~8-11%).

5. VALIDATION (this is the accuracy figure that matters, not training
   accuracy)
   Trained on 2015-2023, tested on the held-out, chronologically LATER
   2024-2025 data (true forward-in-time evaluation, not random k-fold,
   which would leak future patterns backward). Results:

       Horizon   Accuracy   Precision   Recall   F1
       +1 day     92.3%       63.2%      74.1%   0.68
       +2 days    91.1%       57.7%      74.1%   0.65
       +3 days    89.3%       51.4%      70.4%   0.59

   All three clear the 70% accuracy requirement comfortably. For
   context, a naive "always predict no heatwave" baseline scores 88.9%
   accuracy on the same test window — so accuracy alone understates how
   imbalanced this problem is. Recall (~70-74%) is the more honest
   measure of skill: the model catches roughly 3 out of 4 real heatwave
   days rather than just exploiting the class imbalance.

6. FINAL FORECAST
   The three models are RETRAINED on the full 2015 - 12 May 2026
   history (more data = better final model) and applied to the last
   available day (12 May 2026) to forecast 13, 14 and 15 May 2026.

CAVEAT
------
Air temperatures for 1-12 May 2026 ran consistently 1-3 degC BELOW the
climatological normal (no sustained Very-High heat hours since 29 Apr).
The model's rising heatwave probability across the 3-day horizon is
therefore driven mainly by seasonal climatology (mid-May is historically
Odisha's peak heatwave window) rather than a current warming trend in
the data. Treat the +3-day figure with more caution than +1-day.
"""

import json
import pickle
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix

RAW_CSV = "data/ShadeRoute_FULL_Hourly_20150102_20260512.csv"
VH_MIN_HOURS = 3          # hours of "Very High" heat index needed to call it a heatwave day
CLIMATOLOGY_YEARS = (2015, 2023)   # baseline years for the "normal" (excludes eval years)
TRAIN_TEST_SPLIT_YEAR = 2023       # train <= this year, test on the following years
HORIZONS = [1, 2, 3]


# ---------------------------------------------------------------------
# 1. Load + aggregate hourly -> daily
# ---------------------------------------------------------------------
def build_daily(raw_csv: str) -> pd.DataFrame:
    df = pd.read_csv(raw_csv)
    df["DateTime_LST"] = pd.to_datetime(df["DateTime_LST"])
    df["DATE"] = df["DateTime_LST"].dt.date

    daily = df.groupby("DATE").agg(
        TMAX=("Air_Temperature_C", "max"),
        TMIN=("Air_Temperature_C", "min"),
        TMEAN=("Air_Temperature_C", "mean"),
        RH_MEAN=("Relative_Humidity_pct", "mean"),
        WS_MEAN=("Wind_Speed_m_s", "mean"),
        SOLAR_SUM=("Solar_Radiation", "sum"),
        CLOUD_MEAN=("Cloud_Cover_pct", "mean"),
        DEWPT_MEAN=("Dew_Point_C", "mean"),
        HEATIDX_MAX=("Heat_Index_C", "max"),
        APPTEMP_MAX=("Apparent_Temperature_C", "max"),
        PRECIP_SUM=("PRECTOTCORR", "sum"),
    ).reset_index()
    daily["DATE"] = pd.to_datetime(daily["DATE"])
    daily = daily.sort_values("DATE").reset_index(drop=True)
    daily["YEAR"] = daily["DATE"].dt.year
    daily["DOY"] = daily["DATE"].dt.dayofyear

    vh_hours = (
        df.groupby("DATE")
        .apply(lambda g: (g["Thermal_Stress"] == "Very High").sum())
        .reset_index(name="VH_HOURS")
    )
    vh_hours["DATE"] = pd.to_datetime(vh_hours["DATE"])
    daily = daily.merge(vh_hours, on="DATE", how="left")
    daily["HEATWAVE_DAY"] = (daily["VH_HOURS"] >= VH_MIN_HOURS).astype(int)
    return daily


# ---------------------------------------------------------------------
# 2. Climatological normal (per day-of-year, smoothed, baseline-years only)
# ---------------------------------------------------------------------
def add_climatology(daily: pd.DataFrame) -> pd.DataFrame:
    base = daily[daily["YEAR"].between(*CLIMATOLOGY_YEARS)]
    doy_all = np.arange(1, 367)
    tmax_by_doy = base.groupby("DOY")["TMAX"].mean().reindex(doy_all).interpolate().bfill().ffill()

    def circular_smooth(series, window=7):
        vals = series.values
        n = len(vals)
        return pd.Series(
            [np.nanmean(vals[[(i + k) % n for k in range(-window, window + 1)]]) for i in range(n)],
            index=series.index,
        )

    normal = circular_smooth(tmax_by_doy, window=7)
    daily["TMAX_NORMAL"] = daily["DOY"].map(normal)
    daily["DEPARTURE"] = daily["TMAX"] - daily["TMAX_NORMAL"]
    return daily, normal


# ---------------------------------------------------------------------
# 3. Feature engineering
# ---------------------------------------------------------------------
def add_features(daily: pd.DataFrame):
    for lag in [1, 2, 3, 5, 7]:
        daily[f"TMAX_lag{lag}"] = daily["TMAX"].shift(lag)
        daily[f"HEATIDX_lag{lag}"] = daily["HEATIDX_MAX"].shift(lag)
        daily[f"VH_HOURS_lag{lag}"] = daily["VH_HOURS"].shift(lag)

    daily["RH_lag1"] = daily["RH_MEAN"].shift(1)
    daily["WS_lag1"] = daily["WS_MEAN"].shift(1)
    daily["SOLAR_lag1"] = daily["SOLAR_SUM"].shift(1)
    daily["CLOUD_lag1"] = daily["CLOUD_MEAN"].shift(1)
    daily["PRECIP_lag1"] = daily["PRECIP_SUM"].shift(1)
    daily["DEWPT_lag1"] = daily["DEWPT_MEAN"].shift(1)

    daily["TMAX_roll3"] = daily["TMAX"].shift(1).rolling(3).mean()
    daily["TMAX_roll5"] = daily["TMAX"].shift(1).rolling(5).mean()
    daily["TMAX_roll7"] = daily["TMAX"].shift(1).rolling(7).mean()
    daily["HEATIDX_roll3"] = daily["HEATIDX_MAX"].shift(1).rolling(3).max()
    daily["VH_roll3"] = daily["VH_HOURS"].shift(1).rolling(3).sum()
    daily["VH_roll7"] = daily["VH_HOURS"].shift(1).rolling(7).sum()
    daily["TMAX_trend"] = daily["TMAX_lag1"] - daily["TMAX_lag7"]

    daily["DOY_sin"] = np.sin(2 * np.pi * daily["DOY"] / 365.25)
    daily["DOY_cos"] = np.cos(2 * np.pi * daily["DOY"] / 365.25)
    daily["MONTH"] = daily["DATE"].dt.month
    daily["DEPARTURE_lag1"] = daily["TMAX_lag1"] - daily["TMAX_NORMAL"].shift(1)

    base_features = [c for c in daily.columns if (
        c.endswith(("_lag1", "_lag2", "_lag3", "_lag5", "_lag7")) or
        c.startswith("TMAX_roll")
    )] + ["HEATIDX_roll3", "VH_roll3", "VH_roll7", "TMAX_trend",
          "DOY_sin", "DOY_cos", "MONTH", "TMAX_NORMAL"]
    # de-duplicate while preserving order (DEPARTURE_lag1 already matched by the
    # "_lag1" suffix filter above, so the explicit list must not repeat it)
    base_features = list(dict.fromkeys(base_features))

    for h in HORIZONS:
        daily[f"TARGET_h{h}"] = daily["HEATWAVE_DAY"].shift(-h)
        daily[f"TMAX_NORMAL_target_h{h}"] = daily["TMAX_NORMAL"].shift(-h)
        daily[f"DOY_sin_target_h{h}"] = daily["DOY_sin"].shift(-h)
        daily[f"DOY_cos_target_h{h}"] = daily["DOY_cos"].shift(-h)

    return daily, base_features


# ---------------------------------------------------------------------
# 4. Train + time-based validation (train <= split year, test after)
# ---------------------------------------------------------------------
def validate(daily: pd.DataFrame, base_features):
    """Fits each horizon's model on train-only data and scores it on BOTH
    the training set and the held-out test set, so the gap between the two
    (the true measure of overfitting) can be reported and plotted."""
    print("=== Out-of-sample validation (train <= %d, test after) ===" % TRAIN_TEST_SPLIT_YEAR)
    rows = []
    for h in HORIZONS:
        feats = base_features + [f"TMAX_NORMAL_target_h{h}", f"DOY_sin_target_h{h}", f"DOY_cos_target_h{h}"]
        sub = daily.dropna(subset=feats + [f"TARGET_h{h}"])
        train = sub[sub["YEAR"] <= TRAIN_TEST_SPLIT_YEAR]
        test = sub[sub["YEAR"] > TRAIN_TEST_SPLIT_YEAR]

        clf = RandomForestClassifier(n_estimators=400, max_depth=8, min_samples_leaf=3,
                                      class_weight="balanced", random_state=42)
        clf.fit(train[feats], train[f"TARGET_h{h}"])

        for split_name, X, y in [("train", train[feats], train[f"TARGET_h{h}"]),
                                  ("test", test[feats], test[f"TARGET_h{h}"])]:
            pred = clf.predict(X)
            rows.append(dict(
                horizon=h, split=split_name, n=len(y), positives=int(y.sum()),
                accuracy=accuracy_score(y, pred),
                precision=precision_score(y, pred, zero_division=0),
                recall=recall_score(y, pred, zero_division=0),
                f1=f1_score(y, pred, zero_division=0),
                error_rate=1 - accuracy_score(y, pred),
            ))

        y_test = test[f"TARGET_h{h}"]
        test_pred = clf.predict(test[feats])
        print(f"\n-- Horizon +{h} day(s) -- n_test={len(y_test)}, positives={int(y_test.sum())}")
        print(f"Accuracy={accuracy_score(y_test, test_pred):.3f}  "
              f"Precision={precision_score(y_test, test_pred, zero_division=0):.3f}  "
              f"Recall={recall_score(y_test, test_pred, zero_division=0):.3f}  "
              f"F1={f1_score(y_test, test_pred, zero_division=0):.3f}")
        print("Confusion matrix [[TN FP][FN TP]]:\n", confusion_matrix(y_test, test_pred))

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------
# 4b. Matplotlib performance graph (train vs. test, per horizon)
# ---------------------------------------------------------------------
def plot_performance(metrics: pd.DataFrame, out_path: str = "model_performance.png"):
    """Draws a 2-panel matplotlib figure: error rate (left) and F1 score
    (right), train vs. test, grouped by forecast horizon. This is the
    'true' performance check — training-set numbers alone are optimistic,
    so both are shown side by side."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    horizons = sorted(metrics["horizon"].unique())
    x = np.arange(len(horizons))
    width = 0.32

    train = metrics[metrics["split"] == "train"].set_index("horizon")
    test = metrics[metrics["split"] == "test"].set_index("horizon")

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))

    # -- Panel 1: error rate --
    ax = axes[0]
    ax.bar(x - width / 2, train.loc[horizons, "error_rate"] * 100, width, label="Train", color="#4C72B0")
    ax.bar(x + width / 2, test.loc[horizons, "error_rate"] * 100, width, label="Test", color="#DD8452")
    for i, h in enumerate(horizons):
        ax.text(i - width / 2, train.loc[h, "error_rate"] * 100 + 0.3,
                 f"{train.loc[h, 'error_rate']*100:.1f}%", ha="center", fontsize=9)
        ax.text(i + width / 2, test.loc[h, "error_rate"] * 100 + 0.3,
                 f"{test.loc[h, 'error_rate']*100:.1f}%", ha="center", fontsize=9)
    ax.set_xticks(x)
    ax.set_xticklabels([f"+{h} day{'s' if h > 1 else ''}" for h in horizons])
    ax.set_ylabel("Error rate (%)")
    ax.set_title("Error rate: train vs. test")
    ax.axhline(30, color="grey", linestyle="--", linewidth=1, label="70% accuracy line")
    ax.legend(fontsize=9)
    ax.set_ylim(0, max(test["error_rate"].max() * 100 * 1.6, 35))

    # -- Panel 2: F1 score --
    ax = axes[1]
    ax.bar(x - width / 2, train.loc[horizons, "f1"], width, label="Train", color="#4C72B0")
    ax.bar(x + width / 2, test.loc[horizons, "f1"], width, label="Test", color="#DD8452")
    for i, h in enumerate(horizons):
        ax.text(i - width / 2, train.loc[h, "f1"] + 0.015, f"{train.loc[h, 'f1']:.2f}", ha="center", fontsize=9)
        ax.text(i + width / 2, test.loc[h, "f1"] + 0.015, f"{test.loc[h, 'f1']:.2f}", ha="center", fontsize=9)
    ax.set_xticks(x)
    ax.set_xticklabels([f"+{h} day{'s' if h > 1 else ''}" for h in horizons])
    ax.set_ylabel("F1 score (heatwave class)")
    ax.set_title("F1 score: train vs. test")
    ax.set_ylim(0, 1)
    ax.legend(fontsize=9)

    fig.suptitle("Heatwave model performance — training set vs. held-out test set (2024-2025)", fontsize=12)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"\nSaved performance graph to {out_path}")


# ---------------------------------------------------------------------
# 5. Final production models (trained on ALL history) + forecast
# ---------------------------------------------------------------------
def forecast(daily: pd.DataFrame, base_features):
    last_row = daily.iloc[-1:]
    print("\n=== Final forecast (models retrained on full history through %s) ===" %
          last_row["DATE"].values[0])

    normal_by_doy = daily.set_index("DOY")["TMAX_NORMAL"].groupby(level=0).first()
    predictions = {}

    for h in HORIZONS:
        feats = base_features + [f"TMAX_NORMAL_target_h{h}", f"DOY_sin_target_h{h}", f"DOY_cos_target_h{h}"]
        sub = daily.dropna(subset=feats + [f"TARGET_h{h}"])
        clf = RandomForestClassifier(n_estimators=500, max_depth=8, min_samples_leaf=3,
                                      class_weight="balanced", random_state=42)
        clf.fit(sub[feats], sub[f"TARGET_h{h}"])

        row = last_row[base_features].copy()
        target_date = pd.Timestamp(last_row["DATE"].values[0]) + pd.Timedelta(days=h)
        target_doy = target_date.dayofyear
        row[f"TMAX_NORMAL_target_h{h}"] = normal_by_doy.get(target_doy, np.nan)
        row[f"DOY_sin_target_h{h}"] = np.sin(2 * np.pi * target_doy / 365.25)
        row[f"DOY_cos_target_h{h}"] = np.cos(2 * np.pi * target_doy / 365.25)

        proba = clf.predict_proba(row[feats])[0][1]
        predictions[str(target_date.date())] = {
            "probability_of_heatwave": round(float(proba), 3),
            "prediction": "HEATWAVE" if proba >= 0.5 else "No heatwave",
        }
        print(f"{target_date.date()}: P(heatwave)={proba:.3f} -> "
              f"{'HEATWAVE' if proba >= 0.5 else 'No heatwave'}")

    return predictions


if __name__ == "__main__":
    daily = build_daily(RAW_CSV)
    daily, normal = add_climatology(daily)
    daily, base_features = add_features(daily)

    metrics = validate(daily, base_features)
    plot_performance(metrics, out_path="model_performance.png")
    predictions = forecast(daily, base_features)

    metrics.to_csv("train_test_performance.csv", index=False)
    with open("predictions_may2026.json", "w") as f:
        json.dump(predictions, f, indent=2)
    print("Saved train_test_performance.csv and predictions_may2026.json")