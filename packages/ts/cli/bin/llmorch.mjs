#!/usr/bin/env node
/** Executable shim: dispatch to the built CLI entry. */
import { run } from "../dist/run.js";

run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
