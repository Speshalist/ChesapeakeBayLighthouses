import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

const REPO_NAME = "ChesapeakeBayLighthouses"; // project pages base path

function slugify(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toNumberOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nonEmpty(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function normStatus(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "unknown";
  if (
    ["active", "inactive", "moved to museum", "destroyed", "unknown"].includes(
      s
    )
  )
    return s;
  return "unknown";
}

function firstYear(v) {
  const s = String(v ?? "");
  const m = s.match(/\b(1[6-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function parseCoordinates(v) {
  const s = String(v ?? "");
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return { latitude: null, longitude: null };
  return { latitude: Number(m[1]), longitude: Number(m[2]) };
}

function inferType(name) {
  const n = String(name ?? "").toLowerCase();
  if (n.includes("range")) return "range";
  if (n.includes("caisson")) return "caisson";
  if (n.includes("lightship")) return "lightship";
  if (n.includes("tower") || n.includes("beacon") || n.includes("jetty"))
    return "tower";
  return "unknown";
}

function inferStatusFromDeRow(v) {
  const s = String(v ?? "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("destroy") || s.includes("demolish") || s.includes("burn"))
    return "destroyed";
  if (s.includes("active")) return "active";
  if (
    s.includes("inactive") ||
    s.includes("deactiv") ||
    s.includes("private house") ||
    /\b\d{4}\b/.test(s)
  )
    return "inactive";
  return "unknown";
}

function normalizeRow(r) {
  // Standard schema
  if (nonEmpty(r.name) || nonEmpty(r.id)) {
    const id = nonEmpty(r.id) ?? slugify(r.name);
    return {
      id,
      name: nonEmpty(r.name) ?? id,
      state: nonEmpty(r.state),
      latitude: toNumberOrNull(r.latitude),
      longitude: toNumberOrNull(r.longitude),
      year_built: toNumberOrNull(r.year_built),
      status: normStatus(r.status),
      type: nonEmpty(r.type) ?? "unknown",
      wikipedia_url: nonEmpty(r.wikipedia_url),
      source_list_url: nonEmpty(r.source_list_url),
    };
  }

  // Delaware list schema from uploaded CSV
  if (nonEmpty(r.Name) && nonEmpty(r.Coordinates)) {
    const normalizedName = nonEmpty(r.Name)
      ?.replace(/\s*\([^)]*\)\s*$/g, "")
      .replace(/\s+/g, " ");
    const { latitude, longitude } = parseCoordinates(r.Coordinates);

    return {
      id: slugify(normalizedName),
      name: normalizedName,
      state: "DE",
      latitude,
      longitude,
      year_built: firstYear(r["Year first lit"]),
      status: inferStatusFromDeRow(r["Year deactivated"]),
      type: inferType(normalizedName),
      wikipedia_url: null,
      source_list_url:
        "https://en.wikipedia.org/wiki/List_of_lighthouses_in_Delaware",
    };
  }

  return null;
}

async function main() {
  const dataDir = "data";
  const dirEntries = await fs.readdir(dataDir, { withFileTypes: true });
  const csvFiles = dirEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name)
    .sort((a, b) => {
      // Keep the main dataset first so specialized files can override by id.
      if (a === "lighthouses.csv") return -1;
      if (b === "lighthouses.csv") return 1;
      return a.localeCompare(b);
    });

  if (!csvFiles.length) {
    throw new Error("No CSV files found in data/");
  }

  const rows = [];
  for (const csvFile of csvFiles) {
    const csvPath = path.join(dataDir, csvFile);
    const csvRaw = await fs.readFile(csvPath, "utf8");
    rows.push(
      ...parse(csvRaw, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      })
    );
  }

  const parsedItems = rows.map(normalizeRow).filter(Boolean);

  const items = Array.from(
    new Map(parsedItems.map((item) => [item.id, item])).values()
  );

  // Data for Eleventy templates
  await fs.mkdir(path.join("src", "_data"), { recursive: true });
  await fs.writeFile(
    path.join("src", "_data", "lighthouses.json"),
    JSON.stringify(
      {
        repoBasePath: `/${REPO_NAME}/`,
        items,
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  // GeoJSON for Leaflet
  const features = items
    .filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude))
    .map((x) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [x.longitude, x.latitude] },
      properties: {
        id: x.id,
        name: x.name,
        state: x.state,
        year_built: x.year_built,
        status: x.status,
        type: x.type,
      },
    }));

  await fs.mkdir("dist", { recursive: true });
  await fs.writeFile(
    path.join("dist", "lighthouses.geojson"),
    JSON.stringify({ type: "FeatureCollection", features }, null, 2),
    "utf8"
  );

  // Run Eleventy build (3.x exports Eleventy as named export)
  const { Eleventy } = await import("@11ty/eleventy");
  const elev = new Eleventy("src", "dist", { configPath: ".eleventy.cjs" });
  await elev.write();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
