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
  if (["active", "inactive", "destroyed", "unknown"].includes(s)) return s;
  return "unknown";
}

async function main() {
  const csvPath = path.join("data", "lighthouses.csv");
  const csvRaw = await fs.readFile(csvPath, "utf8");

  const rows = parse(csvRaw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const items = rows.map((r) => {
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
  });

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
