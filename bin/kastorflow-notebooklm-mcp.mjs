#!/usr/bin/env node
/**
 * kastorflow-notebooklm-mcp — connect an AI agent on this computer to KastorFlow (Chrome extension for NotebookLM).
 *
 *   npx -y kastorflow-notebooklm-mcp            serve MCP on stdio (what an agent app runs; prints nothing else to stdout)
 *   npx kastorflow-notebooklm-mcp setup         register the bridge with Chrome for this user (once)
 *   npx kastorflow-notebooklm-mcp doctor        check the registration
 *   npx kastorflow-notebooklm-mcp uninstall     remove it
 *
 * Options for setup/doctor/uninstall: --browser chrome,edge,brave,chromium   --extension-id <id>
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [command, ...rest] = process.argv.slice(2);

if (!command || command === 'serve') {
  const { serve } = await import('../src/server.mjs');
  await serve(process.env);
} else if (command === '--version' || command === '-v') {
  process.stdout.write(require('../package.json').version + '\n');
} else if (command === 'setup' || command === 'install') {
  const setup = require('../src/setup.cjs');
  try {
    const done = setup.install(rest);
    process.stdout.write('KastorFlow bridge registered.\n  folder: ' + done.dir + '\n' + done.registered.map((r) => '  ' + r).join('\n') + '\n'
      + 'Next: in KastorFlow open Settings → AI agents → Connect an agent, and paste the agent setup it shows into your agent app.\n');
  } catch (err) {
    process.stderr.write('Setup did not finish: ' + (err instanceof Error ? err.message : String(err)) + '\n');
    process.exit(1);
  }
} else if (command === 'doctor') {
  const setup = require('../src/setup.cjs');
  try {
    const report = setup.doctor(rest);
    process.stdout.write(report.lines.join('\n') + '\n');
    process.exit(report.ok ? 0 : 1);
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    process.exit(1);
  }
} else if (command === 'uninstall') {
  const setup = require('../src/setup.cjs');
  const done = setup.uninstall(rest);
  process.stdout.write(done.removed.length ? 'Removed:\n' + done.removed.map((r) => '  ' + r).join('\n') + '\n' : 'Nothing was registered.\n');
} else {
  process.stderr.write('Unknown command "' + command + '". Use: setup, doctor, uninstall, or no command to serve MCP.\n');
  process.exit(2);
}
