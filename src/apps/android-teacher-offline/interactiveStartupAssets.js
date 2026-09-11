const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
const AUDIO_EXTENSION = /\.(?:m4a|mp3|ogg|wav)(?:$|[?#])/i;
const VIDEO_EXTENSION = /\.(?:m4v|mp4|webm)(?:$|[?#])/i;
const OPAQUE_EXTENSION = /\.(?:gaf)(?:$|[?#])/i;

function abortError(reason = "Asset preload cancelled") {
  if (reason instanceof Error) return reason;
  const error = new Error(String(reason || "Asset preload cancelled"));
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function isAbortError(error, signal) {
  return signal?.aborted || error?.name === "AbortError";
}

function assetUrl(value) {
  if (typeof value === "string") return value;
  return value?.localUrl || value?.devFallbackUrl || value?.url || "";
}

function inferredKind(url) {
  if (/^data:image\//i.test(url)) return "image";
  if (/^data:audio\//i.test(url)) return "audio";
  if (/^data:video\//i.test(url)) return "video";
  if (/^data:application\/(?:x-)?gaf/i.test(url)) return "opaque";
  if (IMAGE_EXTENSION.test(url)) return "image";
  if (AUDIO_EXTENSION.test(url)) return "audio";
  if (VIDEO_EXTENSION.test(url)) return "video";
  if (OPAQUE_EXTENSION.test(url)) return "opaque";
  return "";
}

function requiredManifestAsset(record, url) {
  const kind = record.type === "page" || record.type === "cover" ? "image" : record.type;
  if (!["image", "audio", "video"].includes(kind)) {
    const error = new Error(`Unsupported required Viewer asset type: ${record.type || "unknown"}`);
    error.code = "VIEWER_ASSET_PLAN_INVALID";
    throw error;
  }
  if (!url) {
    const error = new Error(`Required Viewer asset has no runtime URL: ${record.logicalKey || "unknown"}`);
    error.code = "VIEWER_ASSET_PLAN_INVALID";
    throw error;
  }
  return {
    key: record.logicalKey,
    url,
    kind,
    sizeBytes: Number.isFinite(record.sizeBytes) && record.sizeBytes > 0 ? record.sizeBytes : null,
    sha256: /^[a-f0-9]{64}$/i.test(record.sha256 || "") ? record.sha256.toLowerCase() : "",
    source: "content-manifest",
  };
}

export function collectRuntimeAssetUrls(value, found = []) {
  if (typeof value === "string") {
    if (inferredKind(value)) found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectRuntimeAssetUrls(item, found));
    return found;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectRuntimeAssetUrls(item, found));
  }
  return found;
}

export function createBinaryAssetCacheIdentity({ url = "", sha256 = "" } = {}) {
  const fingerprint = /^[a-f0-9]{64}$/i.test(sha256) ? sha256.toLowerCase() : "url";
  return `${fingerprint}:${url}`;
}

export function resolveImmutableViewerAssetUrl(value, {
  locationHref = globalThis.location?.href,
  locationOrigin = globalThis.location?.origin,
} = {}) {
  if (!locationHref || !locationOrigin) return null;
  try {
    const url = new URL(assetUrl(value), locationHref);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.origin !== locationOrigin || !url.pathname.startsWith("/assets/")) return null;
    return url;
  } catch {
    return null;
  }
}

export async function probeImmutableViewerAsset(asset, {
  fetchImpl = globalThis.fetch,
  locationHref = globalThis.location?.href,
  locationOrigin = globalThis.location?.origin,
  signal,
} = {}) {
  throwIfAborted(signal);
  const url = resolveImmutableViewerAssetUrl(asset, { locationHref, locationOrigin });
  if (!url || typeof fetchImpl !== "function") return Object.freeze({ status: "unsupported", asset });
  try {
    const response = await fetchImpl(url.href, {
      cache: "only-if-cached",
      mode: "same-origin",
      credentials: "same-origin",
      signal,
    });
    throwIfAborted(signal);
    return Object.freeze({ status: response?.ok ? "hit" : "miss", asset });
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError(signal?.reason || error);
    return Object.freeze({ status: "miss", asset });
  }
}

export async function classifyImmutableViewerAssets(assets = [], {
  probeAsset = probeImmutableViewerAsset,
  signal,
} = {}) {
  if (typeof probeAsset !== "function") throw new TypeError("Asset cache probe is required.");
  const classified = { hits: [], misses: [], unsupported: [] };
  const results = await Promise.all(assets.map(async (asset) => {
    try {
      throwIfAborted(signal);
      const result = await probeAsset(asset, { signal });
      throwIfAborted(signal);
      return result;
    } catch (error) {
      if (isAbortError(error, signal)) throw abortError(signal?.reason || error);
      return { status: "miss", asset };
    }
  }));
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const result = results[index];
    if (result?.status === "hit") classified.hits.push(asset);
    else if (result?.status === "unsupported") classified.unsupported.push(asset);
    else classified.misses.push(asset);
  }
  return Object.freeze({
    hits: Object.freeze(classified.hits),
    misses: Object.freeze(classified.misses),
    unsupported: Object.freeze(classified.unsupported),
  });
}

export function deduplicateAssetUrls(assets = []) {
  const unique = new Map();
  for (const candidate of assets) {
    if (!candidate?.url) continue;
    const existing = unique.get(candidate.url);
    if (!existing) {
      unique.set(candidate.url, {
        ...candidate,
        cacheIdentity: createBinaryAssetCacheIdentity(candidate),
      });
      continue;
    }
    unique.set(candidate.url, {
      ...existing,
      sizeBytes: Math.max(existing.sizeBytes || 0, candidate.sizeBytes || 0) || null,
      sha256: existing.sha256 || candidate.sha256 || "",
      cacheIdentity: createBinaryAssetCacheIdentity({
        url: existing.url,
        sha256: existing.sha256 || candidate.sha256 || "",
      }),
    });
  }
  return [...unique.values()];
}

export function buildHostedViewerAssetLoadPlan({
  manifestAssets = [],
  pageAssetUrls = {},
  mediaAssetUrls = {},
  uiAssetUrls = [],
  runtimeAssets = [],
} = {}) {
  const manifestPlan = manifestAssets
    .filter((record) => record?.required !== false)
    .map((record) => {
      const resolved = record.type === "page" || record.type === "cover"
        ? pageAssetUrls[record.logicalKey]
        : mediaAssetUrls[record.logicalKey];
      return requiredManifestAsset(record, assetUrl(resolved));
    });
  const uiPlan = uiAssetUrls.map((value, index) => {
    const url = assetUrl(value);
    const kind = inferredKind(url);
    if (!kind) return null;
    return {
      key: `viewer-ui-${index + 1}`,
      url,
      kind,
      sizeBytes: null,
      sha256: "",
      source: "viewer-ui",
    };
  }).filter(Boolean);
  const runtimePlan = runtimeAssets.map((record, index) => {
    const url = assetUrl(record);
    const kind = record?.kind || inferredKind(url);
    if (!url || !kind) return null;
    return {
      key: record?.key || `viewer-runtime-${index + 1}`,
      url,
      kind,
      sizeBytes: record?.sizeBytes || null,
      sha256: record?.sha256 || "",
      source: record?.source || "viewer-runtime",
    };
  }).filter(Boolean);
  const all = deduplicateAssetUrls([...manifestPlan, ...uiPlan, ...runtimePlan]);
  const blocking = all.filter((asset) => asset.kind !== "video");
  const blockingUrls = new Set(blocking.map((asset) => asset.url));
  const background = all.filter((asset) => asset.kind === "video" && !blockingUrls.has(asset.url));
  return Object.freeze({
    blocking: Object.freeze(blocking),
    background: Object.freeze(background),
  });
}

export function createAssetProgress(assets = [], initiallyCompleted = []) {
  const reliableWeights = assets.map((asset) => asset.sizeBytes).filter((size) => Number.isFinite(size) && size > 0);
  const fallbackWeight = reliableWeights.length
    ? reliableWeights.reduce((sum, size) => sum + size, 0) / reliableWeights.length
    : 1;
  const weights = new Map(assets.map((asset) => [asset.url, asset.sizeBytes || fallbackWeight]));
  const completed = new Set();
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  let lastPercentage = assets.length ? 0 : 100;

  const snapshot = () => Object.freeze({
    completedAssets: completed.size,
    totalAssets: assets.length,
    percentage: lastPercentage,
  });
  initiallyCompleted.forEach((asset) => {
    if (weights.has(asset?.url)) completed.add(asset.url);
  });
  if (completed.size) {
    const completedWeight = [...completed].reduce((sum, url) => sum + weights.get(url), 0);
    lastPercentage = completed.size === assets.length ? 100 : Math.floor((completedWeight / totalWeight) * 100);
  }
  return Object.freeze({
    complete(asset) {
      if (!weights.has(asset?.url) || completed.has(asset.url)) return snapshot();
      completed.add(asset.url);
      const completedWeight = [...completed].reduce((sum, url) => sum + weights.get(url), 0);
      const calculated = completed.size === assets.length
        ? 100
        : Math.floor((completedWeight / totalWeight) * 100);
      lastPercentage = Math.max(lastPercentage, Math.min(100, calculated));
      return snapshot();
    },
    snapshot,
  });
}

function combinedSignal(parentSignal, localSignal) {
  const signals = [parentSignal, localSignal].filter(Boolean);
  if (signals.length < 2) return signals[0];
  if (globalThis.AbortSignal?.any) return globalThis.AbortSignal.any(signals);
  const controller = new AbortController();
  const abort = (event) => controller.abort(event.target?.reason);
  signals.forEach((signal) => {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", abort, { once: true });
  });
  return controller.signal;
}

export async function preloadAssetGroup(assets = [], {
  loadAsset,
  concurrency = 6,
  signal,
  onProgress = () => {},
  continueOnError = false,
  progressAssets = assets,
  initiallyCompleted = [],
} = {}) {
  if (typeof loadAsset !== "function") throw new TypeError("Asset loader is required.");
  const progress = createAssetProgress(progressAssets, initiallyCompleted);
  onProgress(progress.snapshot());
  if (!assets.length) return { errors: [], progress: progress.snapshot() };
  const localController = new AbortController();
  const workerSignal = combinedSignal(signal, localController.signal);
  const errors = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < assets.length) {
      throwIfAborted(workerSignal);
      const asset = assets[cursor];
      cursor += 1;
      try {
        await loadAsset(asset, { signal: workerSignal });
        throwIfAborted(workerSignal);
        onProgress(progress.complete(asset));
      } catch (error) {
        if (workerSignal?.aborted && !continueOnError) throw abortError(workerSignal.reason || error);
        errors.push({ asset, error });
        if (!continueOnError) {
          localController.abort(error);
          throw error;
        }
      }
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), assets.length) }, worker);
  await Promise.all(workers);
  return { errors, progress: progress.snapshot() };
}

function cacheSummary(assets, classification) {
  const preparation = [...classification.misses, ...classification.unsupported];
  const bytes = (items) => items.reduce((sum, asset) => sum + (Number(asset.sizeBytes) || 0), 0);
  return Object.freeze({
    cachedAssets: classification.hits.length,
    preparationAssets: preparation.length,
    totalAssets: assets.length,
    cachedBytes: bytes(classification.hits),
    preparationBytes: bytes(preparation),
  });
}

export async function preloadDifferentialAssetGroup(assets = [], {
  loadAsset,
  probeAsset = probeImmutableViewerAsset,
  concurrency = 6,
  signal,
  onCacheState = () => {},
  onProgress = () => {},
  continueOnError = false,
} = {}) {
  const classification = await classifyImmutableViewerAssets(assets, { probeAsset, signal });
  const preparation = [...classification.misses, ...classification.unsupported];
  const summary = cacheSummary(assets, classification);
  onCacheState(Object.freeze({
    ...createAssetProgress(assets, classification.hits).snapshot(),
    ...summary,
  }));
  const result = await preloadAssetGroup(preparation, {
    loadAsset,
    concurrency,
    signal,
    onProgress: (progress) => onProgress(Object.freeze({ ...progress, ...summary })),
    continueOnError,
    progressAssets: assets,
    initiallyCompleted: classification.hits,
  });
  return Object.freeze({ ...result, classification, cache: summary });
}

async function drainResponse(response, asset) {
  if (!response?.ok) {
    const error = new Error(`Unable to download required Viewer asset: ${asset.key}`);
    error.code = "VIEWER_ASSET_LOAD_FAILED";
    throw error;
  }
  const reader = response.body?.getReader?.();
  if (reader) {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    return;
  }
  if (typeof response.arrayBuffer === "function") {
    await response.arrayBuffer();
    return;
  }
  const error = new Error(`Complete asset response consumption is unavailable: ${asset.key}`);
  error.code = "VIEWER_ASSET_LOAD_FAILED";
  throw error;
}

async function fetchAsset(asset, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Viewer asset fetch is unavailable.");
  throwIfAborted(signal);
  const response = await fetchImpl(asset.url, { cache: "default", credentials: "same-origin", signal });
  await drainResponse(response, asset);
  throwIfAborted(signal);
}

function waitForImage(asset, { signal, ImageCtor = globalThis.Image } = {}) {
  if (typeof ImageCtor !== "function") return Promise.reject(new Error("Viewer image loading is unavailable."));
  return new Promise((resolve, reject) => {
    const image = new ImageCtor();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      image.src = "";
      finish(abortError(signal.reason));
    };
    image.decoding = "async";
    image.onload = async () => {
      try {
        if (typeof image.decode === "function") await image.decode();
        throwIfAborted(signal);
        finish();
      } catch (error) {
        finish(error);
      }
    };
    image.onerror = () => {
      const error = new Error(`Unable to prepare required Viewer image: ${asset.key}`);
      error.code = "VIEWER_ASSET_LOAD_FAILED";
      finish(error);
    };
    if (signal?.aborted) onAbort();
    else {
      signal?.addEventListener("abort", onAbort, { once: true });
      image.src = asset.url;
    }
  });
}

function waitForMedia(asset, { signal, documentImpl = globalThis.document } = {}) {
  if (!documentImpl?.createElement) return Promise.reject(new Error("Viewer media loading is unavailable."));
  return new Promise((resolve, reject) => {
    const media = documentImpl.createElement(asset.kind === "video" ? "video" : "audio");
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      media.removeEventListener("canplay", onReady);
      media.removeEventListener("error", onError);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      media.pause?.();
      finish(abortError(signal.reason));
    };
    const onReady = () => finish();
    const onError = () => {
      const error = new Error(`Unable to prepare required Viewer media: ${asset.key}`);
      error.code = "VIEWER_ASSET_LOAD_FAILED";
      finish(error);
    };
    media.preload = "auto";
    media.addEventListener("canplay", onReady, { once: true });
    media.addEventListener("error", onError, { once: true });
    if (signal?.aborted) onAbort();
    else {
      signal?.addEventListener("abort", onAbort, { once: true });
      media.src = asset.url;
      media.load();
      if (media.readyState >= 3) onReady();
    }
  });
}

