// Quick local check of the sample Qloo module and the template agent.
import { analyze } from "../core/agent.ts";
import { compareAreas, getAreaTaste, qlooMode } from "../core/qloo/index.ts";

const area = await getAreaTaste("12th Main, Indiranagar");
const { suggestions } = analyze(area, ["Cappuccino", "Pour-over coffee", "Croissant"]);
const cmp = await compareAreas("Indiranagar", "Jayanagar");
console.log(`qloo=${qlooMode()} area=${area.label} signals=${area.signals.length} suggestions=${suggestions.length} onlyA=${cmp.onlyA.length} onlyB=${cmp.onlyB.length}`);
if (!suggestions.length || !cmp.onlyA.length) process.exit(1);
