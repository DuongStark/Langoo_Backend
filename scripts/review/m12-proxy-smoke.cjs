/** M12-A03: actual Caddy -> Express IP resolver -> Nest throttler storage. Loopback only. */
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const express = require('express');
const { ThrottlerStorageService } = require('@nestjs/throttler');
require('tsx/cjs');
const { configureHttpProxy } = require('../../src/config/http-proxy.ts');

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'langoo-m12-proxy-'));
  const container = `langoo-m12-proxy-${process.pid}`;
  const app = express();
  configureHttpProxy(app);
  const storage = new ThrottlerStorageService();
  app.get('/', async (req, res) => {
    const count = await storage.increment(`client:${req.ip}`, 60000, 2, 60000, 'test');
    res.status(count.isBlocked ? 429 : 200).json({ ip: req.ip });
  });
  const backend = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const portServer = await new Promise(resolve => { const s = http.createServer().listen(0, '127.0.0.1', () => resolve(s)); });
  const proxyPort = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const candidate = readFileSync('docs/ops/m12-feedback-sync-2026-11-13/Caddyfile.candidate', 'utf8');
  const cidrs = JSON.parse(readFileSync('docs/ops/m12-feedback-sync-2026-11-13/cloudflare-cidrs.json', 'utf8')).cidrs.join(' ');
  // Same trust/parser/header-up rules as candidate, only loopback peers/ports differ.
  const global = candidate.slice(candidate.indexOf('{'), candidate.indexOf('(api_proxy)'))
    .replace(cidrs, '127.0.0.2/32').replace('{\n', '{\n  admin off\n  auto_https off\n');
  const proxy = candidate.slice(candidate.indexOf('(api_proxy)'), candidate.indexOf('langoo-api.pixpress.art'))
    .replace('127.0.0.1:3000', `127.0.0.1:${backend.address().port}`);
  writeFileSync(path.join(dir, 'Caddyfile'), global + proxy + `http://127.0.0.1:${proxyPort} {\n import api_proxy\n}\n`);
  const send = (peer, cf, spoof = '198.51.100.99') => new Promise((resolve, reject) => {
    const headers = { 'X-Forwarded-For': spoof };
    if (cf !== undefined) headers['CF-Connecting-IP'] = cf;
    const req = http.get({ hostname: '127.0.0.1', port: proxyPort, path: '/', localAddress: peer, headers }, res => {
      let body = ''; res.on('data', part => body += part);
      res.on('end', () => resolve({ status: res.statusCode, body: (() => { try { return JSON.parse(body); } catch { return {error:body}; } })() }));
    });
    req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('proxy timeout')));
  });
  try {
    execFileSync('docker', ['run','-d','--name',container,'--network','host','-v',`${dir}:/config:ro`,'caddy:2.11.4-alpine','caddy','run','--config','/config/Caddyfile'], { stdio: 'pipe' });
    let ready = false;
    for (let n=0; n<40; n++) {
      try { await send('127.0.0.4'); ready = true; break; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(ready, 'Caddy must become ready');
    const a = await send('127.0.0.2','203.0.113.10');
    const b = await send('127.0.0.2','203.0.113.11');
    assert.deepEqual(a, { status:200,body:{ip:'203.0.113.10'} });
    assert.equal(b.status,200); assert.equal(b.body.ip,'203.0.113.11');
    await send('127.0.0.2','203.0.113.10','198.51.100.1');
    assert.equal((await send('127.0.0.2','203.0.113.10','198.51.100.2')).status,429);
    assert.equal((await send('127.0.0.3','203.0.113.12')).body.ip,'127.0.0.3');
    assert.equal((await send('127.0.0.2','2001:db8::10')).body.ip,'2001:db8::10');
    assert.equal((await send('127.0.0.2','not-an-ip')).body.ip,'127.0.0.2');
    const multi = await send('127.0.0.2','203.0.113.20, 203.0.113.21');
    const duplicate = await send('127.0.0.2',['203.0.113.22','203.0.113.23']);
    assert.equal(multi.status,400); assert.equal(duplicate.status,400);
    console.log(JSON.stringify({trustedClientsSeparate:true,spoofDoesNotResetQuota:true,untrustedUsesPeer:true,ipv6Client:true,invalidUsesPeer:true,multi,duplicate}));
    // Record edge cases so a template is not called production-ready on syntax alone.
  } finally {
    try { execFileSync('docker',['rm','-f',container], {stdio:'pipe'}); } catch { /* cleanup own container only */ }
    storage.onApplicationShutdown();
    await new Promise(resolve => backend.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });
