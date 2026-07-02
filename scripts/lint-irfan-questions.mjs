#!/usr/bin/env node
import { readFileSync } from "fs";

const file = process.argv[2] ?? "/home/pi/irfan-shorts/questions_clean.json";
const errors = [];
const warnings = [];

function fail(index, message) {
  errors.push(`${label(index)} ${message}`);
}

function warn(index, message) {
  warnings.push(`${label(index)} ${message}`);
}

function label(index) {
  return index === null ? "[file]" : `[${index}]`;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function norm(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`[irfan-lint] Could not read/parse ${file}: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(data)) {
  console.error("[irfan-lint] Root JSON must be an array.");
  process.exit(1);
}

const seenQuestions = new Map();
const seenSources = new Map();

data.forEach((q, index) => {
  if (!q || typeof q !== "object" || Array.isArray(q)) {
    fail(index, "question entry must be an object");
    return;
  }

  const type = text(q.type);
  const question = text(q.question);
  const source = text(q.source);
  const url = text(q.url);
  const options = q.options;

  if (!["ranking", "vs"].includes(type)) fail(index, `unknown type "${type || "<empty>"}"`);
  if (!question) fail(index, "missing question");
  if (!source) fail(index, "missing source");
  if (url && !/^https:\/\/(www\.)?youtube\.com\/shorts\/[-\w]+/.test(url)) {
    fail(index, `unexpected url "${url}"`);
  }
  if (!Array.isArray(options)) {
    fail(index, "options must be an array");
    return;
  }

  const optionTexts = options.map(text);
  optionTexts.forEach((option, optionIndex) => {
    if (!option) fail(index, `option ${optionIndex + 1} is empty`);
    if (/^(undefined|null|nan)$/i.test(option)) fail(index, `option ${optionIndex + 1} looks malformed: "${option}"`);
  });
  const duplicateOptions = duplicates(optionTexts.map(norm));
  if (duplicateOptions.length) fail(index, `duplicate options: ${duplicateOptions.join(", ")}`);

  const questionKey = norm(question);
  if (questionKey) {
    if (seenQuestions.has(questionKey)) fail(index, `duplicate question text; first seen at ${seenQuestions.get(questionKey)}`);
    else seenQuestions.set(questionKey, index);
  }

  if (source) {
    if (seenSources.has(source)) warn(index, `source reused from ${seenSources.get(source)}`);
    else seenSources.set(source, index);
  }

  if (type === "ranking") {
    if (options.length !== 10) fail(index, `ranking must have exactly 10 options, found ${options.length}`);
  }

  if (type === "vs") {
    if (options.length !== 2) fail(index, `vs must have exactly 2 options, found ${options.length}`);
    if (!text(q.team_a)) fail(index, "vs missing team_a");
    if (!text(q.team_b)) fail(index, "vs missing team_b");
    if (!Array.isArray(q.pairs) || q.pairs.length === 0) {
      fail(index, "vs pairs must be a non-empty array");
    } else {
      q.pairs.forEach((pair, pairIndex) => {
        if (!Array.isArray(pair) || pair.length !== 2 || !text(pair[0]) || !text(pair[1])) {
          fail(index, `pair ${pairIndex + 1} must contain two non-empty entries`);
        }
      });
    }
  }
});

function duplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) dupes.add(value);
    else seen.add(value);
  }
  return [...dupes];
}

for (const warning of warnings) console.warn(`[irfan-lint] warning ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`[irfan-lint] error ${error}`);
  console.error(`[irfan-lint] FAILED: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}

console.log(`[irfan-lint] OK: ${data.length} questions, ${warnings.length} warning(s).`);
