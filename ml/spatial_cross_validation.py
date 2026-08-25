from pathlib import Path

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

from sklearn.model_selection import GroupKFold


# ============================================================
# PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATA_PATH = (
    PROJECT_ROOT
    / "data"
    / "SOA_ITER_ML_10m_Dataset_2026.csv"
)

OUTPUT_DIR = (
    PROJECT_ROOT
    / "ml"
    / "outputs"
)

OUTPUT_DIR.mkdir(
    parents=True,
    exist_ok=True
)


# ============================================================
# LOAD DATA
# ============================================================

print("=" * 70)
print("SOA ITER — SPATIAL CROSS-VALIDATION")
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
# CREATE SPATIAL BLOCKS
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

groups = df["spatial_block"]


print("\nSpatial blocks:")
print(groups.nunique())


# ============================================================
# MODELS
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
# SPATIAL CROSS-VALIDATION
# ============================================================

N_SPLITS = 5

cv = GroupKFold(
    n_splits=N_SPLITS
)


all_results = []


for model_name, model in models.items():

    print("\n" + "=" * 70)
    print(model_name)
    print("=" * 70)

    fold_results = []

    for fold, (train_idx, test_idx) in enumerate(
        cv.split(
            X,
            y,
            groups=groups
        ),
        start=1
    ):

        X_train = X.iloc[train_idx]
        X_test = X.iloc[test_idx]

        y_train = y.iloc[train_idx]
        y_test = y.iloc[test_idx]

        print(
            f"\nFold {fold}: "
            f"{len(train_idx)} train / "
            f"{len(test_idx)} validation"
        )

        model.fit(
            X_train,
            y_train
        )

        predictions = model.predict(
            X_test
        )

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

        print(
            f"MAE={mae:.4f} | "
            f"RMSE={rmse:.4f} | "
            f"R²={r2:.4f}"
        )

        fold_results.append({
            "model": model_name,
            "fold": fold,
            "MAE": mae,
            "RMSE": rmse,
            "R2": r2
        })

        all_results.append(
            fold_results[-1]
        )


# ============================================================
# SAVE FOLD RESULTS
# ============================================================

fold_df = pd.DataFrame(
    all_results
)

fold_path = (
    OUTPUT_DIR
    / "spatial_cv_fold_results.csv"
)

fold_df.to_csv(
    fold_path,
    index=False
)


# ============================================================
# SUMMARY
# ============================================================

summary = (
    fold_df
    .groupby("model")
    .agg(
        MAE_mean=("MAE", "mean"),
        MAE_std=("MAE", "std"),

        RMSE_mean=("RMSE", "mean"),
        RMSE_std=("RMSE", "std"),

        R2_mean=("R2", "mean"),
        R2_std=("R2", "std")
    )
    .reset_index()
)


# Sort primarily by R², then RMSE
summary = summary.sort_values(
    ["R2_mean", "RMSE_mean"],
    ascending=[False, True]
)


# ============================================================
# PRINT SUMMARY
# ============================================================

print("\n" + "=" * 70)
print("5-FOLD SPATIAL CROSS-VALIDATION SUMMARY")
print("=" * 70)

print(
    summary.to_string(
        index=False,
        float_format=lambda x: f"{x:.4f}"
    )
)


# ============================================================
# SAVE SUMMARY
# ============================================================

summary_path = (
    OUTPUT_DIR
    / "spatial_cv_summary.csv"
)

summary.to_csv(
    summary_path,
    index=False
)


# ============================================================
# BEST MODEL
# ============================================================

best_model = summary.iloc[0]

print("\n" + "=" * 70)
print("CURRENT BEST MODEL")
print("=" * 70)

print(
    best_model["model"]
)

print(
    f"Mean MAE : "
    f"{best_model['MAE_mean']:.4f} "
    f"± {best_model['MAE_std']:.4f}"
)

print(
    f"Mean RMSE: "
    f"{best_model['RMSE_mean']:.4f} "
    f"± {best_model['RMSE_std']:.4f}"
)

print(
    f"Mean R²  : "
    f"{best_model['R2_mean']:.4f} "
    f"± {best_model['R2_std']:.4f}"
)


print("\nSaved:")
print(fold_path)
print(summary_path)

print("\nSpatial cross-validation complete.")