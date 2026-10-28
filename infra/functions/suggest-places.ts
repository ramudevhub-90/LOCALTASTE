import { AutocompleteCommand, GeoPlacesClient } from "@aws-sdk/client-geo-places";
import type { AppSyncResolverEvent } from "aws-lambda";

const geo = new GeoPlacesClient({ region: "us-east-1" });

// AppSync resolver for suggestPlaces. Like a maps search box: any street,
// locality or landmark, worldwide.
export const handler = async (event: AppSyncResolverEvent<{ text: string }>) => {
  const text = (event.arguments.text ?? "").trim().slice(0, 120);
  if (text.length < 3) return [];
  const res = await geo.send(new AutocompleteCommand({ QueryText: text, MaxResults: 6 }));
  const labels = (res.ResultItems ?? []).map((r) => r.Address?.Label ?? r.Title).filter((l): l is string => !!l);
  return [...new Set(labels)];
};
