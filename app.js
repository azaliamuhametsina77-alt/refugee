const DATA_FILES = {
  refugees: './refugees.csv',
  asylum: './asylum-seekers.csv',
  roc: './People in refugee-like situation.csv',
  centroids: './country_centroids_alpha3.json',
  countries: './world_countries.geojson',
  worldNames: './world.csv'
};

const CATEGORY_META = {
  asylum: { label: 'Просители убежища', shortLabel: 'Просители убежища', color: '#5ab0ff' },
  refugees: { label: 'Беженцы', shortLabel: 'Беженцы', color: '#5ab0ff' },
  roc: { label: 'Беженцы де-факто', shortLabel: 'Беженцы де-факто', color: '#5ab0ff' }
};

const COUNTRY_FILTERS = [
  { iso: 'ALL', label: 'Все' },
  { iso: 'SDN', label: 'Судан' },
  { iso: 'COD', label: 'ДР Конго' },
  { iso: 'SOM', label: 'Сомали' },
  { iso: 'BFA', label: 'Буркина-Фасо' },
  { iso: 'MLI', label: 'Мали' },
  { iso: 'NER', label: 'Нигер' }
];

const YEARS = Array.from({ length: 11 }, (_, index) => 2015 + index);

const state = {
  activeCategory: 'asylum',
  activeOrigin: 'ALL',
  activeYear: 2025,
  features: [],
  hoveredKey: null,
  lockedKey: null,
  countryNamesRu: {}
};

const hoverCard = document.getElementById('hoverCard');
const metricLabel = document.getElementById('metricLabel');
const metricValue = document.getElementById('metricValue');
const yearReadout = document.getElementById('yearReadout');
const yearSlider = document.getElementById('yearSlider');
const sliderTicks = document.getElementById('sliderTicks');
const statusEl = document.getElementById('status');

let map;
let featureByKey = new Map();

async function init() {
  localizeStaticUI();
  buildCategoryButtons();
  buildCountryButtons();
  buildYearSlider();

  setStatus('Загрузка данных…');

  const [centroids, countriesGeoJSON, worldRows, refugeesRows, asylumRows, rocRows] = await Promise.all([
    fetchJSON(DATA_FILES.centroids),
    fetchJSON(DATA_FILES.countries),
    loadCsv(DATA_FILES.worldNames).catch(() => []),
    loadCsv(DATA_FILES.refugees),
    loadCsv(DATA_FILES.asylum),
    loadCsv(DATA_FILES.roc)
  ]);

  state.countryNamesRu = buildCountryNameMap(worldRows);
  ensureExtraCentroids(centroids);
  enrichCountryGeoJSON(countriesGeoJSON, state.countryNamesRu);

  state.features = [
    ...rowsToFlowFeatures(asylumRows, 'asylum', centroids, state.countryNamesRu),
    ...rowsToFlowFeatures(refugeesRows, 'refugees', centroids, state.countryNamesRu),
    ...rowsToFlowFeatures(rocRows, 'roc', centroids, state.countryNamesRu)
  ];

  featureByKey = new Map(state.features.map((feature) => [feature.properties.key, feature]));

  const flowCollection = {
    type: 'FeatureCollection',
    features: state.features.filter((feature) => !feature.properties.isMissingGeometry)
  };

  createMap();
  map.on('load', () => {
    installSources(countriesGeoJSON, flowCollection);
    installLayers();
    installInteractions();
    applyStateToMap();
    setStatus('Готово', true);
  });
}

function localizeStaticUI() {
  document.title = 'Карта вынужденного перемещения';

  const panelTitles = document.querySelectorAll('.panel-title');
  if (panelTitles[0]) panelTitles[0].textContent = 'Категория';
  if (panelTitles[1]) panelTitles[1].textContent = 'Страна происхождения';
  if (panelTitles[2]) panelTitles[2].textContent = 'Год';
  if (panelTitles[3]) panelTitles[3].textContent = 'Толщина линии';

  const methodNote = document.querySelector('.method-note');
  if (methodNote) {
    methodNote.innerHTML = 'Карта показывает совокупную численность беженцев на каждом направлении за год, а не поток новых прибытий.';
  }

  const hoverEyebrow = hoverCard?.querySelector('.eyebrow');
  if (hoverEyebrow) hoverEyebrow.textContent = 'Наведите или нажмите на линию';

  const routeEl = hoverCard?.querySelector('.route');
  if (routeEl) {
  routeEl.innerHTML = `
    <span class="route-line">Страна происхождения →</span>
    <span class="route-line">страна приёма</span>
  `;
}

  if (metricLabel) metricLabel.textContent = 'Численность';
  if (metricValue) metricValue.textContent = '—';

  const legendItems = document.querySelectorAll('.legend-item span:last-child');
  if (legendItems[0]) legendItems[0].textContent = 'Меньше';
  if (legendItems[1]) legendItems[1].textContent = 'Среднее значение';
  if (legendItems[2]) legendItems[2].textContent = 'Больше';

  if (sliderTicks) {
    sliderTicks.innerHTML = '';
    sliderTicks.style.display = 'none';
  }
}

function createMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {},
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#0a0a0b' }
        }
      ]
    },
    center: [20, 10],
    zoom: 1.3,
    minZoom: 1.05,
    maxZoom: 5.5,
    attributionControl: true,
    renderWorldCopies: false
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
}

function installSources(countriesGeoJSON, flowCollection) {
  map.addSource('countries', {
    type: 'geojson',
    data: countriesGeoJSON
  });

  map.addSource('flows', {
    type: 'geojson',
    data: flowCollection
  });

  map.addSource('hover-flow', {
    type: 'geojson',
    data: emptyFeatureCollection()
  });

  map.addSource('hover-points', {
    type: 'geojson',
    data: emptyFeatureCollection()
  });

  map.addSource('hover-label', {
    type: 'geojson',
    data: emptyFeatureCollection()
  });
}

function installLayers() {
  map.addLayer({
    id: 'countries-fill',
    type: 'fill',
    source: 'countries',
    paint: {
      'fill-color': '#1a1b1e',
      'fill-opacity': 1
    }
  });

  map.addLayer({
    id: 'countries-selected-origin',
    type: 'fill',
    source: 'countries',
    filter: ['==', ['coalesce', ['get', 'ISO3166-1-Alpha-3'], ['get', 'alpha3'], ['get', 'iso3']], '___none___'],
    paint: {
      'fill-color': '#3a3d42',
      'fill-opacity': 0.8
    }
  });

  map.addLayer({
    id: 'countries-hover-highlight',
    type: 'fill',
    source: 'countries',
    filter: ['==', ['coalesce', ['get', 'ISO3166-1-Alpha-3'], ['get', 'alpha3'], ['get', 'iso3']], '___none___'],
    paint: {
      'fill-color': '#3a3d42',
      'fill-opacity': 0.18
    }
  });

  map.addLayer({
    id: 'countries-borders',
    type: 'line',
    source: 'countries',
    paint: {
      'line-color': 'rgba(255,255,255,0.10)',
      'line-width': 0.8
    }
  });

  map.addLayer({
    id: 'countries-labels',
    type: 'symbol',
    source: 'countries',
    minzoom: 1.15,
    layout: {
      'text-field': ['coalesce', ['get', 'name_ru'], ['get', 'label_ru'], ['get', 'name']],
      'text-font': ['Open Sans Regular'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        1.2, 10,
        2.0, 11,
        3.5, 12
      ],
      'text-max-width': 8,
      'text-allow-overlap': false,
      'text-ignore-placement': false
    },
    paint: {
      'text-color': 'rgba(220, 223, 228, 0.72)',
      'text-halo-color': 'rgba(10, 10, 11, 0.96)',
      'text-halo-width': 1.2
    }
  });

  map.addLayer({
    id: 'flows-base',
    type: 'line',
    source: 'flows',
    filter: ['==', ['get', 'category'], state.activeCategory],
    layout: {
      'line-cap': 'round',
      'line-join': 'round'
    },
    paint: {
      'line-color': CATEGORY_META[state.activeCategory].color,
      'line-opacity': 0.56,
      'line-width': widthExpression(),
      'line-blur': 0.15
    }
  });

  map.addLayer({
    id: 'flows-hitbox',
    type: 'line',
    source: 'flows',
    filter: ['==', ['get', 'category'], state.activeCategory],
    layout: {
      'line-cap': 'round',
      'line-join': 'round'
    },
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0,
      'line-width': 18
    }
  });

  map.addLayer({
    id: 'hover-flow-line',
    type: 'line',
    source: 'hover-flow',
    layout: {
      'line-cap': 'round',
      'line-join': 'round'
    },
    paint: {
      'line-color': '#cfe9ff',
      'line-opacity': 1,
      'line-width': highlightWidthExpression()
    }
  });

  map.addLayer({
    id: 'hover-points-layer',
    type: 'circle',
    source: 'hover-points',
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'role'], 'origin'],
        6.5,
        5.5
      ],
      'circle-color': [
        'case',
        ['==', ['get', 'role'], 'origin'],
        '#ffffff',
        '#9ed0ff'
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#07111f'
    }
  });

  map.addLayer({
    id: 'hover-label-layer',
    type: 'symbol',
    source: 'hover-label',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Open Sans Bold'],
      'text-size': 13,
      'text-offset': [0, -1.2],
      'text-anchor': 'bottom',
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: {
      'text-color': '#07111f',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2.5
    }
  });
}

