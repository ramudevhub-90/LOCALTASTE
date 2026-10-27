// Hand-written sample data shaped like Qloo `recommend` results with
// `signal_location`. Used until the event API key arrives (QLOO_MODE=sample).
// Numbers are illustrative, not real Qloo output; the UI labels them as sample.

import type { AreaTaste, Domain, QlooSource, TasteSignal } from "./types.ts";

type Row = [name: string, affinity: number, lift: number, tags: string[]];
type SampleDomain = Exclude<Domain, "vibe">;
type Profile = { label: string; aliases: string[] } & Record<SampleDomain, Row[]>;

const TARGET_TYPE: Record<SampleDomain, string> = {
  dining: "urn:entity:place",
  music: "urn:entity:artist",
  film_tv: "urn:entity:tv_show",
  brand: "urn:entity:brand",
};

const PROFILES: Record<string, Profile> = {
  indiranagar: {
    label: "Indiranagar, Bengaluru",
    aliases: ["indiranagar", "100 feet road", "12th main", "hal 2nd stage"],
    dining: [
      ["Craft beer & brewpub", 0.91, 2.1, ["brewpub", "bar"]],
      ["Korean street food", 0.84, 2.4, ["korean", "street food"]],
      ["Specialty pour-over coffee", 0.82, 1.7, ["coffee", "third wave"]],
      ["Neapolitan pizza", 0.74, 1.5, ["italian", "pizza"]],
      ["Brunch & eggs", 0.71, 1.6, ["brunch", "breakfast"]],
      ["Vegan desserts", 0.58, 1.9, ["vegan", "dessert"]],
    ],
    music: [
      ["Prateek Kuhad", 0.88, 2.2, ["indie", "singer-songwriter"]],
      ["The Local Train", 0.8, 1.9, ["hindi rock", "indie"]],
      ["NewJeans", 0.77, 2.6, ["k-pop"]],
      ["Khruangbin", 0.69, 2.0, ["psychedelic", "chill"]],
      ["Anuv Jain", 0.66, 1.8, ["indie pop"]],
    ],
    film_tv: [
      ["Crash Landing on You", 0.86, 2.7, ["k-drama", "romance"]],
      ["Panchayat", 0.79, 1.4, ["indian web series", "comedy"]],
      ["The Bear", 0.72, 2.3, ["food", "drama"]],
      ["Squid Game", 0.68, 1.9, ["k-drama", "thriller"]],
    ],
    brand: [
      ["Blue Tokai", 0.83, 2.0, ["coffee"]],
      ["Bira 91", 0.78, 1.8, ["beer"]],
      ["Nykaa", 0.66, 1.3, ["beauty"]],
      ["Decathlon", 0.61, 1.2, ["sports"]],
    ],
  },
  koramangala: {
    label: "Koramangala, Bengaluru",
    aliases: ["koramangala", "5th block", "forum mall", "sony signal"],
    dining: [
      ["Korean fried chicken", 0.87, 2.5, ["korean", "fried chicken"]],
      ["Momos & Northeast Indian", 0.85, 2.2, ["tibetan", "northeast indian"]],
      ["Bubble tea", 0.81, 2.8, ["taiwanese", "tea"]],
      ["Late-night biryani", 0.79, 1.4, ["biryani", "late night"]],
      ["Specialty pour-over coffee", 0.75, 1.6, ["coffee", "third wave"]],
      ["Poke & grain bowls", 0.62, 1.9, ["healthy", "bowls"]],
    ],
    music: [
      ["BTS", 0.86, 2.9, ["k-pop"]],
      ["Ritviz", 0.81, 2.1, ["indian electronic"]],
      ["Seedhe Maut", 0.76, 2.4, ["desi hip hop"]],
      ["Arijit Singh", 0.74, 1.1, ["bollywood"]],
      ["Lofi Girl", 0.63, 1.7, ["lofi", "study"]],
    ],
    film_tv: [
      ["Jujutsu Kaisen", 0.84, 3.1, ["anime"]],
      ["Business Proposal", 0.8, 2.6, ["k-drama", "romcom"]],
      ["TVF Pitchers", 0.77, 2.2, ["startup", "comedy"]],
      ["Kota Factory", 0.7, 1.8, ["indian web series"]],
    ],
    brand: [
      ["Third Wave Coffee", 0.8, 1.9, ["coffee"]],
      ["boAt", 0.74, 1.6, ["audio"]],
      ["Zomato", 0.72, 1.3, ["food delivery"]],
      ["Bewakoof", 0.6, 1.7, ["streetwear"]],
    ],
  },
  jayanagar: {
    label: "Jayanagar, Bengaluru",
    aliases: ["jayanagar", "4th block", "south end circle"],
    dining: [
      ["Filter coffee & darshini tiffin", 0.93, 2.0, ["south indian", "breakfast"]],
      ["Masala dosa", 0.9, 1.8, ["south indian"]],
      ["Chaats & street snacks", 0.81, 1.6, ["chaat", "street food"]],
      ["Traditional sweets", 0.76, 1.9, ["mithai", "dessert"]],
      ["Udupi vegetarian meals", 0.74, 2.1, ["vegetarian", "thali"]],
      ["Ice cream parlours", 0.6, 1.4, ["dessert"]],
    ],
    music: [
      ["Sanjith Hegde", 0.82, 2.6, ["kannada", "playback"]],
      ["Bombay Jayashri", 0.77, 2.8, ["carnatic"]],
      ["Vijay Prakash", 0.74, 2.3, ["kannada", "playback"]],
      ["A. R. Rahman", 0.72, 1.2, ["film score"]],
      ["Raghu Dixit Project", 0.67, 2.4, ["kannada folk rock"]],
    ],
    film_tv: [
      ["Kantara", 0.88, 2.9, ["kannada film"]],
      ["KGF: Chapter 2", 0.84, 2.2, ["kannada film", "action"]],
      ["Sapta Saagaradaache Ello", 0.73, 2.7, ["kannada film", "romance"]],
      ["Malgudi Days", 0.62, 2.5, ["classic tv"]],
    ],
    brand: [
      ["MTR Foods", 0.84, 2.4, ["packaged food"]],
      ["Nandini", 0.8, 2.0, ["dairy"]],
      ["Titan", 0.64, 1.3, ["watches"]],
      ["Amazon", 0.6, 1.0, ["e-commerce"]],
    ],
  },
  hsr: {
    label: "HSR Layout, Bengaluru",
    aliases: ["hsr", "hsr layout", "agara", "27th main"],
    dining: [
      ["Protein & salad bowls", 0.86, 2.4, ["healthy", "bowls"]],
      ["Specialty pour-over coffee", 0.8, 1.7, ["coffee", "third wave"]],
      ["Andhra meals", 0.76, 1.8, ["andhra", "spicy"]],
      ["Japanese ramen", 0.7, 2.2, ["japanese", "noodles"]],
      ["Cold-pressed juice", 0.66, 2.1, ["juice", "healthy"]],
      ["Late-night biryani", 0.64, 1.2, ["biryani", "late night"]],
    ],
    music: [
      ["Diljit Dosanjh", 0.8, 1.6, ["punjabi pop"]],
      ["Prateek Kuhad", 0.74, 1.8, ["indie"]],
      ["The Weeknd", 0.71, 1.5, ["r&b", "pop"]],
      ["Anirudh Ravichander", 0.7, 1.7, ["tamil", "playback"]],
      ["Lofi Girl", 0.62, 1.9, ["lofi", "study"]],
    ],
    film_tv: [
      ["Attack on Titan", 0.78, 2.6, ["anime"]],
      ["Shark Tank India", 0.76, 2.3, ["startup", "reality"]],
      ["Ted Lasso", 0.66, 2.0, ["sports", "comedy"]],
      ["Queen of Tears", 0.64, 2.1, ["k-drama"]],
    ],
    brand: [
      ["Cult.fit", 0.85, 2.7, ["fitness"]],
      ["The Whole Truth", 0.72, 2.8, ["health food"]],
      ["Ather", 0.68, 2.5, ["electric scooters"]],
      ["Swiggy Instamart", 0.66, 1.4, ["quick commerce"]],
    ],
  },
  malleshwaram: {
    label: "Malleshwaram, Bengaluru",
    aliases: ["malleshwaram", "malleswaram", "sampige road", "8th cross"],
    dining: [
      ["Heritage vegetarian tiffin", 0.92, 2.5, ["south indian", "vegetarian"]],
      ["Filter coffee & darshini tiffin", 0.89, 1.9, ["south indian", "breakfast"]],
      ["Holige & traditional sweets", 0.8, 2.6, ["mithai", "dessert"]],
      ["Bakery puffs & tea", 0.72, 1.7, ["bakery", "tea"]],
      ["Chaats & street snacks", 0.7, 1.4, ["chaat", "street food"]],
    ],
    music: [
      ["M. S. Subbulakshmi", 0.84, 3.2, ["carnatic"]],
      ["Bombay Jayashri", 0.8, 2.9, ["carnatic"]],
      ["Ilaiyaraaja", 0.75, 1.8, ["film score"]],
      ["Sanjith Hegde", 0.66, 1.9, ["kannada", "playback"]],
    ],
    film_tv: [
      ["Malgudi Days", 0.83, 3.4, ["classic tv"]],
      ["Kantara", 0.8, 2.4, ["kannada film"]],
      ["Bangalore Days", 0.66, 1.8, ["malayalam film"]],
      ["Gullak", 0.64, 1.9, ["family", "indian web series"]],
    ],
    brand: [
      ["MTR Foods", 0.86, 2.6, ["packaged food"]],
      ["Mysore Sandal Soap", 0.79, 3.0, ["heritage"]],
      ["Nandini", 0.77, 1.9, ["dairy"]],
      ["Tanishq", 0.63, 1.5, ["jewellery"]],
    ],
  },
  whitefield: {
    label: "Whitefield, Bengaluru",
    aliases: ["whitefield", "itpl", "brookefield", "phoenix marketcity"],
    dining: [
      ["North Indian & tandoor", 0.84, 1.6, ["north indian", "tandoor"]],
      ["Pan-Asian buffet", 0.76, 1.8, ["asian", "buffet"]],
      ["Burgers & shakes", 0.74, 1.5, ["american", "burger"]],
      ["Specialty pour-over coffee", 0.69, 1.3, ["coffee", "third wave"]],
      ["Mexican bowls", 0.61, 1.9, ["mexican"]],
    ],
    music: [
      ["Diljit Dosanjh", 0.85, 1.9, ["punjabi pop"]],
      ["Taylor Swift", 0.76, 1.6, ["pop"]],
      ["Pritam", 0.74, 1.2, ["bollywood"]],
      ["Coldplay", 0.72, 1.7, ["pop rock"]],
    ],
    film_tv: [
      ["Friends", 0.8, 1.9, ["sitcom"]],
      ["Mirzapur", 0.74, 1.4, ["indian web series", "crime"]],
      ["Oppenheimer", 0.7, 1.6, ["hollywood"]],
      ["The Office", 0.68, 1.8, ["sitcom"]],
    ],
    brand: [
      ["Starbucks", 0.82, 1.8, ["coffee"]],
      ["Decathlon", 0.74, 1.5, ["sports"]],
      ["IKEA", 0.7, 2.2, ["home"]],
      ["Uniqlo", 0.64, 2.0, ["apparel"]],
    ],
  },
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function matchProfile(location: string): Profile | undefined {
  const q = location.toLowerCase();
  return Object.values(PROFILES).find((p) => p.aliases.some((a) => q.includes(a)));
}

// Unknown addresses get a deterministic blend so any input still demos.
function blendProfile(location: string): Profile {
  const keys = Object.keys(PROFILES);
  let h = 0;
  for (const ch of location) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const p1 = PROFILES[keys[h % keys.length]];
  const p2 = PROFILES[keys[(h >>> 8) % keys.length]];
  const mix = (d: SampleDomain): Row[] => {
    const seen = new Set<string>();
    return [...p1[d].slice(0, 3), ...p2[d].slice(0, 3)]
      .filter(([n]) => !seen.has(n) && seen.add(n))
      .map(([n, a, l, t]) => [n, Math.round(a * 0.9 * 100) / 100, Math.round(l * 0.85 * 10) / 10, t]);
  };
  return { label: location.trim(), aliases: [], dining: mix("dining"), music: mix("music"), film_tv: mix("film_tv"), brand: mix("brand") };
}

export const sampleSource: QlooSource = {
  mode: "sample",
  async areaTaste(location: string): Promise<AreaTaste> {
    const profile = matchProfile(location) ?? blendProfile(location);
    const signals: TasteSignal[] = [];
    for (const domain of Object.keys(TARGET_TYPE) as SampleDomain[]) {
      for (const [name, affinity, lift, tags] of profile[domain]) {
        signals.push({
          id: `${domain}:${slug(name)}`,
          name,
          domain,
          affinity,
          lift,
          tags,
          evidence: {
            operation: "recommend",
            input: { target_type: TARGET_TYPE[domain], signal_location: profile.label, limit: 10 },
            source: "sample",
          },
        });
      }
    }
    return { query: location, label: profile.label, city: "Bengaluru", source: "sample", signals };
  },
};

export const SAMPLE_AREAS = Object.values(PROFILES).map((p) => p.label);
