import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const prefix = '@xiaobaibaifqy/jingchuanchu-';
const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

function moduleName(name) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name))
    throw new Error(`Module names must be kebab-case: ${name}`);
  return name;
}

export async function addModules(project = '.', { modules, all = false, bundle } = {}) {
  if (!bundle) throw new Error('add requires --bundle <release-directory>');
  if (!all && !modules?.length) throw new Error('add requires --modules or --all');
  const root = resolve(project);
  const bundleRoot = resolve(bundle);
  const manifestFile = join(bundleRoot, 'manifest.json');
  if (!(await exists(manifestFile))) throw new Error(`Bundle manifest is missing: ${manifestFile}`);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const entries = new Map(manifest.packages.map((entry) => [entry.name, entry]));
  const selected = all
    ? [...entries.keys()].map((name) => name.slice(prefix.length))
    : modules.map(moduleName);
  const needed = new Set();
  function select(name) {
    if (needed.has(name)) return;
    const entry = entries.get(name);
    if (!entry) throw new Error(`Module missing from bundle: ${name}`);
    needed.add(name);
    for (const dependency of Object.keys(entry.dependencies ?? {}))
      if (dependency.startsWith(prefix)) select(dependency);
  }
  for (const name of selected) select(prefix + name);

  const packages = [];
  for (const name of needed) {
    const entry = entries.get(name);
    if (!/^[\w.-]+\.tgz$/.test(entry.file))
      throw new Error(`Invalid bundle filename: ${entry.file}`);
    const file = join(bundleRoot, 'packages', entry.file);
    const bytes = await readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      throw new Error(`Checksum mismatch: ${entry.file}`);
    packages.push({ name, file, fileBase: basename(entry.file) });
  }

  const packageFile = join(root, 'package.json');
  const packageSource = await readFile(packageFile, 'utf8');
  const pkg = JSON.parse(packageSource);
  pkg.dependencies ??= {};
  pkg.devDependencies ??= {};
  for (const entry of packages) {
    const relative = `file:vendor/${entry.fileBase}`;
    if (entry.name === prefix + 'tooling') pkg.devDependencies[entry.name] = relative;
    else pkg.dependencies[entry.name] = relative;
  }
  const vendor = join(root, 'vendor');
  const created = [];
  try {
    await mkdir(vendor, { recursive: true });
    for (const entry of packages) {
      const target = join(vendor, entry.fileBase);
      if (!(await exists(target))) {
        await cp(entry.file, target, { errorOnExist: true, force: false });
        created.push(target);
      }
    }
    await writeFile(packageFile, JSON.stringify(pkg, null, 2) + '\n');
  } catch (error) {
    for (const file of created.reverse()) await rm(file, { force: true });
    await writeFile(packageFile, packageSource);
    throw error;
  }
  return {
    packages: packages.map((entry) => entry.name),
    vendor,
    next: 'npm install',
  };
}
