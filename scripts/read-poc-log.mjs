import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const localLog = "C:\\Users\\Lokesh\\AI work\\.cursor\\poc-events.ndjson";
const tempLog = path.join(os.tmpdir(), "aiwork-hook-poc.ndjson");

let logFile = localLog;
if (!fs.existsSync(localLog) && fs.existsSync(tempLog)) {
  logFile = tempLog;
}

if (!fs.existsSync(logFile)) {
  console.log("No log file found yet at:");
  console.log(" -", localLog);
  console.log(" -", tempLog);
  console.log("\nSend a prompt in Cursor Agent (Composer) first, then rerun this script.");
  process.exit(0);
}

const content = fs.readFileSync(logFile, "utf8").trim();
if (!content) {
  console.log("Log file is empty:", logFile);
  process.exit(0);
}

const lines = content.split("\n").filter(Boolean);
console.log(`\n========================================================`);
console.log(`   Cursor Agent Hook Captures (${lines.length} events logged)`);
console.log(`   Source: ${logFile}`);
console.log(`========================================================\n`);

for (let i = 0; i < lines.length; i++) {
  try {
    const entry = JSON.parse(lines[i]);
    console.log(`[#${i + 1}] Hook: ${entry.hookName} | Time: ${entry.receivedAt}`);
    if (entry.parseError) {
      console.log(`     JSON Parse Error: ${entry.parseError}`);
    }
    const p = entry.payload;
    if (p) {
      if (p.hook_event_name) console.log(`     event_name:      ${p.hook_event_name}`);
      if (p.conversation_id) console.log(`     conversation_id: ${p.conversation_id}`);
      if (p.generation_id)   console.log(`     generation_id:   ${p.generation_id}`);
      if (p.model || p.model_id) console.log(`     model:           ${p.model ?? p.model_id}`);
      if (p.prompt !== undefined) {
        console.log(`     PROMPT:          "${String(p.prompt).replace(/\r?\n/g, " ")}"`);
      }
      if (p.text !== undefined) {
        console.log(`     RESPONSE:        "${String(p.text).slice(0, 300).replace(/\r?\n/g, " ")}..."`);
      }
      if (p.file_path) {
        const editsCount = Array.isArray(p.edits) ? p.edits.length : 0;
        console.log(`     file_path:       ${p.file_path} (${editsCount} edits)`);
      }
      if (p.tool_name) {
        console.log(`     tool_name:       ${p.tool_name} (tool_use_id: ${p.tool_use_id ?? "none"})`);
      }
      if (p.command) {
        console.log(`     command:         ${String(p.command).replace(/\r?\n/g, " ")}`);
      }
      console.log(`     all payload keys: [${Object.keys(p).join(", ")}]`);
    } else {
      console.log(`     (empty or unparsed payload, bytes: ${entry.rawLength})`);
    }
    console.log(`--------------------------------------------------------`);
  } catch (err) {
    console.log(`[#${i + 1}] Raw line error:`, lines[i].slice(0, 120));
  }
}