export async function preloadBrowserAsset(asset, options = {}) {
  if (asset.kind === "image") {
    await waitForImage(asset, options);
    return;
  }
  await fetchAsset(asset, options);
  if (asset.kind === "video") await waitForMedia(asset, options);
}

export function createHostedStartupAssets(inventory, {
  blockingConcurrency = 6,
  backgroundConcurrency = 2,
  loadAsset = preloadBrowserAsset,
  probeAsset = probeImmutableViewerAsset,
} = {}) {
  return Object.freeze({
    hosted: true,
    createLoadPlan(pack, uiManifest = null, uiRuntimeContext = null, contentRuntimeContext = null) {
      const uiAssetUrls = typeof inventory.uiAssetUrls === "function"
        ? inventory.uiAssetUrls(uiManifest, pack, uiRuntimeContext)
        : inventory.uiAssetUrls || [];
      const runtimeAssets = typeof inventory.runtimeAssets === "function"
        ? inventory.runtimeAssets(pack, uiManifest, contentRuntimeContext)
        : inventory.runtimeAssets || [];
      return buildHostedViewerAssetLoadPlan({
        manifestAssets: pack?.assetsManifest?.assets,
        pageAssetUrls: inventory.pageAssetUrls,
        mediaAssetUrls: inventory.mediaAssetUrls,
        uiAssetUrls: [
          ...uiAssetUrls,
          ...(inventory.activityAssetUrls?.(pack) || []),
        ],
        runtimeAssets,
      });
    },
    preloadBlocking(plan, options = {}) {
      return preloadDifferentialAssetGroup(plan.blocking, {
        ...options,
        loadAsset,
        probeAsset,
        concurrency: blockingConcurrency,
        continueOnError: false,
      });
    },
    preloadBackground(plan, options = {}) {
      return preloadDifferentialAssetGroup(plan.background, {
        ...options,
        loadAsset,
        probeAsset,
        concurrency: backgroundConcurrency,
        continueOnError: true,
      });
    },
  });
}

