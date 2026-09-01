/**
 * Refuses to run the test suite on a Node version the test runner cannot survive.
 *
 * On Node 20 the runner's jsdom dependency calls `webidl.util.markAsUncloneable`, which
 * does not exist there, and every worker dies before a single test file loads. The output
 * is six identical stack traces pointing at undici internals, which says nothing about the
 * actual cause. `.npmrc` sets engine-strict, but that only guards `npm install` — it does
 * nothing for a shell that switched Node afterwards, which is the common case: a new
 * terminal tab starts on the system default.
 *
 * This turns that into one line naming the fix.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const required = Number(readFileSync(join(here, '../../../.nvmrc'), 'utf8').trim());
const actual = Number(process.versions.node.split('.')[0]);

if (actual < required) {
  const red = (text) => `[31m${text}[0m`;
  const bold = (text) => `[1m${text}[0m`;
  process.stderr.write(
    `\n${red('Node ' + required + ' is required to run the tests.')} This shell is on ${bold('v' + process.versions.node)}.\n\n` +
      `  ${bold('nvm use')}            reads .nvmrc\n` +
      `  ${bold('nvm use ' + required)}          on nvm-windows, which does not read .nvmrc\n\n` +
      `On an older Node the test runner's jsdom dependency crashes every worker before any\n` +
      `test loads, and the failure looks nothing like a version problem.\n\n`,
  );
  process.exit(1);
}
