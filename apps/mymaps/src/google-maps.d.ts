// Minimal Google Maps ambient declarations — covers usages in GoogleMapBody.tsx
// Full types available once @types/google.maps is installed in non-production env.
declare namespace google {
  namespace maps {
    type MapTypeId = string;

    interface LatLng {
      lat(): number;
      lng(): number;
    }

    interface MapMouseEvent {
      latLng: LatLng | null;
    }

    interface MapsEventListener {
      remove(): void;
    }

    class Size {
      constructor(width: number, height: number, widthUnit?: string, heightUnit?: string);
      width: number;
      height: number;
    }

    class Point {
      constructor(x: number, y: number);
      x: number;
      y: number;
    }

    interface MarkerIcon {
      url?: string;
      path?: SymbolPath | string;
      scale?: number;
      fillColor?: string;
      fillOpacity?: number;
      strokeColor?: string;
      strokeWeight?: number;
      scaledSize?: Size;
      anchor?: Point;
      icons?: unknown[];
    }

    interface MapOptions {
      center?: { lat: number; lng: number } | LatLng;
      zoom?: number;
      mapTypeId?: MapTypeId;
      fullscreenControl?: boolean;
      streetViewControl?: boolean;
      mapTypeControl?: boolean;
    }

    class Map {
      constructor(container: Element, opts?: MapOptions);
      addListener(event: string, handler: (e: MapMouseEvent) => void): MapsEventListener;
      addListener(event: string, handler: () => void): MapsEventListener;
      setMapTypeId(type: MapTypeId): void;
      panTo(latLng: { lat: number; lng: number } | LatLng): void;
      setZoom(zoom: number): void;
      getZoom(): number | undefined;
    }

    interface InfoWindowOptions {
      content?: string | Element;
      maxWidth?: number;
    }

    class InfoWindow {
      constructor(opts?: InfoWindowOptions);
      setContent(content: string | Element): void;
      open(map?: Map, anchor?: Marker): void;
      close(): void;
      addListener(event: string, handler: () => void): MapsEventListener;
    }

    interface MarkerOptions {
      position?: { lat: number; lng: number } | LatLng;
      map?: Map;
      icon?: MarkerIcon | string;
      optimized?: boolean;
      title?: string;
    }

    enum Animation {
      BOUNCE = 1,
      DROP = 2,
    }

    class Marker {
      constructor(opts?: MarkerOptions);
      setMap(map: Map | null): void;
      setIcon(icon: MarkerIcon | string): void;
      setAnimation(animation: Animation | null): void;
      addListener(event: string, handler: () => void): MapsEventListener;
    }

    interface PolylineOptions {
      path?: Array<{ lat: number; lng: number } | LatLng>;
      map?: Map;
      geodesic?: boolean;
      strokeColor?: string;
      strokeOpacity?: number;
      strokeWeight?: number;
      editable?: boolean;
      icons?: unknown[];
    }

    class Polyline {
      constructor(opts?: PolylineOptions);
      setMap(map: Map | null): void;
      getPath(): { getArray(): LatLng[] };
      setPath(path: Array<{ lat: number; lng: number } | LatLng>): void;
    }

    interface PolygonOptions {
      paths?: Array<{ lat: number; lng: number } | LatLng>;
      map?: Map;
      strokeColor?: string;
      strokeWeight?: number;
      fillColor?: string;
      fillOpacity?: number;
      editable?: boolean;
    }

    class Polygon {
      constructor(opts?: PolygonOptions);
      setMap(map: Map | null): void;
      getPath(): { getArray(): LatLng[] };
    }

    enum SymbolPath {
      CIRCLE = 0,
      BACKWARD_CLOSED_ARROW = 3,
      FORWARD_CLOSED_ARROW = 5,
      BACKWARD_OPEN_ARROW = 4,
      FORWARD_OPEN_ARROW = 6,
    }

    namespace drawing {
      enum OverlayType {
        POLYLINE = 'polyline',
        POLYGON = 'polygon',
        MARKER = 'marker',
        RECTANGLE = 'rectangle',
        CIRCLE = 'circle',
      }

      interface DrawingManagerOptions {
        drawingMode?: OverlayType | null;
        drawingControl?: boolean;
        polylineOptions?: PolylineOptions;
        polygonOptions?: PolygonOptions;
      }

      class DrawingManager {
        constructor(opts?: DrawingManagerOptions);
        setMap(map: Map | null): void;
        setDrawingMode(mode: OverlayType | null): void;
        addListener(event: 'polylinecomplete', handler: (pl: Polyline) => void): MapsEventListener;
        addListener(event: 'polygoncomplete', handler: (pg: Polygon) => void): MapsEventListener;
        addListener(event: string, handler: (...args: unknown[]) => void): MapsEventListener;
      }
    }
  }
}
