# Forced displacement flow map

This bundle contains a MapLibre-based interactive flow map wired to your three CSV files.

## Included files

- `index.html`
- `app.js`
- `styles.css`
- `refugees.csv`
- `asylum-seekers.csv`
- `People in refugee-like situation.csv`
- `country_centroids_alpha3.json`
- `world_countries.geojson`

## What the map shows

The map is designed for **stock by corridor in the selected year**:
- origin country -> asylum / host country
- one active category at a time
- one active year at a time
- optional filter by origin country

It should **not** be framed as annual arrivals.

## Run locally

Open the folder in a terminal and start a local server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Do not open `index.html` directly with `file://`, because browser fetch requests for the CSV/JSON files may fail.

## Main places to edit

### 1. Swap data file names
At the top of `app.js`:

```js
const DATA_FILES = {
  refugees: './refugees.csv',
  asylum: './asylum-seekers.csv',
  roc: './People in refugee-like situation.csv',
  centroids: './country_centroids_alpha3.json',
  countries: './world_countries.geojson'
};
```

### 2. Change colors
In `CATEGORY_META` inside `app.js`, and CSS custom properties in `styles.css`.

### 3. Change visible origin buttons
Edit `COUNTRY_FILTERS` in `app.js`.

### 4. Adjust line thickness
Edit `widthExpression()` and `highlightWidthExpression()` in `app.js`.

## Interaction behavior

- hover a line -> line, countries, and centroids are highlighted
- click a line -> locks the highlight
- click on empty map -> clears the lock
- year slider -> filters data by year
- category buttons -> switch active layer logic
- country buttons -> filter by origin country
