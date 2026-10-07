// Open Food Facts v2 — 바코드로 식품 정보 조회 (No-auth, 무료).
// 공식: https://world.openfoodfacts.org/data
// 엔드포인트: GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json
// 미발견(status:0 또는 404)은 정상 흐름으로 null 반환. 기타 4xx/5xx 및 네트워크/파싱 오류는 throw.

const BASE_URL = "https://world.openfoodfacts.org/api/v2/product";
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "mycrew-poc/1.0";

export interface OpenFoodFactsProduct {
  code: string;
  productName?: string;
  brands?: string;
  ingredientsText?: string;
  allergens?: string;
  nutriments?: Record<string, unknown>;
}

interface OffApiResponse {
  status: number;
  code: string;
  product?: {
    product_name?: string;
    brands?: string;
    ingredients_text?: string;
    allergens?: string;
    nutriments?: Record<string, unknown>;
  };
}

export async function getProductByBarcode(barcode: string): Promise<OpenFoodFactsProduct | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(barcode)}.json`, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`open-food-facts status=${res.status}`);
    const data = (await res.json()) as OffApiResponse;
    if (data.status === 0 || !data.product) return null;
    return {
      code: data.code,
      productName: data.product.product_name,
      brands: data.product.brands,
      ingredientsText: data.product.ingredients_text,
      allergens: data.product.allergens,
      nutriments: data.product.nutriments,
    };
  } finally {
    clearTimeout(timer);
  }
}
