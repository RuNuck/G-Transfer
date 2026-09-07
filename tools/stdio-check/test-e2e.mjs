// End-to-end through the real add-on hosted in headless Blender (see addon-host.py).
// node test-e2e.mjs <server.mjs> <build-script.py> <stop-file>
// The host must run with ANVIL_JOB_TIMEOUT=3 so the cross-talk case can be exercised quickly.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [SERVER, SCRIPT, STOP] = process.argv.slice(2);

function client(env = {}) {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
  let buffer = "";
  const waiters = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  let nextId = 1;
  const request = (method, params, timeoutMs = 90000) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no reply to ${method} #${id}`)), timeoutMs);
      waiters.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  };
  const call = (name, args, timeoutMs) => request("tools/call", { name, arguments: args }, timeoutMs).then((m) => m.result ?? m.error);
  const close = () => child.stdin.end();
  return { request, call, close };
}

const report = { ok: false, steps: {} };
const main = client();
const wrong = client({ ANVIL_BLENDER_TOKEN: "not-the-token" });
const shortIdle = client({ ANVIL_BLENDER_IDLE_MS: "3000" });
try {
  const init = await main.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  report.steps.initialize = init.result?.serverInfo?.name;

  const tokenFile = readFileSync(join(homedir(), ".anvil", "token"), "utf8").trim();
  report.steps.tokenFileExists = tokenFile.length > 10;

  const ping = await main.call("blender_ping", {});
  report.steps.ping = { isError: ping.isError ?? false, text: ping.content?.[0]?.text };

  const denied = await wrong.call("blender_run_python", { code: "result = 'should not run'" });
  report.steps.wrongToken = { isError: denied.isError ?? false, text: denied.content?.[0]?.text?.slice(0, 120) };

  const build = await main.call("blender_run_python", { code: readFileSync(SCRIPT, "utf8") }, 120000);
  report.steps.build = { isError: build.isError ?? false, text: build.content?.[0]?.text?.slice(0, 200) };

  const printed = await main.call("blender_run_python", { code: "print('hello from blender')\nresult = 'done'" });
  report.steps.printCaptured = { text: printed.content?.[0]?.text };

  const mainGuard = await main.call("blender_run_python", { code: "if __name__ == '__main__':\n    result = 'guard ran'" });
  report.steps.mainGuard = mainGuard.content?.[0]?.text;

  const exit = await main.call("blender_run_python", { code: "import sys\nsys.exit(3)" });
  const alive = await main.call("blender_ping", {});
  report.steps.sysExit = { isError: exit.isError ?? false, text: exit.content?.[0]?.text?.slice(0, 80), hostAlive: !(alive.isError ?? false) };

  const boom = await main.call("blender_run_python", { code: "raise ValueError('boom from blender')" });
  const boomText = boom.content?.[0]?.text ?? "";
  report.steps.error = { isError: boom.isError ?? false, hasMessage: /boom from blender/.test(boomText) };

  const long = await shortIdle.call("blender_run_python", { code: "import time\ntime.sleep(2.5)\nresult = 'slept'" }, 60000);
  report.steps.keepaliveBeatsIdleTimeout = { isError: long.isError ?? false, text: long.content?.[0]?.text?.slice(0, 60) };

  // Host runs with ANVIL_JOB_TIMEOUT=3: A overruns and must not hand its result to B.
  const a = await main.call("blender_run_python", { code: "import time\ntime.sleep(4.5)\nresult = 'A'" }, 60000);
  const b = await main.call("blender_run_python", { code: "result = 'B'" }, 60000);
  report.steps.noCrossTalk = { aIsTimeout: (a.isError ?? false) && /timeout/.test(a.content?.[0]?.text ?? ""), bText: b.content?.[0]?.text };

  const unicode = "# " + "crème brûlée ✓ ".repeat(700) + "\nresult = 'unicode ok'";
  const big = await main.call("blender_run_python", { code: unicode });
  report.steps.unicodeOver4k = { bytes: Buffer.byteLength(unicode), text: big.content?.[0]?.text?.slice(0, 40) };

  const noResult = await main.call("blender_run_python", { code: "x = 1" });
  report.steps.noResult = noResult.content?.[0]?.text?.slice(0, 60);

  const s = report.steps;
  report.ok =
    s.initialize === "anvil-blender" && s.tokenFileExists &&
    !s.ping.isError && /pong/.test(s.ping.text) && /token accepted/.test(s.ping.text) &&
    s.wrongToken.isError && /unauthorized/.test(s.wrongToken.text) &&
    !s.build.isError && /built/.test(s.build.text) &&
    /hello from blender/.test(s.printCaptured.text) && /done/.test(s.printCaptured.text) &&
    s.mainGuard === "guard ran" &&
    s.sysExit.isError && s.sysExit.hostAlive &&
    s.error.isError && s.error.hasMessage &&
    !s.keepaliveBeatsIdleTimeout.isError && /slept/.test(s.keepaliveBeatsIdleTimeout.text) &&
    s.noCrossTalk.aIsTimeout && s.noCrossTalk.bText === "B" &&
    s.unicodeOver4k.text === "unicode ok" &&
    /no `result`/.test(s.noResult);
} catch (err) {
  report.exception = String(err);
} finally {
  writeFileSync(STOP, "stop");
  main.close();
  wrong.close();
  shortIdle.close();
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