export function createNoopStartupAssets() {
  const emptyPlan = Object.freeze({ blocking: Object.freeze([]), background: Object.freeze([]) });
  return Object.freeze({
    hosted: false,
    createLoadPlan: () => emptyPlan,
    preloadBlocking: async (_plan, { onProgress = () => {} } = {}) => {
      const progress = Object.freeze({ completedAssets: 0, totalAssets: 0, percentage: 100 });
      onProgress(progress);
      return { errors: [], progress };
    },
    preloadBackground: async () => ({ errors: [], progress: Object.freeze({ completedAssets: 0, totalAssets: 0, percentage: 100 }) }),
  });
}

export async function runInteractiveViewerStartup({
  loadContentPack,
  loadUiManifest = async () => null,
  prepareHotspots,
  startupAssets,
  assetRuntimeContext = null,
  getContentRuntimeContext = () => null,
  signal,
  onState = () => {},
} = {}) {
  try {
    onState({ status: "loading", phase: "validating", progress: null, pack: null, uiManifest: null, error: null });
    const [pack, , uiManifest] = await Promise.all([loadContentPack(), prepareHotspots(), loadUiManifest({ signal })]);
    throwIfAborted(signal);
    onState({ status: "loading", phase: "planning", progress: null, pack, uiManifest, error: null });
    const plan = startupAssets.createLoadPlan(pack, uiManifest, assetRuntimeContext, getContentRuntimeContext());
    if (startupAssets.hosted) {
      onState({ status: "loading", phase: "checking-cache", progress: null, pack, uiManifest, error: null });
    }
    await startupAssets.preloadBlocking(plan, {
      signal,
      onCacheState: (cache) => onState({
        status: "loading",
        phase: cache.preparationAssets ? "preparing-updates" : "using-cache",
        progress: cache,
        pack,
        uiManifest,
        error: null,
      }),
      onProgress: (progress) => onState({
        status: "loading",
        phase: progress.preparationAssets ? "preparing-updates" : "using-cache",
        progress,
        pack,
        uiManifest,
        error: null,
      }),
    });
    throwIfAborted(signal);
    onState({
      status: "ready",
      phase: "ready",
      progress: Object.freeze({ completedAssets: plan.blocking.length, totalAssets: plan.blocking.length, percentage: 100 }),
      pack,
      uiManifest,
      error: null,
    });
    const backgroundPromise = Promise.resolve()
      .then(() => startupAssets.preloadBackground(plan, { signal }))
      .catch((error) => ({ errors: [{ asset: null, error }], progress: null }));
    return { pack, uiManifest, plan, backgroundPromise };
  } catch (error) {
    if (!signal?.aborted) onState({ status: "error", phase: "error", progress: null, pack: null, uiManifest: null, error });
    throw error;
  }
}
