import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const plansRoot = path.join(root, "plans");
const indexPath = path.join(plansRoot, "README.md");
const indexText = fs.readFileSync(indexPath, "utf8");

function directPlanFiles() {
  return fs
    .readdirSync(plansRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();
}

function indexedTargets() {
  const targets = [];
  for (const match of indexText.matchAll(/\]\(\.\/([^)#\s>]+\.md)(?:#[^)]*)?\)/gu)) {
    targets.push(decodeURIComponent(match[1]));
  }
  return targets;
}

const findings = [];
const directFiles = directPlanFiles();
const targets = indexedTargets();
const uniqueTargets = new Set(targets);

for (const target of targets) {
  const resolved = path.resolve(plansRoot, target);
  const relative = path.relative(plansRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    findings.push(`plans/README.md: link escapes plans/: ./${target}`);
    continue;
  }
  if (!fs.existsSync(resolved)) {
    findings.push(`plans/README.md: missing indexed target ./${target}`);
  }
}

for (const file of directFiles) {
  if (!uniqueTargets.has(file)) {
    findings.push(`plans/README.md: direct plan is not indexed ./${file}`);
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Plan index passed (${directFiles.length} direct plans, ${uniqueTargets.size} unique targets)`);
}
