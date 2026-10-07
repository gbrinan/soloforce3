import { createClient } from '@supabase/supabase-js';

export type MapRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type LayerRow = {
  id: string;
  map_id: string;
  name: string;
  visible: boolean;
  order: number;
};

export type FeatureType = 'marker' | 'line' | 'polygon';

export type FeatureProperties = {
  name?: string;
  address?: string;
  description?: string;
  color?: string;
  icon?: string;
  photo_url?: string;
  // Line-specific
  weight?: number;
  dash?: boolean;
  // Polygon-specific
  fill_opacity?: number;
  stroke_color?: string;
};

export type FeatureGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] };

export type FeatureRow = {
  id: string;
  layer_id: string;
  order: number;
  type: FeatureType;
  geometry: FeatureGeometry;
  properties: FeatureProperties;
};

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
