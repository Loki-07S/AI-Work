#!/usr/bin/env node
import { runHookProcess } from "@aiwork/collector";

const agentArg = process.argv.find((a) => a.startsWith("--agent="));
const agent = agentArg?.slice("--agent=".length) === "claude_code" ? "claude_code" : "cursor";

await runHookProcess(agent);
