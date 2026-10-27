# Localtaste: Devpost submission text

**Tagline (≤ 200 chars):** Market research for the café on the corner: an agent that reads the neighbourhood's taste through Qloo and turns it into dishes, a playlist and theme nights to run this month.

**Demo:** https://localtaste.revenuerush.in (no sign-up; the form is pre-filled, press *Get taste advice*)
**Code:** https://github.com/ramudevhub-90/LOCALTASTE (MIT)

---

## Inspiration

A chain opening a branch commissions market research. The independent café owner down the road (most of the world's cafés) guesses: copies whatever the place next door serves, plays their own playlist, runs the same quiz night as everyone else. Qloo knows what a neighbourhood's people actually love across food, music, film and brands. We wanted to put that in the hands of the owner who can't afford a consultant, in a form they can act on the same week.

## What it does

Enter the café's address and current menu (and, optionally, the café's name). In about 30 seconds Localtaste returns:

- **A taste map** of the neighbourhood: its favourite venues (with Qloo's photos and descriptions), the food concepts and crowd "vibe" those venues share, and the city's favourite artists, TV shows and brands.
- **Suggestions from an agent**: three menu additions the current menu doesn't cover, an in-store playlist (with Spotify links), and two theme nights pairing a show or artist with food. Every card has a **Why it fits** line built from real Qloo results and a **Why this?** panel showing the exact Qloo calls.
- **Your café vs the neighbourhood**: where the café ranks among the local favourites for fit with the city's taste, and how its crowd's age and gender skew differs from the area's.
- **Ask the agent** follow-up questions: *Why not pizza? Ideas under ₹150 a plate? What works for weekday mornings?* It answers with fresh Qloo lookups.
- **Next-branch finder**: the parts of the city where the neighbourhood's favourite venues are also popular.
- **Competitor check**: a rival's standing, the audience traits it shares with you, and its crowd next to the area's.
- **Act on it**: a 4-week calendar file (theme nights on Fridays, menu launches on Mondays), copy as text, print.

It works in any city Qloo covers: Bengaluru, Brooklyn, San Francisco, London, Los Angeles and more. Everything describes aggregate neighbourhood affinities, never individuals.

## How we built it

- **Qloo** via the official `@qloo/qloo-harness` workflow executor, running in-process in AWS Lambda. Localtaste uses **eight of Qloo's nine workflows**: `recommend` (city audience + neighbourhood filter), `entity_tags`, `find_tags`, `rank`, `audience_demographics`, `where_popular`, `describe` and `compare_audiences`. Area data is cached for 7 days in DynamoDB to respect the quota.
- **The agent** runs on **Amazon Bedrock (Amazon Nova 2 Lite)** through the model-neutral Converse API, with Qloo workflows as tools. It gets the area's signals up front, each with an id, then makes 2–5 follow-up `recommend` calls of its own (places that fans of a top artist favour, artists that fans of a favourite venue like, shows for theme nights) before submitting suggestions through a structured tool.
- **Guardrails in code**: each suggestion must cite the right kind of evidence (menu → food or venue, playlist → music, theme night → its show or artist). A weak submission is sent back once, and only missing kinds are filled from a deterministic writer. The *Why it fits* sentence is generated from the cited Qloo results, not the model's prose, so it can't overclaim.
- **Amazon Location** geocodes the address so Qloo is asked about the right neighbourhood and city, and names the cells of Qloo's heatmaps for the branch finder.
- **Serverless AWS with Amplify Gen 2**: Cognito guest access, AppSync with subscriptions streaming the agent's progress, SQS (agent runs outlast resolver timeouts), Lambda, DynamoDB, per-visitor rate limits. Bedrock is reached with an invoke-only cross-account IAM role, with no API keys anywhere.
- **Front end**: React + Vite, a café-dashboard design with light/dark themes and a print layout.

## Challenges we ran into

- **Neighbourhoods vs cities.** Qloo resolves cities as an audience but not neighbourhoods, and its text geocoder sometimes misreads them ("Mission District, San Francisco" landed in Fremont). We geocode the address ourselves, ask Qloo with the right names, and check each venue's address against the city and postcode.
- **Saturated scores.** City-level affinity is ~1.0 for every popular venue, so ranking a café against "Bengaluru" says nothing. Ranking by fit with the city's own favourite artists and shows gave a real spread.
- **Keeping a small model honest.** Nova would cite ids loosely, skip the deeper Qloo work, or credit a venue with a dish it doesn't serve. We moved the checks into code: id matching, a nudge to dig deeper, evidence-kind rules, and reasons written from data. We fed Qloo's own venue descriptions into follow-up answers.
- **Model access.** Our first account had no Bedrock quota at all; we compared Nova Pro, Nova 2 Lite and Llama 4 Maverick side by side on the same areas and chose Nova 2 Lite (most Qloo follow-ups, most specific dishes, same speed).

## Accomplishments that we're proud of

- An agent whose every claim is traceable: each suggestion lists the Qloo calls behind it, and the reasons are built from the data.
- Eight Qloo workflows working together in one owner-friendly flow, in any Qloo-covered city.
- Fully serverless, keyless and rate-limited, so it's safe to leave open as a public demo.

## What we learned

Qloo is at its best when its signals are chained: a neighbourhood's venues lead to their audience's other tastes, which lead to concrete dishes, playlists and nights out. Agents with small models work best when the code owns correctness and the model owns judgement and wording.

## What's next for Localtaste

- Weekly refresh with a "what changed in your neighbourhood" email.
- Saved cafés and plans for signed-in owners, with results tracked against the calendar.
- Supplier and price hints for suggested dishes, and WhatsApp sharing for owners who live on their phones.

## Built with

qloo · amazon-bedrock · amazon-nova · aws-amplify · aws-appsync · aws-lambda · amazon-sqs · amazon-dynamodb · amazon-cognito · amazon-location-service · react · vite · typescript

## Testing instructions

1. Open https://localtaste.revenuerush.in. No sign-up is needed.
2. The form is pre-filled (Indiranagar, Bengaluru, a sample menu, and the café *Glens Bakehouse*). Press **Get taste advice** and watch the agent's steps; results arrive in about 30 seconds.
3. Try **Why this?** on a card, **Ask the agent** (tap a suggested question), **Find matching areas**, and **Check a competitor** (e.g. *Third Wave Coffee*).
4. Try other cities, e.g. *Williamsburg, Brooklyn, NY* or *Shoreditch, London*, with your own menu.
5. Runs are limited to 15 per visitor per hour to protect the shared Qloo quota.
