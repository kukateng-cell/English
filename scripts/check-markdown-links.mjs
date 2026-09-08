import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();

function trackedMarkdownFiles() {
  const output = execFileSync("git", ["ls-files", "--", "*.md"], { encoding: "utf8" });
  return output.split(/\r?\n/u).filter(Boolean);
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/`[^`]*`/gu, "");
}

function headingSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/gu, "")
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~]/gu, "")
    .replace(/\s+/gu, "-");
}

function headingSlugs(text) {
  const slugs = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)) {
    const slug = headingSlug(match[1]);
    if (!slug) continue;
    let unique = slug;
    let suffix = 1;
    while (slugs.has(unique)) unique = `${slug}-${suffix++}`;
    slugs.add(unique);
  }
  return slugs;
}

function parseTarget(rawTarget) {
  const trimmed = rawTarget.trim().replace(/^<|>$/gu, "");
  const hashIndex = trimmed.indexOf("#");
  return hashIndex < 0
    ? { file: trimmed, anchor: null }
    : { file: trimmed.slice(0, hashIndex), anchor: trimmed.slice(hashIndex + 1) };
}

const findings = [];
for (const relativeSource of trackedMarkdownFiles()) {
  const sourcePath = path.resolve(root, relativeSource);
  const source = fs.readFileSync(sourcePath, "utf8");
  const visibleSource = stripMarkdown(source);
  for (const match of visibleSource.matchAll(/\]\(([^)\n]+)\)/gu)) {
    const target = parseTarget(match[1]);
    if (!target.file || /^(?:https?:|mailto:|#|data:|codex:)/iu.test(target.file)) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(target.file);
    } catch {
      findings.push(`${relativeSource}: invalid encoded link target ${target.file}`);
      continue;
    }
    const targetPath = path.resolve(path.dirname(sourcePath), decoded);
    const relativeTarget = path.relative(root, targetPath);
    if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      findings.push(`${relativeSource}: link escapes repository ${target.file}`);
      continue;
    }
    if (!fs.existsSync(targetPath)) {
      findings.push(`${relativeSource}: missing target ${target.file}`);
      continue;
    }
    if (target.anchor && path.extname(targetPath).toLowerCase() === ".md") {
      const anchors = headingSlugs(fs.readFileSync(targetPath, "utf8"));
      if (!anchors.has(target.anchor.toLowerCase())) {
        findings.push(`${relativeSource}: missing anchor ${target.file}#${target.anchor}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Markdown local links passed (${trackedMarkdownFiles().length} files checked)`);
}