function installInteractions() {
  map.on('mouseenter', 'flows-hitbox', () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', 'flows-hitbox', () => {
    map.getCanvas().style.cursor = '';
    if (state.lockedKey) return;
    clearHoverState();
  });

  map.on('mousemove', 'flows-hitbox', (event) => {
    if (state.lockedKey) return;
    const feature = event.features?.[0];
    if (!feature) return;
    setHoverFeature(feature.properties.key);
  });

  map.on('click', 'flows-hitbox', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    if (state.lockedKey === feature.properties.key) {
      state.lockedKey = null;
      setHoverFeature(feature.properties.key);
      return;
    }
    state.lockedKey = feature.properties.key;
    setHoverFeature(feature.properties.key);
  });

  map.on('click', (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: ['flows-hitbox'] });
    if (features.length) return;
    state.lockedKey = null;
    clearHoverState();
  });
}

function applyStateToMap() {
  const activeMeta = CATEGORY_META[state.activeCategory];
  const filter = getActiveFilter();

  map.setFilter('flows-base', filter);
  map.setFilter('flows-hitbox', filter);
  map.setPaintProperty('flows-base', 'line-color', activeMeta.color);

  if (state.activeOrigin === 'ALL') {
    map.setFilter('countries-selected-origin', ['==', ['coalesce', ['get', 'ISO3166-1-Alpha-3'], ['get', 'alpha3'], ['get', 'iso3']], '___none___']);
  } else {
    map.setFilter('countries-selected-origin', ['==', ['coalesce', ['get', 'ISO3166-1-Alpha-3'], ['get', 'alpha3'], ['get', 'iso3']], state.activeOrigin]);
  }

  const stillVisible = state.hoveredKey && doesFeatureMatchCurrentState(featureByKey.get(state.hoveredKey));
  if (!stillVisible) {
    state.lockedKey = null;
    clearHoverState();
  } else if (state.hoveredKey) {
    setHoverFeature(state.hoveredKey);
  }

  updateActiveButtonClasses();
  yearReadout.textContent = String(state.activeYear);
}

function getActiveFilter() {
  const allConditions = [
    ['==', ['get', 'category'], state.activeCategory],
    ['==', ['get', 'year'], state.activeYear]
  ];

  if (state.activeOrigin !== 'ALL') {
    allConditions.push(['==', ['get', 'origin_iso'], state.activeOrigin]);
  }

  return ['all', ...allConditions];
}

function setHoverFeature(key) {
  const feature = featureByKey.get(key);
  if (!feature || !doesFeatureMatchCurrentState(feature)) {
    clearHoverState();
    return;
  }

  state.hoveredKey = key;

  const count = Number(feature.properties.count);
  const label = count.toLocaleString('ru-RU');
  const midpoint = feature.properties.midpoint;
  const hoverLine = {
    type: 'FeatureCollection',
    features: [feature]
  };

  const hoverPoints = {
    type: 'FeatureCollection',
    features: [
      pointFeature(feature.properties.origin_coord, {
        role: 'origin',
        name: feature.properties.origin_name_ru,
        iso: feature.properties.origin_iso
      }),
      pointFeature(feature.properties.dest_coord, {
        role: 'destination',
        name: feature.properties.dest_name_ru,
        iso: feature.properties.dest_iso
      })
    ]
  };

  const hoverLabel = {
    type: 'FeatureCollection',
    features: [
      pointFeature(midpoint, { label })
    ]
  };

  map.getSource('hover-flow').setData(hoverLine);
  map.getSource('hover-points').setData(hoverPoints);
  map.getSource('hover-label').setData(hoverLabel);

  map.setFilter('countries-hover-highlight', [
    'in',
    ['coalesce', ['get', 'ISO3166-1-Alpha-3'], ['get', 'alpha3'], ['get', 'iso3']],
    ['literal', [feature.properties.origin_iso, feature.properties.dest_iso]]
  ]);

  hoverCard.classList.remove('is-empty');
  hoverCard.querySelector('.route').textContent =
    `${feature.properties.origin_name_ru} → ${feature.properties.dest_name_ru}`;
  metricLabel.textContent = CATEGORY_META[state.activeCategory].shortLabel;
  metricValue.textContent = label;
}

