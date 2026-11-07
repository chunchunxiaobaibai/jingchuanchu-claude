import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { build } from 'vite';
import {
  bindRouteLink,
  createRouter,
  defineComponent,
  defineRoutes,
} from '@xiaobaibaifqy/jingchuanchu-app/application';
import type {
  HistoryDriver,
  HistoryEventKind,
  HistoryLocation,
} from '@xiaobaibaifqy/jingchuanchu-app/application';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function memoryHistory(initial = '/'): HistoryDriver & {
  readonly pushes: string[];
} {
  let location: HistoryLocation = { path: initial, query: {}, hash: '' };
  const listeners = new Set<(value: HistoryLocation, kind: HistoryEventKind) => void>();
  const pushes: string[] = [];
  return {
    pushes,
    get location() {
      return location;
    },
    push(path: string) {
      pushes.push(path);
      location = { path, query: {}, hash: '' };
    },
    replace(path: string) {
      location = { path, query: {}, hash: '' };
    },
    back() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const HomePage = defineComponent({
  selector: 'loading-home',
  setup() {
    return {};
  },
  $template: '<span>home</span>',
});
const LoadedPage = defineComponent({
  selector: 'loading-page',
  setup() {
    return {};
  },
  $template: '<span>loaded</span>',
});

test('lazy loading deduplicates concurrent requests and caches success', async () => {
  let loads = 0;
  const router = createRouter({
    routes: defineRoutes([
      { name: 'home', path: '/', page: HomePage },
      {
        name: 'play',
        path: '/play',
        loadPage: async () => {
          loads += 1;
          await Promise.resolve();
          return LoadedPage;
        },
      },
    ]),
    history: memoryHistory(),
  });
  await Promise.all([router.preload('/play'), router.preload('/play')]);
  assert.equal(loads, 1);
  assert.equal((await router.push('/play')).status, 'committed');
  assert.equal(loads, 1);
  assert.equal(router.current!.record.name, 'play');
  router.dispose();
});

test('failed chunks are not cached forever', async () => {
  let attempts = 0;
  const router = createRouter({
    routes: defineRoutes([
      {
        name: 'play',
        path: '/play',
        loadPage: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('chunk failed');
          return LoadedPage;
        },
      },
    ]),
    history: memoryHistory(),
  });
  await assert.rejects(router.preload('/play'), /chunk failed/);
  await router.preload('/play');
  assert.equal(attempts, 2);
  router.dispose();
});

test('preload never prepares, commits, changes the URL or starts a page', async () => {
  let prepared = 0;
  let commits = 0;
  const history = memoryHistory();
  const router = createRouter({
    routes: defineRoutes([
      {
        name: 'play',
        path: '/play',
        loadPage: async () => LoadedPage,
        prepare: () => {
          prepared += 1;
          return {};
        },
      },
    ]),
    history,
    commit() {
      commits += 1;
    },
  });
  await router.preload('/play');
  assert.equal(prepared, 0);
  assert.equal(commits, 0);
  assert.equal(router.current, undefined);
  assert.deepEqual(history.pushes, []);
  assert.equal(history.location.path, '/');
  router.dispose();
});

test('intent and idle preload only load routes with matching strategies', async () => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const counts = { intent: 0, idle: 0, none: 0 };
  const router = createRouter({
    routes: defineRoutes([
      {
        name: 'intent',
        path: '/intent',
        preload: 'intent',
        loadPage: async () => {
          counts.intent += 1;
          return LoadedPage;
        },
      },
      {
        name: 'idle',
        path: '/idle',
        preload: 'idle',
        loadPage: async () => {
          counts.idle += 1;
          return LoadedPage;
        },
      },
      {
        name: 'none',
        path: '/none',
        loadPage: async () => {
          counts.none += 1;
          return LoadedPage;
        },
      },
    ]),
    history: memoryHistory(),
  });
  const intentLink = document.createElement('a');
  bindRouteLink(intentLink, router, { name: 'intent' });
  const noneLink = document.createElement('a');
  bindRouteLink(noneLink, router, { name: 'none' });
  intentLink.dispatchEvent(new window.Event('focus') as unknown as Event);
  noneLink.dispatchEvent(new window.Event('focus') as unknown as Event);
  await settle();
  assert.deepEqual(counts, { intent: 1, idle: 0, none: 0 });
  await router.preloadIdle();
  assert.deepEqual(counts, { intent: 1, idle: 1, none: 0 });
  router.dispose();
});

test('vite build emits a real dynamic page chunk', async () => {
  const directory = await mkdtemp(join(process.cwd(), '.jcc-vite-'));
  try {
    const source = join(directory, 'src');
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, 'main.ts'),
      "const loadPage = () => import('./page.js');\n(globalThis as any).loadPage = loadPage;\n",
    );
    await writeFile(
      join(source, 'page.ts'),
      "export const PAGE_MARKER = 'JCC_PAGE_CHUNK_MARKER';\nexport const Page = { marker: PAGE_MARKER };\n",
    );
    const outDir = join(directory, 'dist');
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: true,
        minify: false,
        rollupOptions: {
          input: join(source, 'main.ts'),
          output: { entryFileNames: 'entry.js', chunkFileNames: 'chunks/[name]-[hash].js' },
        },
      },
    });
    const files = (await readdir(outDir, { recursive: true })) as string[];
    const scripts = files.filter((file) => file.endsWith('.js'));
    assert.ok(scripts.length >= 2);
    const entry = await readFile(join(outDir, 'entry.js'), 'utf8');
    assert.equal(entry.includes('JCC_PAGE_CHUNK_MARKER'), false);
    const contents = await Promise.all(scripts.map((file) => readFile(join(outDir, file), 'utf8')));
    assert.ok(contents.some((content) => content.includes('JCC_PAGE_CHUNK_MARKER')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
