# MediCost: Medical Insurance Cost Predictor

Estimate a person's yearly medical insurance cost from their age, BMI, children, smoking status, gender and region, see what drives it, and find out how much they could save.

The whole app is a static website. The model runs in the browser, so no server is needed and nothing a user enters leaves their device.

## Features

- **Live estimator.** Updates as you type and shows yearly and monthly cost, a likely range, a cost tier and your percentile among real people.
- **Breakdown.** Shows how much age, BMI, smoking, children, gender and region add to or take off your cost, compared with the average person.
- **Save money.** Shows what quitting smoking, reaching a healthy BMI or moving region would save, and what aging would add.
- **By age.** A chart of your projected cost from 18 to 64, with and without smoking.
- **People like you.** Real people from the data with a similar profile, and what they actually paid.
- **BMI calculator.** Works out BMI from height and weight in metric or imperial units.
- **Scenarios.** Save several profiles and compare them side by side.
- **Share link.** The current inputs are kept in the URL.
- **Print report.**
- **Data insights.** Interactive charts of the dataset.
- **Model comparison.** Original vs enhanced model, with an actual-vs-predicted chart.
- **Batch predictions.** Upload a CSV, get a CSV back. Processed in the browser.
- Light and dark mode, works on mobile, keyboard accessible.

## Model

| Model | R² | MAE | RMSE |
|-------|----|-----|------|
| Original linear regression | 0.807 | $4,177 | $5,956 |
| **Enhanced linear regression** | **0.909** | **$2,277** | **$4,091** |

The enhanced model adds four features: age², an obesity flag (BMI ≥ 30), smoker × obese and smoker × BMI. These capture the finding that obese smokers pay far more than either factor alone would suggest. The average error drops by 45%, and the model stays fully explainable.

Both models use the test set from an 80/20 split (`random_state=42`) of 1,337 records. The likely range comes from 5-fold cross-validated residuals.

## Project structure

```
public/                 # the website (deployed as-is)
  index.html
  styles.css
  app.js
  data/model.json       # model coefficients and metrics (generated)
  data/dataset.json     # cleaned records for the charts (generated)
  vendor/               # Chart.js
training/
  train.py              # retrains the models and regenerates public/data/
  insurance_cleaned.csv
  Big_brains_project.ipynb
vercel.json
```

## Deploy on Vercel

1. Import this repository in Vercel.
2. Keep the defaults. `vercel.json` already sets the output directory to `public` with no build step.
3. Deploy.

## Run locally

```bash
cd public && python3 -m http.server 8000
```

Then open http://localhost:8000.

## Retrain the model

```bash
pip install -r training/requirements.txt
python training/train.py
```

## Limitations

- Trained on one public US dataset, so results are educational estimates, not insurance quotes.
- About 1 in 12 people pay much more than predicted, for reasons not in the data (such as existing conditions).
- Inputs outside ages 18–64 or BMI 15–53 are outside the data.
