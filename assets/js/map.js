const base = window.__REPO_BASE__ || "/";

const map = L.map("map", { preferCanvas: true, zoomControl: false }).setView(
  [38.9, -76.3],
  7
);
L.control.zoom({ position: "topright" }).addTo(map);

// Basemaps
const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
});

const water = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  }
);

osm.addTo(map);

let currentMode = "status";
let geoLayer = null;
let allGeojson = null;
let minBuiltYear = 1800;
let maxBuiltYear = 2000;
let timelineYear = 2000;
let totalWithYear = 0;
let mapFitted = false;
let playTimer = null;

const TIMELAPSE_INTERVAL_MS = 220;
const HISTORICAL_EVENTS = [
  { year: 1776, label: "US Independence" },
  { year: 1812, label: "War of 1812" },
  { year: 1861, label: "Civil War begins" },
  { year: 1903, label: "Wright brothers fly" },
  { year: 1941, label: "US enters WWII" },
  { year: 1964, label: "Bay Bridge-Tunnel opens" },
];

function legendItemsForMode(mode) {
  if (mode === "type") {
    return {
      title: "Legend: Type",
      items: [
        ["Screw-pile", colorByType("screw-pile")],
        ["Caisson", colorByType("caisson")],
        ["Range", colorByType("range")],
        ["Lightship", colorByType("lightship")],
        ["Tower", colorByType("tower")],
        ["Other / Unknown", colorByType("unknown")],
      ],
    };
  }

  if (mode === "year_built") {
    return {
      title: "Legend: Year Built",
      items: [
        ["Before 1850", colorByYear(1849)],
        ["1850-1899", colorByYear(1899)],
        ["1900-1949", colorByYear(1949)],
        ["1950 and later", colorByYear(1950)],
        ["Unknown year", colorByYear(NaN)],
      ],
    };
  }

  return {
    title: "Legend: Status",
    items: [
      ["Active", colorByStatus("active")],
      ["Inactive", colorByStatus("inactive")],
      ["Moved to museum", colorByStatus("moved to museum")],
      ["Destroyed", colorByStatus("destroyed")],
      ["Unknown", colorByStatus("unknown")],
    ],
  };
}

function renderLegend() {
  const target = document.getElementById("legend");
  if (!target) return;

  const { title, items } = legendItemsForMode(currentMode);
  const rows = items
    .map(([label, color]) => {
      const isDestroyed = currentMode === "status" && label === "Destroyed";
      const isMovedToMuseum =
        currentMode === "status" && label === "Moved to museum";
      const swatchClass = isDestroyed
        ? "legend-swatch legend-swatch-ring"
        : isMovedToMuseum
          ? "legend-swatch legend-swatch-diamond"
        : "legend-swatch";
      const style = isDestroyed
        ? `style="border-color:${color}"`
        : isMovedToMuseum
          ? `style="background:${color}; --diamond-color:${color}"`
          : `style="background:${color}"`;

      return `<div class="legend-row"><span class="${swatchClass}" ${style}></span><span class="legend-label">${label}</span></div>`;
    })
    .join("");

  const destroyedNote =
    currentMode === "status"
      ? "<div class=\"note\">Destroyed is shown with a ring marker.</div>"
      : "";

  target.innerHTML = `<div class="legend-title">${title}</div>${rows}${destroyedNote}`;
}

function colorByStatus(status) {
  switch ((status || "unknown").toLowerCase()) {
    case "active":
      return "#1a7f37";
    case "inactive":
      return "#57606a";
    case "moved to museum":
      return "#9a6700";
    case "destroyed":
      return "#cf222e";
    default:
      return "#0969da";
  }
}

function colorByType(type) {
  const t = (type || "unknown").toLowerCase();
  if (t.includes("screw")) return "#8250df";
  if (t.includes("caisson")) return "#d29922";
  if (t.includes("range")) return "#0a3069";
  if (t.includes("lightship")) return "#bc4c00";
  if (t.includes("tower")) return "#0550ae";
  return "#0969da";
}

