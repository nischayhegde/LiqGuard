import { PRICE_SERVICE_URL, PYTH_PRICE_FEEDS } from "./config";
import { UnderlyingSymbol } from "./helpers";

export interface OraclePrice {
  price: number; // price in USD
  conf: number;
  expo: number;
  rawPrice: number;
  publishTime: number;
}

export async function fetchPythPrice(
  asset: UnderlyingSymbol
): Promise<OraclePrice> {
  const feedId = PYTH_PRICE_FEEDS[asset];
  if (!feedId) {
    throw new Error(`No Pyth feed configured for asset ${asset}`);
  }

  const url = `${PRICE_SERVICE_URL}/v2/updates/price/latest?ids[]=${feedId}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch price from Pyth: HTTP ${response.status}`
    );
  }

  const data = await response.json();
  const entry = Array.isArray(data) ? data[0] : undefined;

  if (!entry || !entry.price) {
    throw new Error("Malformed Pyth response");
  }

  const rawPrice = entry.price.price as number;
  const expo = entry.price.expo as number;
  const conf = entry.price.conf as number;
  const publishTime = entry.price.publish_time as number;

  const price = rawPrice * 10 ** expo;

  return { price, conf, expo, rawPrice, publishTime };
}
