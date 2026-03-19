const base = window.__REPO_BASE__ || "/";

const map = L.map("map", { preferCanvas: true }).setView([38.9, -76.3], 7);

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

function colorByStatus(status) {
  switch ((status || "unknown").toLowerCase()) {
    case "active":
      return "#1a7f37";
    case "inactive":
      return "#57606a";
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
  const destroyed = (p.status || "").toLowerCase() === "destroyed";
  const html = destroyed
    ? `<span class="ring" style="border-color:${color}"></span>`
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

async function loadGeojson() {
  const res = await fetch(`${base}lighthouses.geojson`);
  if (!res.ok) throw new Error(`Failed to load GeoJSON: ${res.status}`);
  const gj = await res.json();

  if (geoLayer) geoLayer.remove();

  geoLayer = L.geoJSON(gj, {
    pointToLayer: markerForFeature,
    onEachFeature: (feature, layer) => {
      layer.bindPopup(popupHtml(feature.properties || {}));
    },
  }).addTo(map);

  const bounds = geoLayer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.12));
}

document.getElementById("basemap")?.addEventListener("change", (e) => {
  const v = e.target.value;
  if (v === "water") {
    map.removeLayer(osm);
    water.addTo(map);
  } else {
    map.removeLayer(water);
    osm.addTo(map);
  }
});

document.getElementById("symbology")?.addEventListener("change", async (e) => {
  currentMode = e.target.value;
  await loadGeojson();
});

loadGeojson().catch((err) => {
  console.error(err);
  alert("Failed to load lighthouse data. See console for details.");
});
