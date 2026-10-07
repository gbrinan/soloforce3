import type { FeatureRow, LayerRow } from './supabase';

function esc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function coords2d(cs: [number, number][]) {
  return cs.map(([lng, lat]) => `${lng},${lat},0`).join(' ');
}

function hexToKmlColor(hex: string): string {
  const h = hex.replace('#', '').padStart(6, '0');
  // KML color = AABBGGRR
  return `ff${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}

function placemark(f: FeatureRow): string {
  const name = esc(f.properties.name ?? '');
  const desc = esc(f.properties.description ?? '');
  const kmlColor = hexToKmlColor(f.properties.color ?? '#6366F1');

  let geo = '';
  if (f.type === 'marker' && f.geometry.type === 'Point') {
    const [lng, lat] = f.geometry.coordinates;
    geo = `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;
  } else if (f.type === 'line' && f.geometry.type === 'LineString') {
    geo = `<LineString><tessellate>1</tessellate><coordinates>${coords2d(f.geometry.coordinates)}</coordinates></LineString>`;
  } else if (f.type === 'polygon' && f.geometry.type === 'Polygon') {
    geo = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords2d(f.geometry.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  }

  return `    <Placemark>
      <name>${name}</name>
      <description><![CDATA[${f.properties.description ?? ''}]]></description>
      <Style>
        <IconStyle><color>${kmlColor}</color></IconStyle>
        <LineStyle><color>${kmlColor}</color><width>3</width></LineStyle>
        <PolyStyle><color>4d${kmlColor.slice(2)}</color></PolyStyle>
      </Style>
      ${geo}
    </Placemark>`;
}

export function toKML(mapName: string, layers: LayerRow[], features: FeatureRow[]): string {
  const folders = layers
    .map((layer) => {
      const lf = features.filter((f) => f.layer_id === layer.id);
      return `  <Folder>
    <name>${esc(layer.name)}</name>
    <visibility>${layer.visible ? 1 : 0}</visibility>
${lf.map(placemark).join('\n')}
  </Folder>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${esc(mapName)}</name>
${folders}
</Document>
</kml>`;
}

export function downloadKML(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/vnd.google-earth.kml+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename.replace(/[^\w가-힣]/g, '_')}.kml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