function clearHoverState() {
  state.hoveredKey = null;

  if (!map?.getSource('hover-flow')) return;

  map.getSource('hover-flow').setData(emptyFeatureCollection());
  map.getSource('hover-points').setData(emptyFeatureCollection());
  map.getSource('hover-label').setData(emptyFeatureCollection());

  map.setFilter('countries-hover-highlight', ['==', ['coalesce', ['get', 'ISO3166-1-Alpha-3'], ['get', 'alpha3'], ['get', 'iso3']], '___none___']);

  hoverCard.classList.add('is-empty');
  hoverCard.querySelector('.route').innerHTML = `
  <span class="route-line">Страна происхождения →</span>
  <span class="route-line">страна приёма</span>
`;
  metricLabel.textContent = 'Численность';
  metricValue.textContent = '—';
}

function doesFeatureMatchCurrentState(feature) {
  if (!feature || feature.properties.category !== state.activeCategory) return false;
  if (Number(feature.properties.year) !== Number(state.activeYear)) return false;
  if (state.activeOrigin !== 'ALL' && feature.properties.origin_iso !== state.activeOrigin) return false;
  return true;
}

function buildCategoryButtons() {
  const container = document.getElementById('categoryButtons');
  container.innerHTML = '';

  Object.entries(CATEGORY_META).forEach(([key, meta]) => {
    const button = document.createElement('button');
    button.className = 'control-button';
    button.textContent = meta.label;
    button.dataset.category = key;
    button.dataset.value = key;
    button.addEventListener('click', () => {
      state.activeCategory = key;
      state.lockedKey = null;
      applyStateToMap();
    });
    container.appendChild(button);
  });
}

function buildCountryButtons() {
  const container = document.getElementById('countryButtons');
  container.innerHTML = '';

  COUNTRY_FILTERS.forEach((country) => {
    const button = document.createElement('button');
    button.className = 'control-button';
    button.textContent = country.label;
    button.dataset.value = country.iso;
    button.addEventListener('click', () => {
      state.activeOrigin = country.iso;
      state.lockedKey = null;
      applyStateToMap();
    });
    container.appendChild(button);
  });
}

function buildYearSlider() {
  yearSlider.min = '0';
  yearSlider.max = String(YEARS.length - 1);
  yearSlider.step = '1';
  yearSlider.value = String(YEARS.indexOf(state.activeYear));

  yearSlider.addEventListener('input', (event) => {
    const yearIndex = Number(event.target.value);
    state.activeYear = YEARS[yearIndex];
    state.lockedKey = null;
    yearReadout.textContent = String(state.activeYear);
    applyStateToMap();
  });

  if (sliderTicks) {
    sliderTicks.innerHTML = '';
    sliderTicks.style.display = 'none';
  }
}

function updateActiveButtonClasses() {
  document.querySelectorAll('#categoryButtons .control-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.value === state.activeCategory);
  });

  document.querySelectorAll('#countryButtons .control-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.value === state.activeOrigin);
  });

  yearSlider.value = String(YEARS.indexOf(state.activeYear));
}

function rowsToFlowFeatures(rows, categoryKey, centroids, countryNamesRu) {
  const features = [];

  rows.forEach((row) => {
    const originISO = sanitizeIso(row.OriginISO);
    const destISO = sanitizeIso(row.AsylumISO);
    const origin = centroids[originISO];
    const destination = centroids[destISO];
    const count = Number(row.Count);
    const year = Number(row.Year);
    const key = `${categoryKey}__${originISO}__${destISO}__${year}`;

    const originNameRu = getCountryNameRu(originISO, row.OriginName, countryNamesRu, origin);
    const destNameRu = getCountryNameRu(destISO, row.AsylumName, countryNamesRu, destination);

    if (!origin || !destination || !Number.isFinite(count) || !Number.isFinite(year)) {
      features.push({
        type: 'Feature',
        properties: {
          key,
          category: categoryKey,
          origin_iso: originISO,
          origin_name: row.OriginName,
          origin_name_ru: originNameRu,
          dest_iso: destISO,
          dest_name: row.AsylumName,
          dest_name_ru: destNameRu,
          year,
          count,
          isMissingGeometry: true
        },
        geometry: null
      });
      return;
    }

    const originCoord = [Number(origin.lon), Number(origin.lat)];
    const destCoord = [Number(destination.lon), Number(destination.lat)];
    const coordinates = makeArc(originCoord, destCoord);
    const midpoint = coordinates[Math.floor(coordinates.length / 2)];

    features.push({
      type: 'Feature',
      properties: {
        key,
        category: categoryKey,
        origin_iso: originISO,
        origin_name: row.OriginName,
        origin_name_ru: originNameRu,
        dest_iso: destISO,
        dest_name: row.AsylumName,
        dest_name_ru: destNameRu,
        year,
        count,
        origin_coord: originCoord,
        dest_coord: destCoord,
        midpoint,
        isMissingGeometry: false
      },
      geometry: {
        type: 'LineString',
        coordinates
      }
    });
  });

  return features;
}

