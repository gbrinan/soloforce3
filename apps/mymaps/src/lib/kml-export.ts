// KML export — converts MyMaps DB records into a KML 2.2 XML string.
// Works in both browser and Node/Edge environments (no DOM dependency).

export interface KmlFeature {
  id: string;
  type: "marker" | "line" | "polygon";
  geometry: {
    // marker: { lat, lng }
    // line:   { coordinates: [lng, lat][] }
    // polygon:{ coordinates: [lng, lat][] }  (outer ring only)
    lat?: number;
    lng?: number;
    coordinates?: [number, number][];
  };
  properties?: {
    name?: string;
    description?: string;
    color?: string;   // hex '#RRGGBB'
    iconUrl?: string;
    strokeWidth?: number;
    fillOpacity?: number;
  };
}

export interface KmlLayer {
  id: string;
  name: string;
  features: KmlFeature[];
}

export interface KmlMap {
  name: string;
  layers: KmlLayer[];
}

// KML color format: AABBGGRR (alpha-blue-green-red hex, 2 chars each)
function hexToKmlColor(hex: string, alpha = "ff"): string {
  const h = hex.replace("#", "").toLowerCase().padEnd(6, "0");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `${alpha}${b}${g}${r}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function coordsToString(coords: [number, number][]): string {
  return coords.map(([lng, lat]) => `${lng},${lat},0`).join(" ");
}

function featureToKml(f: KmlFeature): string {
  const name = escapeXml(f.properties?.name ?? "");
  const desc = escapeXml(f.properties?.description ?? "");
  const color = f.properties?.color ?? "#4285F4";
  const kmlColor = hexToKmlColor(color);
  const strokeWidth = f.properties?.strokeWidth ?? 2;
  const fillOpacity = f.properties?.fillOpacity ?? 0.35;
  const fillAlpha = Math.round(fillOpacity * 255).toString(16).padStart(2, "0");
  const fillColor = hexToKmlColor(color, fillAlpha);

  const styleId = `style-${f.id}`;

  let styleBlock = "";
  let geometryBlock = "";

  if (f.type === "marker") {
    const lat = f.geometry.lat ?? 0;
    const lng = f.geometry.lng ?? 0;
    const iconUrl = f.properties?.iconUrl ?? "";
    styleBlock = `
    <Style id="${styleId}">
      <IconStyle>
        <color>${kmlColor}</color>
        ${iconUrl ? `<Icon><href>${escapeXml(iconUrl)}</href></Icon>` : ""}
      </IconStyle>
    </Style>`;
    geometryBlock = `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;
  } else if (f.type === "line") {
    const coords = coordsToString(f.geometry.coordinates ?? []);
    styleBlock = `
    <Style id="${styleId}">
      <LineStyle>
        <color>${kmlColor}</color>
        <width>${strokeWidth}</width>
      </LineStyle>
    </Style>`;
    geometryBlock = `<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>`;
  } else if (f.type === "polygon") {
    const coords = coordsToString(f.geometry.coordinates ?? []);
    styleBlock = `
    <Style id="${styleId}">
      <LineStyle>
        <color>${kmlColor}</color>
        <width>${strokeWidth}</width>
      </LineStyle>
      <PolyStyle>
        <color>${fillColor}</color>
      </PolyStyle>
    </Style>`;
    geometryBlock = `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  }

  return `${styleBlock}
    <Placemark>
      <name>${name}</name>
      <description>${desc}</description>
      <styleUrl>#${styleId}</styleUrl>
      ${geometryBlock}
    </Placemark>`;
}

function layerToFolder(layer: KmlLayer): string {
  const placemarks = layer.features.map(featureToKml).join("\n");
  return `
  <Folder>
    <name>${escapeXml(layer.name)}</name>
    ${placemarks}
  </Folder>`;
}

/** Converts a KmlMap object into a KML 2.2 XML string. */
export function toKmlString(map: KmlMap): string {
  const folders = map.layers.map(layerToFolder).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(map.name)}</name>
    ${folders}
  </Document>
</kml>`;
}
