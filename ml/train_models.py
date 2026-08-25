from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from sklearn.ensemble import (
    RandomForestRegressor,
    ExtraTreesRegressor,
    GradientBoostingRegressor
)

from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    r2_score
)


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

MODEL_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# LOAD DATA
# ============================================================

print("=" * 70)
print("SOA ITER — SPATIAL ML MODEL BENCHMARK")
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

X = df[FEATURES].copy()
y = df[TARGET].copy()


# ============================================================
# CREATE SPATIAL BLOCKS
# ============================================================
#
# We do NOT randomly split individual pixels.
#
# Neighboring 10 m pixels are highly correlated.
# Spatial blocks give us a more realistic validation.
#
# ~0.00045 degrees is approximately 50 m around this latitude.
#
# ============================================================

BLOCK_SIZE = 0.00045

df["block_x"] = np.floor(
    df["longitude"] / BLOCK_SIZE
)

df["block_y"] = np.floor(
    df["latitude"] / BLOCK_SIZE
)

df["spatial_block"] = (
    df["block_x"].astype(str)
    + "_"
    + df["block_y"].astype(str)
)


# ============================================================
# LIST SPATIAL BLOCKS
# ============================================================

blocks = df["spatial_block"].unique().to_numpy()

print("\nNumber of spatial blocks:")
print(len(blocks))


# ============================================================
# DETERMINISTIC SPATIAL SPLIT
# ============================================================

rng = np.random.default_rng(2026)

rng.shuffle(blocks)

test_fraction = 0.25

test_count = max(
    1,
    int(len(blocks) * test_fraction)
)

test_blocks = set(
    blocks[:test_count]
)

train_blocks = set(
    blocks[test_count:]
)


train_mask = df["spatial_block"].isin(
    train_blocks
)

test_mask = df["spatial_block"].isin(
    test_blocks
)


X_train = df.loc[
    train_mask,
    FEATURES
]

y_train = df.loc[
    train_mask,
    TARGET
]

X_test = df.loc[
    test_mask,
    FEATURES
]

y_test = df.loc[
    test_mask,
    TARGET
]


print("\nTraining samples:")
print(len(X_train))

print("\nValidation samples:")
print(len(X_test))

print("\nTraining blocks:")
print(len(train_blocks))

print("\nValidation blocks:")
print(len(test_blocks))


# ============================================================
# MODEL DEFINITIONS
# ============================================================

models = {

    "Random Forest": RandomForestRegressor(
        n_estimators=300,
        max_features="sqrt",
        min_samples_leaf=2,
        random_state=2026,
        n_jobs=-1
    ),

    "Extra Trees": ExtraTreesRegressor(
        n_estimators=300,
        max_features="sqrt",
        min_samples_leaf=2,
        random_state=2026,
        n_jobs=-1
    ),

    "Gradient Boosting": GradientBoostingRegressor(
        n_estimators=300,
        learning_rate=0.03,
        max_depth=3,
        min_samples_leaf=3,
        random_state=2026
    )
}


# ============================================================
# TRAIN + EVALUATE
# ============================================================

results = []

trained_models = {}


for name, model in models.items():

    print("\n" + "-" * 70)
    print("Training:", name)
    print("-" * 70)

    model.fit(
        X_train,
        y_train
    )

    predictions = model.predict(
        X_test
    )

    # Vegetation fraction is physically bounded 0–1.
    predictions = np.clip(
        predictions,
        0,
        1
    )

    mae = mean_absolute_error(
        y_test,
        predictions
    )

    rmse = np.sqrt(
        mean_squared_error(
            y_test,
            predictions
        )
    )

    r2 = r2_score(
        y_test,
        predictions
    )

    print("MAE :", mae)
    print("RMSE:", rmse)
    print("R²  :", r2)

    results.append({

        "model": name,
        "MAE": mae,
        "RMSE": rmse,
        "R2": r2

    })

    trained_models[name] = model


# ============================================================
# MODEL COMPARISON
# ============================================================

results_df = pd.DataFrame(
    results
)

results_df = results_df.sort_values(
    "RMSE"
)

print("\n" + "=" * 70)
print("MODEL COMPARISON")
print("=" * 70)

print(
    results_df.to_string(
        index=False
    )
)


# ============================================================
# SAVE RESULTS
# ============================================================

results_path = (
    OUTPUT_DIR
    / "model_comparison.csv"
)

results_df.to_csv(
    results_path,
    index=False
)


# ============================================================
# SELECT BEST MODEL
# ============================================================

best_model_name = (
    results_df
    .iloc[0]["model"]
)

best_model = trained_models[
    best_model_name
]


print("\nBest model:")
print(best_model_name)


# ============================================================
# SAVE BEST MODEL
# ============================================================

model_filename = (
    best_model_name
    .lower()
    .replace(" ", "_")
    + "_vegetation_fraction_2026.joblib"
)

model_path = (
    MODEL_DIR
    / model_filename
)

joblib.dump(
    best_model,
    model_path
)


print("\nSaved best model:")
print(model_path)


# ============================================================
# FEATURE IMPORTANCE
# ============================================================

if hasattr(
    best_model,
    "feature_importances_"
):

    importance = pd.DataFrame({

        "feature": FEATURES,

        "importance":
            best_model.feature_importances_

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

    importance.to_csv(
        OUTPUT_DIR
        / "feature_importance.csv",
        index=False
    )


# ============================================================
# SAVE TEST PREDICTIONS
# ============================================================

test_results = df.loc[
    test_mask,
    [
        "longitude",
        "latitude",
        *FEATURES,
        TARGET
    ]
].copy()

test_results[
    "predicted_vegetation_fraction"
] = np.clip(
    best_model.predict(X_test),
    0,
    1
)

test_results[
    "prediction_error"
] = (
    test_results[
        "predicted_vegetation_fraction"
    ]
    -
    test_results[TARGET]
)

test_results.to_csv(
    OUTPUT_DIR
    / "spatial_test_predictions.csv",
    index=False
)


print("\nSaved:")
print(
    OUTPUT_DIR
    / "spatial_test_predictions.csv"
)

print("\nML benchmark complete.")