function colorByYear(year) {
  if (!Number.isFinite(year)) return "#0969da";
  if (year < 1850) return "#0a3069";
  if (year < 1900) return "#0550ae";
  if (year < 1950) return "#1f6feb";
  return "#54aeff";
}

function markerForFeature(feature, latlng) {
  const p = feature.properties || {};
  let color = "#0969da";
  if (currentMode === "status") color = colorByStatus(p.status);
  else if (currentMode === "type") color = colorByType(p.type);
  else if (currentMode === "year_built")
    color = colorByYear(Number(p.year_built));

  // Make destroyed look different (ring)
  const status = (p.status || "").toLowerCase();
  const destroyed = status === "destroyed";
  const movedToMuseum = status === "moved to museum";
  const html = destroyed
    ? `<span class="ring" style="border-color:${color}"></span>`
    : movedToMuseum
      ? `<span class="diamond" style="background:${color}; --diamond-color:${color}"></span>`
      : `<span class="dot" style="background:${color}"></span>`;

  const icon = L.divIcon({
    className: "lh-marker",
    html,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  return L.marker(latlng, { icon });
}

function popupHtml(p) {
  const id = p.id;
  const detailsUrl = `${base}lighthouses/${id}/`;
  const year = p.year_built ? ` · Built: ${p.year_built}` : "";
  const state = p.state ? ` (${p.state})` : "";
  const status = p.status || "unknown";

  return `
    <strong>${p.name}${state}</strong><br/>
    Status: ${status}${year}<br/>
    Type: ${p.type || "unknown"}<br/>
    <a href="${detailsUrl}">View details</a>
  `;
}

function timelineElements() {
  return {
    slider: document.getElementById("timeline-year"),
    yearLabel: document.getElementById("timeline-current-year"),
    summary: document.getElementById("timeline-summary"),
    eventLabel: document.getElementById("timeline-event"),
    eventTrack: document.getElementById("timeline-event-track"),
    playButton: document.getElementById("timeline-play"),
    resetButton: document.getElementById("timeline-reset"),
  };
}

function clampTimelineYear(year) {
  if (!Number.isFinite(year)) return maxBuiltYear;
  return Math.max(minBuiltYear, Math.min(maxBuiltYear, Math.round(year)));
}

function yearFromFeature(feature) {
  return Number(feature?.properties?.year_built);
}

function featureVisibleForYear(feature, year) {
  const builtYear = yearFromFeature(feature);
  return Number.isFinite(builtYear) && builtYear <= year;
}

function nearestHistoricalEvent(year) {
  const candidates = HISTORICAL_EVENTS.filter((event) => event.year <= year);
  if (!candidates.length) return null;
  return candidates[candidates.length - 1];
}

function updateHistoricalEventMarkers() {
  const { eventTrack } = timelineElements();
  if (!eventTrack) return;

  eventTrack.innerHTML = "";
  const range = maxBuiltYear - minBuiltYear;
  if (range <= 0) return;

  for (const event of HISTORICAL_EVENTS) {
    if (event.year < minBuiltYear || event.year > maxBuiltYear) continue;

    const leftPct = ((event.year - minBuiltYear) / range) * 100;
    const marker = document.createElement("div");
    marker.className = "timeline-event-marker";
    marker.style.left = `${leftPct}%`;
    marker.title = `${event.year}: ${event.label}`;
    marker.innerHTML = `<span>${event.year}</span>`;
    eventTrack.appendChild(marker);
  }
}

function updateTimelineText() {
  const { yearLabel, summary, eventLabel } = timelineElements();
  if (yearLabel) yearLabel.textContent = `Year: ${timelineYear}`;

  if (summary && allGeojson?.features) {
    const shown = allGeojson.features.filter((feature) =>
      featureVisibleForYear(feature, timelineYear)
    ).length;
    summary.textContent = `Showing ${shown} of ${totalWithYear} lighthouses with known build years.`;
  }

  if (eventLabel) {
    const event = nearestHistoricalEvent(timelineYear);
    eventLabel.textContent = event
      ? `Historical context: ${event.year} - ${event.label}`
      : "Historical context: --";
  }
}

function stopTimelapse() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }

  const { playButton } = timelineElements();
  if (!playButton) return;
  playButton.textContent = "Play Timelapse";
  playButton.setAttribute("aria-pressed", "false");
}

