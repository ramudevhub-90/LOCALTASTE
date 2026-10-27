// Narration for the Localtaste demo video, in three parts:
//   INTRO / OUTRO — explainer scenes (scene = index in explainer.html)
//   DEMO          — the live app, one beat per action in build.mjs
// Every line is read aloud (Amazon Polly) and shown as a caption.

export const VOICE = { engine: "polly", name: "Ruth", polly: "generative", fallback: { name: "Joanna", polly: "neural" } };

export const INTRO = [
  {
    scene: 0,
    text: "This is Localtaste. It gives independent café owners the kind of market research that only chains can usually afford, using Qloo's taste graph.",
  },
  {
    scene: 1,
    text: "Before a chain opens a branch, it studies the neighbourhood. The owner of the café on the corner has to guess: what to add to the menu, what to play, and which nights to run.",
  },
  {
    scene: 2,
    text: "Localtaste pins down the neighbourhood with Amazon Location, maps its taste with Qloo, and hands that to an agent on Amazon Bedrock, which digs deeper with Qloo's own tools.",
  },
  {
    scene: 3,
    text: "Every idea has to cite the Qloo signals behind it, and its reason is written from that data, so the agent can't overclaim. And it always describes neighbourhoods, never individuals.",
  },
];

// Each beat runs an action in the live app, then holds while its line is read.
export const DEMO = [
  {
    id: "home",
    text: "Here's the live app. There's no sign-up. An owner starts with the café's address.",
  },
  {
    id: "address",
    text: "Type any address, like on a map: a street, a small locality, or a town in the US. Suggestions appear as you type. We'll pick Indiranagar in Bengaluru, with the café's menu and its name already filled in.",
  },
  {
    id: "building",
    text: "The agent's steps stream in while it works. First it maps the area. Then it checks its own leads with Qloo, like the places that fans of a favourite local venue also love, and the shows the city's audience watches.",
  },
  {
    id: "map",
    text: "The taste map shows Indiranagar's favourite venues, with Qloo's photos and descriptions, and what Bengaluru's audience loves in music, film and brands.",
  },
  {
    id: "cafe",
    text: "Glens Bakehouse ranks among seven local favourites for fit with the city's taste. And the crowd chart shows who the area's people are, next to the café's own crowd.",
  },
  {
    id: "suggestions",
    text: "Then the plan: dishes the menu doesn't cover yet, an in-store playlist, and theme nights built on shows the area loves.",
  },
  {
    id: "why",
    text: "Every card says why it fits, from real Qloo results. And Why this shows the exact Qloo calls behind it.",
  },
  {
    id: "act",
    text: "One click turns the plan into a four-week calendar, with theme nights on Fridays and menu launches on Mondays. Or copy it, or print it.",
  },
  {
    id: "ask",
    text: "Owners can ask follow-up questions. Why not pizza? The agent checks Qloo again, reads what the local favourites actually serve, and answers from the data.",
  },
  {
    id: "branch",
    text: "Thinking about a second branch? Qloo's heatmaps show where in Bengaluru Indiranagar's favourite venues are also popular.",
  },
  {
    id: "rival",
    text: "And a competitor check shows the audience traits a rival shares with you, and how its crowd compares.",
  },
];

export const OUTRO = [
  {
    scene: 4,
    text: "It works in any city Qloo covers, from Brooklyn and San Francisco to London and Bengaluru. Under the hood: eight of Qloo's nine workflows, Amazon Nova on Bedrock with no API keys, and a serverless AWS backend.",
  },
  {
    scene: 5,
    text: "Localtaste. Market research for the café on the corner. Try it at localtaste dot revenuerush dot in.",
  },
];
