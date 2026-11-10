"""Train the insurance cost models and export them for the website.

Run:  pip install -r training/requirements.txt && python training/train.py
Writes public/data/model.json (coefficients + metrics) and public/data/dataset.json
(the cleaned records used by the charts and the "people like you" panel).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold, cross_val_predict, train_test_split

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

df = pd.read_csv(HERE / "insurance_cleaned.csv")
for c in ["region_northwest", "region_southeast", "region_southwest"]:
    df[c] = df[c].astype(int)

BASE = ["age", "sex", "bmi", "children", "smoker",
        "region_northwest", "region_southeast", "region_southwest"]


def engineer(X: pd.DataFrame) -> pd.DataFrame:
    """Features that let a linear model capture the smoker x obesity effect."""
    X = X[BASE].astype(float).copy()
    X["age_sq"] = X["age"] ** 2
    X["obese"] = (X["bmi"] >= 30).astype(float)
    X["smoker_obese"] = X["smoker"] * X["obese"]
    X["smoker_bmi"] = X["smoker"] * X["bmi"]
    return X


y = df["charges"]
X_tr, X_te, y_tr, y_te = train_test_split(df[BASE], y, test_size=0.2, random_state=42)


def metrics(y_true, y_pred):
    mse = mean_squared_error(y_true, y_pred)
    return {"r2": r2_score(y_true, y_pred), "mae": mean_absolute_error(y_true, y_pred),
            "rmse": float(np.sqrt(mse)), "mse": mse}


models = {}
for name, fx in [("baseline", lambda X: X[BASE].astype(float)), ("enhanced", engineer)]:
    m = LinearRegression().fit(fx(X_tr), y_tr)
    pred = m.predict(fx(X_te))
    # Out-of-fold residuals on all data give an honest "likely range" band.
    oof = cross_val_predict(LinearRegression(), fx(df), y, cv=KFold(5, shuffle=True, random_state=42))
    resid = (y - oof).to_numpy()
    models[name] = {
        "intercept": float(m.intercept_),
        "coef": {k: float(v) for k, v in zip(fx(X_tr).columns, m.coef_)},
        "metrics": {k: float(v) for k, v in metrics(y_te, pred).items()},
        # Residuals are skewed (a small group pays far more than any feature explains),
        # so the band always contains the estimate and the tail is reported separately.
        "residualBand": {"low": float(min(np.percentile(resid, 10), 0)),
                         "high": float(max(np.percentile(resid, 90), 0)),
                         "tailShare": float(np.mean(resid > 5000))},
        "testPairs": [[round(float(a), 2), round(float(b), 2)] for a, b in zip(y_te, pred)],
    }

json.dump({"models": models, "trainedOn": int(len(df)),
           "correlation": {k: float(v) for k, v in df[BASE + ["charges"]].corr()["charges"].drop("charges").items()}},
          open(OUT / "model.json", "w"), indent=1)

region = np.select([df.region_northwest == 1, df.region_southeast == 1, df.region_southwest == 1],
                   ["northwest", "southeast", "southwest"], "northeast")
records = [[int(a), int(s), float(b), int(c), int(k), str(r), round(float(ch), 2)]
           for a, s, b, c, k, r, ch in zip(df.age, df.sex, df.bmi, df.children, df.smoker, region, df.charges)]
json.dump({"columns": ["age", "sex", "bmi", "children", "smoker", "region", "charges"], "rows": records},
          open(OUT / "dataset.json", "w"), separators=(",", ":"))

for n, m in models.items():
    print(n, {k: round(v, 4) for k, v in m["metrics"].items()}, m["residualBand"])
