const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appDir = path.join(__dirname, '..');
const windows = process.platform === 'win32';
const scripts = ['setup', 'start', 'stop', 'remove', 'node-version', 'start-window'];
const readPs1 = (name) => fs.readFileSync(path.join(appDir, 'setup', 'windows', `${name}.ps1`), 'utf8');

for (const name of scripts) {
  const ps1 = path.join(appDir, 'setup', 'windows', `${name}.ps1`);
  test(`${name}.ps1 parses without errors`, { skip: !windows }, () => {
    const cmd = `$e = $null; [System.Management.Automation.Language.Parser]::ParseFile('${ps1.replace(/'/g, "''")}', [ref]$null, [ref]$e) | Out-Null; if ($e) { $e | ForEach-Object { $_.Message }; exit 1 }`;
    const r = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
}

const bats = {
  'Set up Body Lab.bat': 'setup',
  'Remove Body Lab setup.bat': 'remove',
};
for (const [bat, name] of Object.entries(bats)) {
  test(`${bat} runs setup\\windows\\${name}.ps1`, () => {
    const text = fs.readFileSync(path.join(appDir, bat), 'utf8').trim();
    assert.equal(text.split(/\r?\n/).length, 1);
    assert.ok(text.includes(`"%~dp0setup\\windows\\${name}.ps1"`), text);
    assert.ok(fs.existsSync(path.join(appDir, 'setup', 'windows', `${name}.ps1`)));
  });
}

test('Windows has only Set up and Remove at the top level', () => {
  const bats = fs.readdirSync(appDir).filter((n) => n.toLowerCase().endsWith('.bat')).sort();
  assert.deepEqual(bats, ['Remove Body Lab setup.bat', 'Set up Body Lab.bat']);
});

test('start.ps1 never waits for a key, and the start task opens no window', () => {
  // The shortcut and the scheduled task run start.ps1 hidden, so a prompt would hang unseen.
  const start = fs.readFileSync(path.join(appDir, 'setup', 'windows', 'start.ps1'), 'utf8');
  assert.ok(!/Read-Host|pause/i.test(start));
  const setup = fs.readFileSync(path.join(appDir, 'setup', 'windows', 'setup.ps1'), 'utf8');
  const startAction = setup.match(/\$startAction = .*/)[0];
  assert.ok(!/-Open/.test(startAction), startAction);
  assert.match(setup, /\$lnk\.Arguments = .*\$StartScript`" -Open /);
});

test('the 9 PM stop task has its own settings without StartWhenAvailable', () => {
  // A missed stop must not run at the next sign-in and shut Body Lab down after the morning start.
  const setup = readPs1('setup');
  const stopSettings = setup.match(/\$stopSettings = New-ScheduledTaskSettingsSet (.*)/)[1];
  assert.ok(!/StartWhenAvailable/.test(stopSettings), stopSettings);
  for (const flag of ['-AllowStartIfOnBatteries', '-DontStopIfGoingOnBatteries', '-ExecutionTimeLimit (New-TimeSpan -Hours 72)']) {
    assert.ok(stopSettings.includes(flag), flag);
  }
  assert.match(setup, /-TaskName \$stopName .*-Settings \$stopSettings /);
  assert.match(setup, /-TaskName \$startName .*-Settings \$settings /);
  assert.match(setup, /\$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable /);
});

test('Test-NodeVersion accepts 22.13 and newer only', { skip: !windows }, () => {
  const ps1 = path.join(appDir, 'setup', 'windows', 'node-version.ps1').replace(/'/g, "''");
  const cases = { 'v22.12.0': 'False', 'v22.13.0': 'True', 'v22.13.1': 'True', 'v23.0.0': 'True', 'v24.19.0': 'True', 'v20.18.1': 'False', '': 'False', 'garbage': 'False' };
  const cmd = `. '${ps1}'; ${Object.keys(cases).map((v) => `Test-NodeVersion '${v}'`).join('; ')}`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), Object.values(cases));
});

test('setup.ps1 checks the Node version before registering anything, and start.ps1 checks it too', () => {
  const setup = readPs1('setup');
  const check = setup.indexOf('Test-NodeVersion (Get-NodeVersion)');
  assert.ok(check > 0 && check < setup.indexOf('Register-ScheduledTask') && check < setup.indexOf('CreateShortcut'));
  assert.match(readPs1('start'), /if \(-not \(Test-NodeVersion \(Get-NodeVersion\)\)\) \{ Stop-WithError \$NodeTooOldMessage \}/);
  assert.ok(readPs1('node-version').includes("'Body Lab needs Node 22.13 or newer. Install the LTS from https://nodejs.org.'"));
});

test('stop.ps1 tells "not running" apart from a stop request that got no answer', () => {
  const stop = readPs1('stop');
  assert.ok(stop.includes("Write-Host 'Body Lab is not running.'"));
  assert.ok(stop.includes(`Write-Host "Body Lab didn't answer the stop request."`));
  // "not running" only comes from the page check, before the shutdown request.
  assert.ok(stop.indexOf('not running') < stop.indexOf('/api/shutdown'));
});

test('only the scheduled start task passes -Scheduled', () => {
  const setup = readPs1('setup');
  // The task tells start.ps1 its own prefix, so it reads the times of the tasks setup made.
  assert.match(setup.match(/\$startAction = .*/)[0], /-Scheduled -TaskPrefix `"\$TaskPrefix`""$/);
  assert.ok(!/-Scheduled/.test(setup.match(/\$lnk\.Arguments = .*/)[0]), 'the shortcut always starts');
  assert.ok(!/-Scheduled/.test(setup.match(/& \$StartScript .*/)[0]), 'setup always starts');
  const start = readPs1('start');
  assert.match(start, /if \(\$Scheduled -and -not \(Test-ScheduledStartAllowed \(Get-Date\) \$TaskPrefix\)\) \{ exit 0 \}/);
  assert.ok(start.indexOf('Test-ScheduledStartAllowed (Get-Date)') < start.indexOf('Start-Process'));
  assert.match(start, /\[string\]\$TaskPrefix = 'Body Lab'/);
});

const windowPs1 = path.join(appDir, 'setup', 'windows', 'start-window.ps1').replace(/'/g, "''");
const runPs = (cmd) => {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split(/\r?\n/);
};

test('Test-InStartWindow follows the start and stop times it is given', { skip: !windows }, () => {
  const cases = [
    // [now, start, stop, expected]
    ['00:00', '05:30', '21:00', 'False'], ['05:29', '05:30', '21:00', 'False'], ['05:30', '05:30', '21:00', 'True'],
    ['20:59', '05:30', '21:00', 'True'], ['21:00', '05:30', '21:00', 'False'], ['23:30', '05:30', '21:00', 'False'],
    // A start before 5:30 and a stop earlier than 9 PM.
    ['04:00', '04:15', '19:30', 'False'], ['04:15', '04:15', '19:30', 'True'], ['05:00', '04:15', '19:30', 'True'],
    ['19:29', '04:15', '19:30', 'True'], ['19:30', '04:15', '19:30', 'False'], ['20:30', '04:15', '19:30', 'False'],
    // An overnight window, 10 PM to 4 AM: inside its hours on both sides of midnight, outside by day.
    ['22:00', '22:00', '04:00', 'True'], ['23:30', '22:00', '04:00', 'True'], ['00:00', '22:00', '04:00', 'True'],
    ['03:59', '22:00', '04:00', 'True'], ['04:00', '22:00', '04:00', 'False'], ['12:00', '22:00', '04:00', 'False'],
    ['21:59', '22:00', '04:00', 'False'],
    // Equal times make an empty window, which never starts.
    ['06:00', '06:00', '06:00', 'False'], ['18:00', '06:00', '06:00', 'False'],
  ];
  const cmd = `. '${windowPs1}'; ${cases.map(([now, a, b]) => `Test-InStartWindow ([datetime]'2026-10-05 ${now}') ([timespan]'${a}') ([timespan]'${b}')`).join('; ')}`;
  assert.deepEqual(runPs(cmd), cases.map((c) => c[3]));
});

test('Test-ScheduledStartAllowed reads the task times and does nothing if either task is unreadable', { skip: !windows }, () => {
  // A stand-in Get-ScheduledTask. "Fake" has both tasks (4:15 AM, 7:30 PM), "Night" a 10 PM start
  // and 4 AM stop, "OnlyStart" just a start, "OnlyStop" just a stop, and "Missing" neither.
  const fake = `function Get-ScheduledTask { param([string]$TaskName, $ErrorAction)
    $times = @{
      'Fake - Start Morning' = '2026-10-04T04:15:00'; 'Fake - Stop 9 PM' = '2026-10-04T19:30:00-07:00'
      'Night - Start Morning' = '2026-10-04T22:00:00'; 'Night - Stop 9 PM' = '2026-10-04T04:00:00'
      'OnlyStart - Start Morning' = '2026-10-04T04:00:00'; 'OnlyStop - Stop 9 PM' = '2026-10-04T22:30:00'
    }
    if (-not $times.ContainsKey($TaskName)) { throw "no task $TaskName" }
    [pscustomobject]@{ Triggers = @([pscustomobject]@{ CimClass = [pscustomobject]@{ CimClassName = 'MSFT_TaskDailyTrigger' }; StartBoundary = $times[$TaskName] }) } }`;
  const cases = [
    ['04:00', 'Fake', 'False'], ['04:15', 'Fake', 'True'], ['19:29', 'Fake', 'True'], ['19:30', 'Fake', 'False'],
    // Either task unreadable: no scheduled start at any hour.
    ['03:00', 'Missing', 'False'], ['12:00', 'Missing', 'False'], ['23:00', 'Missing', 'False'],
    ['04:00', 'OnlyStart', 'False'], ['12:00', 'OnlyStart', 'False'],
    ['12:00', 'OnlyStop', 'False'], ['22:00', 'OnlyStop', 'False'],
    // Overnight task times, 10 PM to 4 AM.
    ['23:00', 'Night', 'True'], ['02:00', 'Night', 'True'], ['04:00', 'Night', 'False'], ['12:00', 'Night', 'False'],
  ];
  const cmd = `. '${windowPs1}'; ${fake}; ${cases.map(([hm, prefix]) => `Test-ScheduledStartAllowed ([datetime]'2026-10-05 ${hm}') '${prefix}'`).join('; ')}`;
  assert.deepEqual(runPs(cmd), cases.map((c) => c[2]));
});

test('start.ps1 reuses a running Body Lab only if it holds the right kind of data', () => {
  const start = readPs1('start');
  assert.ok(start.includes('"$Url/api/info"'));
  assert.ok(start.includes('if ($Demo -and $kind -ne \'demo\')'));
  assert.ok(start.includes('if (-not $Demo -and $kind -ne \'real\')'));
  assert.ok(start.includes('is running Body Lab with real notes, not the demo'));
  assert.ok(start.includes('is running the Body Lab demo, not your own notes'));
  // The check runs before any window opens.
  assert.ok(start.indexOf('$kind = Get-DataKind') < start.indexOf('if ($Open)'));
  // Demo setup and its shortcut tell start.ps1 they want the demo.
  const setup = readPs1('setup');
  assert.ok(setup.includes("if ($Demo) { $extra += ' -Demo' }"));
  assert.ok(setup.includes('& $StartScript -Open -Port $Port -DataRoot $DataRoot -Demo:$Demo'));
});

test('the Mac start file checks the Node version and refuses the demo', () => {
  const file = path.join(appDir, 'Mac', 'Start Body Lab.command');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes('Body Lab needs Node 22.13 or newer. Install the LTS from https://nodejs.org.'));
  assert.ok(text.indexOf('if ! node_ok; then') < text.indexOf('nohup node server.js'));
  assert.ok(text.includes('"$URL/api/info"'));
  assert.ok(text.includes(`*'"demo":false'*) ;;`));
});

test('the Mac node_ok accepts 22.13 and newer only', { skip: !hasBashEarly() }, () => {
  const text = fs.readFileSync(path.join(appDir, 'Mac', 'Start Body Lab.command'), 'utf8');
  const fn = text.match(/node_ok\(\) \{[\s\S]*?\n\}/)[0];
  const cases = { 'v22.12.0': 'no', 'v22.13.0': 'ok', 'v23.0.0': 'ok', 'v24.19.0': 'ok', 'v20.18.1': 'no', '': 'no', 'garbage': 'no' };
  // The loop variable can't be v: node_ok has its own local v.
  const script = `${fn}\nfor fake in ${Object.keys(cases).map((v) => `'${v}'`).join(' ')}; do node() { echo "$fake"; }; node_ok && echo ok || echo no; done\n`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), Object.values(cases));
});

function hasBashEarly() {
  return spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
}

test('remove.ps1 removes the shortcut by literal path', () => {
  assert.match(readPs1('remove'), /Remove-Item -LiteralPath \$lnk -Force/);
});

test('the shortcut icon is in setup/', () => {
  assert.ok(fs.existsSync(path.join(appDir, 'setup', 'Body Lab.ico')));
});

for (const name of ['setup', 'remove']) {
  test(`${name}.ps1 has a -NoPause switch and pauses by default`, () => {
    const text = fs.readFileSync(path.join(appDir, 'setup', 'windows', `${name}.ps1`), 'utf8');
    assert.match(text, /\[switch\]\$NoPause/);
    assert.match(text, /Read-Host 'Press Enter to close'/);
  });
}

test('setup.ps1 and start.ps1 have a -Demo switch on port 4187 with no scheduled tasks', () => {
  const setup = fs.readFileSync(path.join(appDir, 'setup', 'windows', 'setup.ps1'), 'utf8');
  const start = fs.readFileSync(path.join(appDir, 'setup', 'windows', 'start.ps1'), 'utf8');
  for (const text of [setup, start]) {
    assert.match(text, /\[switch\]\$Demo/);
    assert.match(text, /\$Port = 4187/);
    assert.match(text, /'dev\\body-lab-demo'/);
  }
  assert.match(setup, /\$ShortcutName = 'Body Lab Demo'/);
  assert.match(setup, /if \(-not \$Demo\) \{\r?\n\s+\$user[\s\S]*Register-ScheduledTask[\s\S]*Register-ScheduledTask[^\n]*\r?\n\}/);
  assert.match(setup, /tools\\make-demo-data\.js/);
  // The folder check runs before the data, the shortcut and the server.
  const check = setup.indexOf('--check');
  assert.ok(check > 0 && check < setup.indexOf('CreateShortcut') && check < setup.indexOf('& $StartScript'));
});

test('stop.ps1 and remove.ps1 have a -Demo switch', () => {
  const stop = fs.readFileSync(path.join(appDir, 'setup', 'windows', 'stop.ps1'), 'utf8');
  const remove = fs.readFileSync(path.join(appDir, 'setup', 'windows', 'remove.ps1'), 'utf8');
  assert.match(stop, /\[switch\]\$Demo/);
  assert.match(stop, /\$Port = 4187/);
  assert.match(remove, /\[switch\]\$Demo/);
  assert.match(remove, /\$ShortcutName = 'Body Lab Demo'/);
  // With -Demo, no scheduled task is touched.
  assert.match(remove, /if \(\$Demo\) \{[\s\S]*?\} else \{\r?\n\s+foreach[\s\S]*Unregister-ScheduledTask/);
});

const macFiles = ['Mac/Start Body Lab.command', 'Mac/Stop Body Lab.command'];

test('the Mac files are only in the Mac folder', () => {
  for (const name of ['Start Body Lab.command', 'Stop Body Lab.command']) {
    assert.ok(!fs.existsSync(path.join(appDir, name)), `${name} should not be at the top level`);
  }
  // The start file moves up from App/Mac to the App folder, where server.js is.
  const start = fs.readFileSync(path.join(appDir, 'Mac', 'Start Body Lab.command'), 'utf8');
  assert.ok(start.split('\n').includes('cd "$(dirname "$0")/.." || exit 1'), 'cd to the App folder');
  assert.ok(!start.includes('\r'), 'LF line endings');
});
const hasBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0;
for (const file of macFiles) {
  test(`${file} passes bash -n`, { skip: !hasBash }, () => {
    const r = spawnSync('bash', ['-n', path.join(appDir, file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
  test(`${file} is executable in git (mode 100755)`, () => {
    const r = spawnSync('git', ['ls-files', '-s', '--', file], { cwd: appDir, encoding: 'utf8' });
    assert.match(r.stdout, /^100755 /, `${file}: ${r.stdout || r.stderr}`);
  });
}