function getCountryNameRu(iso3, fallbackName, countryNamesRu, centroidItem) {
  return (
    countryNamesRu[iso3] ||
    centroidItem?.name_ru ||
    centroidItem?.label_ru ||
    fallbackName ||
    iso3
  );
}

function buildCountryNameMap(rows) {
  const map = {};
  rows.forEach((row) => {
    const iso3 = sanitizeIso(row.alpha3 || row.alpha_3 || row.iso3 || row.ISO3);
    const name = String(row.name || row.name_ru || '').trim();
    if (iso3 && name) map[iso3] = name;
  });
  return map;
}

function enrichCountryGeoJSON(geojson, countryNamesRu) {
  if (!geojson?.features) return;

  geojson.features.forEach((feature) => {
    const props = feature.properties || (feature.properties = {});
    const iso3 = sanitizeIso(
      props['ISO3166-1-Alpha-3'] || props.alpha3 || props.iso3 || props.ADM0_A3 || props.ISO_A3 || feature.id
    );

    const nameRu = countryNamesRu[iso3];
    if (nameRu) {
      props.name_ru = nameRu;
      props.label_ru = nameRu;
    }
  });
}

function makeArc(start, end, steps = 38) {
  const [x1, y1] = start;
  let [x2, y2] = end;

  let dx = x2 - x1;
  if (Math.abs(dx) > 180) {
    dx = dx > 0 ? dx - 360 : dx + 360;
    x2 = x1 + dx;
  }

  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy) || 1;
  const offset = Math.min(Math.max(distance * 0.16, 1.4), 10.5);
  const mx = x1 + dx / 2;
  const my = y1 + dy / 2;
  const nx = -dy / distance;
  const ny = dx / distance;
  const cx = mx + nx * offset;
  const cy = my + ny * offset;

  const coordinates = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const lon = ((1 - t) * (1 - t) * x1) + (2 * (1 - t) * t * cx) + (t * t * x2);
    const lat = ((1 - t) * (1 - t) * y1) + (2 * (1 - t) * t * cy) + (t * t * y2);
    coordinates.push([normalizeLongitude(lon), lat]);
  }
  return coordinates;
}

function normalizeLongitude(lon) {
  let value = lon;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function pointFeature(coord, properties) {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Point',
      coordinates: coord
    }
  };
}

function emptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: []
  };
}

function widthExpression() {
  return [
    'interpolate',
    ['linear'],
    ['to-number', ['get', 'count']],
    0, 1.2,
    25, 1.6,
    100, 2.2,
    500, 3.4,
    2500, 5,
    10000, 7.5,
    50000, 11,
    250000, 15,
    500000, 18
  ];
}

function highlightWidthExpression() {
  return [
    'interpolate',
    ['linear'],
    ['to-number', ['get', 'count']],
    0, 2.2,
    25, 2.8,
    100, 3.4,
    500, 4.5,
    2500, 6.2,
    10000, 8.4,
    50000, 11.5,
    250000, 15,
    500000, 18
  ];
}

function sanitizeIso(value) {
  return String(value || '').trim().toUpperCase();
}

function ensureExtraCentroids(centroids) {
  if (!centroids.NAM) {
    centroids.NAM = {
      iso3: 'NAM',
      iso2: 'NA',
      name: 'Namibia',
      lat: -22.5597,
      lon: 17.0832
    };
  }

  if (!centroids.HKG) {
    centroids.HKG = {
      iso3: 'HKG',
      iso2: 'HK',
      name: 'Hong Kong',
      lat: 22.3193,
      lon: 114.1694
    };
  }
}

async function loadCsv(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  const text = await response.text();
  const parsed = Papa.parse(text, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true
  });
  return parsed.data;
}

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

function setStatus(message, hide = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('is-hidden', hide);
}

window.addEventListener('resize', () => {
  buildYearSlider();
});

init().catch((error) => {
  console.error(error);
  setStatus('Не удалось загрузить данные');
});
