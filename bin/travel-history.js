#!/usr/bin/env node
// Runs the TypeScript command line (scripts/cli.ts) without a compile step.
import { register } from "tsx/esm/api";

register();
await import("../scripts/cli.ts");
