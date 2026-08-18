from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from sklearn.ensemble import ExtraTreesRegressor


# ============================================================
# PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATA_PATH = (
    PROJECT_ROOT
    / "data"
    / "SOA_ITER_ML_10m_Dataset_2026.csv"
)

MODEL_DIR = PROJECT_ROOT / "ml" / "models"
OUTPUT_DIR = PROJECT_ROOT / "ml" / "outputs"

MODEL_DIR.mkdir(
    parents=True,
    exist_ok=True
)

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True
)


# ============================================================
# LOAD DATA
# ============================================================

print("=" * 70)
print("SOA ITER — FINAL VEGETATION FRACTION MODEL")
print("=" * 70)

df = pd.read_csv(DATA_PATH)

print("\nDataset:")
print(df.shape)


# ============================================================
# FEATURES / TARGET
# ============================================================

FEATURES = [
    "NDVI",
    "NDBI",
    "BSI",
    "NDWI",
    "LST"
]

TARGET = "vegetation_fraction"

X = df[FEATURES]
y = df[TARGET]


# ============================================================
# FINAL MODEL
# ============================================================
#
# Hyperparameters were selected from the previous benchmark.
#
# We now train on ALL 1,323 samples because spatial
# cross-validation has already been used to estimate
# generalization performance.
#
# ============================================================

model = ExtraTreesRegressor(
    n_estimators=500,
    max_features="sqrt",
    min_samples_leaf=2,
    random_state=2026,
    n_jobs=-1
)


print("\nTraining final Extra Trees model...")
print("Training samples:", len(X))
print("Features:", FEATURES)


model.fit(
    X,
    y
)


# ============================================================
# TRAINING PREDICTIONS
# ============================================================

predictions = model.predict(X)

predictions = np.clip(
    predictions,
    0,
    1
)


# ============================================================
# FEATURE IMPORTANCE
# ============================================================

importance = pd.DataFrame({
    "feature": FEATURES,
    "importance": model.feature_importances_
})

importance = importance.sort_values(
    "importance",
    ascending=False
)

print("\nFeature importance:")
print(
    importance.to_string(
        index=False
    )
)


# ============================================================
# SAVE FEATURE IMPORTANCE
# ============================================================

importance.to_csv(
    OUTPUT_DIR / "final_feature_importance.csv",
    index=False
)


# ============================================================
# SAVE MODEL
# ============================================================

MODEL_PATH = (
    MODEL_DIR
    / "extra_trees_vegetation_fraction_2026_final.joblib"
)

joblib.dump(
    model,
    MODEL_PATH
)


# ============================================================
# SAVE FULL DATA WITH PREDICTIONS
# ============================================================

prediction_df = df[
    [
        "longitude",
        "latitude",
        *FEATURES,
        TARGET
    ]
].copy()

prediction_df[
    "predicted_vegetation_fraction"
] = predictions

prediction_df[
    "prediction_difference"
] = (
    prediction_df[
        "predicted_vegetation_fraction"
    ]
    -
    prediction_df[TARGET]
)


prediction_df.to_csv(
    OUTPUT_DIR
    / "final_model_predictions_2026.csv",
    index=False
)


# ============================================================
# SUMMARY
# ============================================================

print("\n" + "=" * 70)
print("FINAL MODEL COMPLETE")
print("=" * 70)

print("\nModel:")
print("Extra Trees Regressor")

print("\nTraining samples:")
print(len(X))

print("\nNumber of trees:")
print(model.n_estimators)

print("\nSaved model:")
print(MODEL_PATH)

print("\nSaved predictions:")
print(
    OUTPUT_DIR
    / "final_model_predictions_2026.csv"
)

print("\nSaved feature importance:")
print(
    OUTPUT_DIR
    / "final_feature_importance.csv"
)

print("\nIMPORTANT:")
print(
    "The model's reported generalization performance comes "
    "from the previous 5-fold spatial cross-validation."
)

print("\nFinal training complete.")