function renderGeoLayer() {
  if (!allGeojson) return;

  if (geoLayer) geoLayer.remove();

  const filteredFeatures = allGeojson.features.filter((feature) =>
    featureVisibleForYear(feature, timelineYear)
  );

  geoLayer = L.geoJSON(
    { type: "FeatureCollection", features: filteredFeatures },
    {
      pointToLayer: markerForFeature,
      onEachFeature: (feature, layer) => {
        layer.bindPopup(popupHtml(feature.properties || {}));
      },
    }
  ).addTo(map);

  if (!mapFitted && geoLayer.getLayers().length) {
    const bounds = geoLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.12));
      mapFitted = true;
    }
  }
}

function setTimelineYear(year) {
  timelineYear = clampTimelineYear(year);

  const { slider } = timelineElements();
  if (slider) slider.value = String(timelineYear);

  updateTimelineText();
  renderGeoLayer();
}

function initializeTimeline() {
  if (!allGeojson?.features?.length) return;

  const builtYears = allGeojson.features
    .map((feature) => yearFromFeature(feature))
    .filter((value) => Number.isFinite(value));

  if (!builtYears.length) return;

  minBuiltYear = Math.min(...builtYears);
  maxBuiltYear = Math.max(...builtYears);
  totalWithYear = builtYears.length;
  timelineYear = maxBuiltYear;

  const { slider } = timelineElements();
  if (slider) {
    slider.min = String(minBuiltYear);
    slider.max = String(maxBuiltYear);
    slider.step = "1";
    slider.value = String(timelineYear);
  }

  updateHistoricalEventMarkers();
  updateTimelineText();
}

function toggleTimelapse() {
  const { playButton } = timelineElements();
  if (!playButton) return;

  if (playTimer) {
    stopTimelapse();
    return;
  }

  if (timelineYear >= maxBuiltYear) setTimelineYear(minBuiltYear);

  playButton.textContent = "Pause Timelapse";
  playButton.setAttribute("aria-pressed", "true");

  playTimer = setInterval(() => {
    if (timelineYear >= maxBuiltYear) {
      stopTimelapse();
      return;
    }

    setTimelineYear(timelineYear + 1);
  }, TIMELAPSE_INTERVAL_MS);
}

function bindTimelineControls() {
  const { slider, playButton, resetButton } = timelineElements();

  slider?.addEventListener("input", (e) => {
    stopTimelapse();
    setTimelineYear(Number(e.target.value));
  });

  playButton?.addEventListener("click", () => {
    toggleTimelapse();
  });

  resetButton?.addEventListener("click", () => {
    stopTimelapse();
    setTimelineYear(maxBuiltYear);
  });
}

async function loadGeojson() {
  const res = await fetch(`${base}lighthouses.geojson`);
  if (!res.ok) throw new Error(`Failed to load GeoJSON: ${res.status}`);
  allGeojson = await res.json();

  initializeTimeline();
  renderGeoLayer();
}

function applyBasemap(v) {
  if (v === "water") {
    map.removeLayer(osm);
    water.addTo(map);
  } else {
    map.removeLayer(water);
    osm.addTo(map);
  }
}

function applySymbology(v) {
  currentMode = v;
  renderLegend();
  renderGeoLayer();
}

// Backward compatibility: keep working if selects are rendered.
document.getElementById("basemap")?.addEventListener("change", (e) => {
  applyBasemap(e.target.value);
});

document.getElementById("symbology")?.addEventListener("change", async (e) => {
  applySymbology(e.target.value);
});

for (const input of document.querySelectorAll('input[name="basemap"]')) {
  input.addEventListener("change", (e) => {
    if (e.target.checked) applyBasemap(e.target.value);
  });
}

for (const input of document.querySelectorAll('input[name="symbology"]')) {
  input.addEventListener("change", (e) => {
    if (e.target.checked) applySymbology(e.target.value);
  });
}

bindTimelineControls();
renderLegend();
loadGeojson().catch((err) => {
  console.error(err);
  alert("Failed to load lighthouse data. See console for details.");
});
