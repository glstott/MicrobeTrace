// One existing application server is shared by all deterministic batches.
delete process.env.ELECTRON_RUN_AS_NODE;
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { regressionPlan } = require('./cypress-regression-plan');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };

if (args.includes('--batch')) {
  const input = JSON.parse(fs.readFileSync(option('--batch'), 'utf8'));
  require('cypress').run(input.options).then(result => {
    fs.writeFileSync(input.resultFile, JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'failed' ? 2 : 0;
  }).catch(error => { console.error(error); process.exitCode = 2; });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

async function main() {
  const plan = regressionPlan(root, option('--suite', 'all'));
  if (args.includes('--plan')) { console.log(JSON.stringify(plan, null, 2)); return; }
  const output = path.resolve(root, option('--output', `tmp/cypress-regression-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  fs.mkdirSync(output, { recursive: true });
  // Only previous-date test processes owned by this checkout/Cypress are stale.
  if (process.platform === 'win32') {
    const escapedRoot = root.replace(/'/g, "''");
    const cleanup = `$cutoff=(Get-Date).Date; Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -lt $cutoff -and ($_.Name -match '^(node|Cypress|electron)\\.exe$') -and ($_.CommandLine -like '*${escapedRoot}*' -or $_.ExecutablePath -like '*\\Cypress\\*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }`;
    spawnSync('powershell.exe', ['-NoProfile', '-Command', cleanup], { windowsHide: true, stdio: 'inherit' });
  }
  const info = spawnSync(process.execPath, [path.join(path.dirname(require.resolve('cypress/package.json')), 'bin/cypress'), 'info'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  fs.writeFileSync(path.join(output, 'browser-preflight.log'), `${info.stdout || ''}${info.stderr || ''}`);
  if (info.error || info.status !== 0) throw new Error('Cypress browser preflight failed. See browser-preflight.log.');
  const requested = option('--browser', 'auto');
  const chrome = /(?:Name:\s*chrome\b|\bChrome\s+\d)/i.test(info.stdout.replace(/\u001b\[[0-9;]*m/g, ''));
  const browser = requested === 'electron' ? 'electron' : chrome ? 'chrome' : 'electron';
  console.log(`Browser: ${browser}${browser === 'electron' && requested !== 'electron' ? ' (Chrome unavailable; using bundled Electron)' : ''}`);
  const baseUrl = option('--base-url', 'http://127.0.0.1:4210');
  const response = await fetch(baseUrl, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Application server returned ${response.status}: ${baseUrl}`);
  const previous = args.includes('--resume') && fs.existsSync(path.join(output, 'report.json'))
    ? JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8')) : undefined;
  if (previous && (previous.browser !== browser || previous.baseUrl !== baseUrl)) throw new Error('Resume requires the same browser and application URL as the original run.');
  const report = previous || { browser, baseUrl, startedAt: new Date().toISOString(), complete: false, batches: [], isolation: [], deterministicFailures: [], retryOnly: [], orderOrResourceFailures: [] };
  let index = Math.max(0, ...[...report.batches, ...report.isolation].map(batch => Number(batch.name.split('-')[0])));
  if (previous) {
    report.recoveries ||= [];
    report.recoveries.push({ resumedAt: new Date().toISOString(), interruptedBatches: report.batches.filter(batch => batch.infrastructureFailure) });
    report.batches = report.batches.filter(batch => !batch.infrastructureFailure);
    report.isolation = report.isolation.filter(batch => !batch.infrastructureFailure);
    report.retryOnly = [...report.batches, ...report.isolation].flatMap(batch => batch.retried.filter(test => test.state === 'passed'));
    report.deterministicFailures = []; report.orderOrResourceFailures = [];
    report.complete = false; delete report.completedAt;
  }
  const checkpoint = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  checkpoint();
  let interrupted = false;
  async function runBatch(batch, isolation = false) {
    const name = `${String(++index).padStart(2, '0')}-${isolation ? 'isolation-' : ''}${batch.suite}`;
    const inputFile = path.join(output, `${name}-input.json`), resultFile = path.join(output, `${name}-result.json`);
    const options = { browser, headed: false, spec: batch.specs.join(','), config: { baseUrl, trashAssetsBeforeRuns: false }, env: { contractMode: batch.suite === 'contracts' ? 1 : 0 } };
    fs.writeFileSync(inputFile, JSON.stringify({ options, resultFile }));
    const log = fs.createWriteStream(path.join(output, `${name}.log`));
    console.log(`Starting ${name}: ${batch.specs.length} spec(s)`);
    const execution = await new Promise(resolve => {
      const child = spawn(process.execPath, [__filename, '--batch', inputFile], { cwd: root, windowsHide: true });
      child.stdout.on('data', data => { process.stdout.write(data); log.write(data); });
      child.stderr.on('data', data => { process.stderr.write(data); log.write(data); });
      let timedOut = false;
      const stop = () => {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        else child.kill('SIGTERM');
      };
      const interrupt = () => { interrupted = true; stop(); process.exitCode = 130; };
      process.once('SIGINT', interrupt);
      const timer = setTimeout(() => { timedOut = true; stop(); }, 45 * 60 * 1000);
      child.on('error', error => { clearTimeout(timer); process.removeListener('SIGINT', interrupt); resolve({ error: error.message }); });
      child.on('close', code => { clearTimeout(timer); process.removeListener('SIGINT', interrupt); resolve({ code, timedOut }); });
    });
    await new Promise(resolve => log.end(resolve));
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : undefined;
    const runs = result?.runs || [];
    const failures = runs.filter(run => run.stats.failures > 0).map(run => run.spec.relative.replace(/\\/g, '/'));
    const retried = runs.flatMap(run => (run.tests || []).filter(test => test.attempts?.length > 1).map(test => ({ spec: run.spec.relative, title: test.title, state: test.state, attempts: test.attempts.length })));
    const summary = { name, ...batch, ...execution, passed: result?.totalPassed ?? 0, failed: result?.totalFailed ?? 0, pending: result?.totalPending ?? 0, skipped: result?.totalSkipped ?? 0, durationMs: result?.totalDuration ?? 0, retried, failures,
      infrastructureFailure: !result || result.status === 'failed' || execution.timedOut || runs.length !== batch.specs.length };
    (isolation ? report.isolation : report.batches).push(summary);
    report.retryOnly.push(...retried.filter(test => test.state === 'passed'));
    checkpoint();
    return summary;
  }
  for (const batch of plan) {
    if (interrupted) break;
    if (report.batches.some(done => done.suite === batch.suite && JSON.stringify(done.specs) === JSON.stringify(batch.specs))) continue;
    const completed = await runBatch(batch);
    // A lost browser/process is incomplete coverage. Stop here so a resume can
    // retry the batch without cascading start-up errors through the remaining plan.
    if (completed.infrastructureFailure) { interrupted = true; break; }
  }
  for (const batch of [...report.batches]) for (const spec of batch.failures) {
    if (interrupted) break;
    const isolated = report.isolation.find(done => done.suite === batch.suite && done.specs.length === 1 && done.specs[0] === spec)
      || await runBatch({ suite: batch.suite, specs: [spec] }, true);
    if (isolated.failed || isolated.infrastructureFailure) report.deterministicFailures.push(spec);
    else report.orderOrResourceFailures.push(spec);
  }
  report.complete = !interrupted && report.batches.length === plan.length && report.batches.every(batch => !batch.infrastructureFailure) && report.isolation.every(batch => !batch.infrastructureFailure);
  report.completedAt = new Date().toISOString();
  checkpoint();
  console.log(`Results: ${path.join(output, 'report.json')}`);
  if (!report.complete || report.deterministicFailures.length) process.exitCode = 1;
}
