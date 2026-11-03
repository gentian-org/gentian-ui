import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import handler from "serve-handler";

// serve.json as the image runs it, against a tree laid out the way the pod has
// it: /branding is a ConfigMap, which Kubernetes mounts as symlinks into a
// hidden "..<timestamp>" directory. serve resolves a symlink before it matches
// the header rules, so a rule has to match the resolved path too.
const config = JSON.parse(await readFile(fileURLToPath(new URL("../serve.json", import.meta.url)), "utf8"));

let root;
let server;
let base;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "concierge-"));
  await mkdir(join(root, "sign-in"));
  await writeFile(join(root, "sign-in", "config.json"), "{}");
  const data = join(root, "branding", "..2026_11_03_14_00_00.000000000");
  await mkdir(data, { recursive: true });
  await writeFile(join(data, "brand.json"), '{"name":"Example"}');
  await writeFile(join(data, "brand.css"), ":root{}");
  await symlink("..2026_11_03_14_00_00.000000000", join(root, "branding", "..data"));
  await symlink("..data/brand.json", join(root, "branding", "brand.json"));
  await symlink("..data/brand.css", join(root, "branding", "brand.css"));

  server = createServer((req, res) => handler(req, res, { ...config, public: root }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});

for (const file of ["brand.json", "brand.css"]) {
  test(`the consoles may read ${file} from their own hosts`, async () => {
    const res = await fetch(`${base}/branding/${file}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("cache-control"), "no-cache, must-revalidate");
  });

  test(`${file} carries the headers every file does`, async () => {
    const res = await fetch(`${base}/branding/${file}`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  });
}

test("the hidden directory is not a second way in", async () => {
  const res = await fetch(`${base}/branding/..data/brand.json`);
  // Whatever serve answers here, it is not without the headers.
  if (res.status === 200) {
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  }
});

test("only the brand is readable from other hosts", async () => {
  const res = await fetch(`${base}/sign-in/config.json`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});
