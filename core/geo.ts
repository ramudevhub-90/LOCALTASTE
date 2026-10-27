// Address handling with Amazon Location (geo-places). Qloo resolves cities as
// an audience but its text geocoder misreads many neighbourhoods ("Mission
// District, San Francisco" lands in Fremont), so we geocode the café's address
// ourselves and check Qloo's venues against the result.

import { GeoPlacesClient, GeocodeCommand, ReverseGeocodeCommand } from "@aws-sdk/client-geo-places";

export interface GeoPlace {
  district?: string;
  city: string;
  region?: string;
  country?: string;
  postcode?: string;
  lat: number;
  lon: number;
}

let client: GeoPlacesClient | undefined;
const geo = () => (client ??= new GeoPlacesClient({ region: process.env.GEO_REGION ?? "us-east-1" }));

export async function geocode(text: string): Promise<GeoPlace | undefined> {
  // The top match can be a same-named street elsewhere ("350 5th Ave, New
  // York" → Park Slope, Brooklyn), so prefer a match whose city the owner typed.
  const res = await geo().send(new GeocodeCommand({ QueryText: text, MaxResults: 5 }));
  const typed = squash(text);
  const items = res.ResultItems ?? [];
  const item = items.find((r) => r.Address?.Locality && typed.includes(squash(r.Address.Locality))) ?? items[0];
  const a = item?.Address;
  const [lon, lat] = item?.Position ?? [];
  if (!a?.Locality || lat === undefined || lon === undefined) return undefined;
  return {
    district: a.District ?? a.SubDistrict,
    city: a.Locality,
    region: a.Region?.Name,
    country: a.Country?.Code2,
    postcode: a.PostalCode,
    lat,
    lon,
  };
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ district?: string; city?: string } | undefined> {
  const res = await geo().send(new ReverseGeocodeCommand({ QueryPosition: [lon, lat], MaxResults: 1 }));
  const a = res.ResultItems?.[0]?.Address;
  return a ? { district: a.District ?? a.SubDistrict, city: a.Locality } : undefined;
}

// "Indira Nagar" and "Indiranagar" should match, as should "Bengaluru" and "Bangalore".
const ALIASES: Record<string, string[]> = { bengaluru: ["bangalore"], mumbai: ["bombay"], kolkata: ["calcutta"], chennai: ["madras"] };
const squash = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
export function addressHas(address: string | undefined, name: string | undefined): boolean {
  if (!address || !name) return false;
  const hay = squash(address);
  return [name, ...(ALIASES[name.toLowerCase()] ?? [])].some((n) => squash(n).length > 2 && hay.includes(squash(n)));
}
