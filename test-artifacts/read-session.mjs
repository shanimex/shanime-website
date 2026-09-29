import fs from "node:fs";
const file = process.argv[2];
const needle = process.argv[3] || "";
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
let n = 0;
for (const line of lines) {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    continue;
  }
  const role = m.role || "";
  const name = m.name || "";
  let text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  if (m.toolCalls) text += " TOOLCALLS:" + JSON.stringify(m.toolCalls).slice(0, 600);
  if (needle && !(text || "").toLowerCase().includes(needle.toLowerCase())) continue;
  n += 1;
  console.log(`--- [${n}] ${role} ${name} ---`);
  console.log((text || "").slice(0, 1500));
}
console.log("total lines", lines.length);
