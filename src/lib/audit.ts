import { lookup } from "node:dns/promises";
import { readFile, readdir, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface ExternalAddress {
  address: string;
  family: 4 | 6;
}

export type ExternalResolver = (hostname: string) => Promise<ExternalAddress[]>;

interface AuditOptions {
  forbiddenText?: string[];
  forbiddenPaths?: string[];
  expectedFiles?: Iterable<string>;
  checkExternalLinks?: boolean;
  externalTimeoutMs?: number;
  fetcher?: typeof fetch;
  resolver?: ExternalResolver;
}

export interface AuditReport {
  errors: string[];
  warnings: string[];
}

export function draftFingerprints(
  data: Record<string, unknown>,
  body: string,
  renderedHtml: string,
) {
  const visibleHtml = renderedHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|#38);/g, "&")
    .replace(/&(?:lt|#60|#x3c);/gi, "<")
    .replace(/&(?:gt|#62);/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  const escapedHtml = renderedHtml
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const textChunks = [...renderedHtml.matchAll(/>([^<>]+)</g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 8);
  const bodyChunks = body
    .split(/\n\s*\n|(?<=[.!?])\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 8);
  const tags = Array.isArray(data.tags)
    ? data.tags
        .filter((value): value is string => typeof value === "string")
        .map(
          (value) =>
            `/tags/${value
              .normalize("NFKD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")}/`,
        )
    : [];
  const aliases = Array.isArray(data.aliases)
    ? data.aliases
        .filter((value): value is string => typeof value === "string")
        .map((value) => `/posts/${value}/`)
    : [];
  return [
    data.title,
    data.description,
    data.slug,
    body.trim(),
    renderedHtml.trim(),
    escapedHtml.trim(),
    visibleHtml,
    ...textChunks,
    ...bodyChunks,
    ...tags,
    ...aliases,
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.length >= 4,
    )
    .filter((value, index, values) => values.indexOf(value) === index);
}

async function walk(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(root, path) : [relative(root, path)];
    }),
  );
  return nested.flat();
}

function htmlRoute(file: string) {
  const normalized = file.split(sep).join("/");
  if (normalized === "index.html") return "/";
  if (normalized.endsWith("/index.html")) {
    return `/${normalized.slice(0, -"index.html".length)}`;
  }
  return `/${normalized}`;
}

function references(html: string) {
  const values: Array<{ value: string; reportExternal: boolean }> = [];
  for (const match of html.matchAll(
    /<([a-z][a-z0-9-]*)\b[^>]*\b(?:href|src)=["']([^"']+)["']/gi,
  )) {
    values.push({
      value: match[2],
      reportExternal: match[1].toLowerCase() === "a",
    });
  }
  for (const match of html.matchAll(/\bsrcset=["']([^"']+)["']/gi)) {
    values.push(
      ...match[1].split(",").map((part) => ({
        value: part.trim().split(/\s+/, 1)[0],
        reportExternal: false,
      })),
    );
  }
  return values;
}

function targetFor(reference: string, file: string) {
  if (/^(?:mailto|tel|data):/i.test(reference))
    return { kind: "ignored" as const };
  if (/^(?:https?:)?\/\//i.test(reference)) {
    return { kind: "external" as const, value: reference };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference)) {
    return { kind: "unsafe" as const, value: reference };
  }
  try {
    const url = new URL(
      reference,
      `https://artifact.invalid${htmlRoute(file)}`,
    );
    return {
      kind: "internal" as const,
      path: decodeURIComponent(url.pathname),
      hash: url.hash ? decodeURIComponent(url.hash.slice(1)) : "",
    };
  } catch {
    return { kind: "unsafe" as const, value: reference };
  }
}

function routeCandidates(root: string, path: string) {
  const clean = path.replace(/^\//, "");
  return [resolve(root, clean), resolve(root, clean, "index.html")].filter(
    (candidate) => {
      const local = relative(root, candidate);
      return !isAbsolute(local) && !local.startsWith("..");
    },
  );
}

async function firstFile(paths: string[]) {
  for (const path of paths) {
    const info = await stat(path).catch(() => null);
    if (info?.isFile()) return path;
  }
  return null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

const systemResolver: ExternalResolver = async (hostname) => {
  const family = isIP(hostname);
  if (family)
    return [{ address: hostname, family: family as ExternalAddress["family"] }];
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({
    address,
    family: family as ExternalAddress["family"],
  }));
};

function privateExternalAddress({ address, family }: ExternalAddress) {
  return family === 4
    ? blockedIpv4.check(address, "ipv4")
    : blockedIpv6.check(address, "ipv6");
}

interface ExternalResponse {
  status: number;
  location?: string;
}

function pinnedRequest(
  url: URL,
  method: "HEAD" | "GET",
  address: ExternalAddress,
  timeoutMs: number,
) {
  return new Promise<ExternalResponse>((resolveRequest, rejectRequest) => {
    const pinnedLookup: LookupFunction = (_hostname, _options, callback) =>
      callback(null, address.address, address.family);
    const tlsHostname = url.hostname.replace(/^\[|\]$/g, "");
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method,
        agent: false,
        lookup: pinnedLookup,
        ...(url.protocol === "https:" && !isIP(tlsHostname)
          ? { servername: tlsHostname }
          : {}),
      },
      (response) => {
        const location = response.headers.location;
        resolveRequest({
          status: response.statusCode ?? 0,
          ...(location ? { location } : {}),
        });
        response.destroy();
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error("request timed out")),
    );
    request.on("error", rejectRequest);
    request.end();
  });
}

async function externalRequest(
  url: URL,
  method: "HEAD" | "GET",
  address: ExternalAddress,
  timeoutMs: number,
  fetcher?: typeof fetch,
) {
  if (!fetcher) return pinnedRequest(url, method, address, timeoutMs);
  const response = await fetcher(url.href, {
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: response.status,
    location: response.headers.get("location") ?? undefined,
  };
}

export async function checkExternalLink(
  value: string,
  fetcher?: typeof fetch,
  timeoutMs = 4_000,
  resolver: ExternalResolver = systemResolver,
) {
  try {
    const initial = new URL(value.startsWith("//") ? `https:${value}` : value);
    const follow = async (method: "HEAD" | "GET") => {
      let url = initial;
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        if (url.protocol !== "http:" && url.protocol !== "https:")
          throw new Error(`unsupported redirect protocol ${url.protocol}`);
        const hostname = url.hostname.replace(/^\[|\]$/g, "");
        const addresses = await resolver(hostname);
        if (!addresses.length) throw new Error("host has no addresses");
        if (addresses.some(privateExternalAddress)) {
          return {
            warning: `External link not checked because it targets a private address: ${url.href}`,
          };
        }
        const response = await externalRequest(
          url,
          method,
          addresses[0],
          timeoutMs,
          fetcher,
        );
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!response.location)
            throw new Error(`redirect ${response.status} has no location`);
          if (redirects === 5) throw new Error("too many redirects");
          url = new URL(response.location, url);
          continue;
        }
        return { response };
      }
      throw new Error("too many redirects");
    };

    let attempt = await follow("HEAD");
    if (attempt.warning) return attempt.warning;
    if (attempt.response?.status === 405) attempt = await follow("GET");
    if (attempt.warning) return attempt.warning;
    const response = attempt.response!;
    const inaccessibleButPossiblyLive = [401, 403, 429].includes(
      response.status,
    );
    if (response.status >= 400 && !inaccessibleButPossiblyLive) {
      return `External link unreachable (${response.status}): ${value}`;
    }
    return null;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request failed";
    return `External link unreachable (${reason}): ${value}`;
  }
}

export async function auditBuildReport(
  root: string,
  options: AuditOptions = {},
): Promise<AuditReport> {
  const absoluteRoot = resolve(root);
  const files = await walk(absoluteRoot);
  const errors: string[] = [];
  const warnings: string[] = [];
  const externalLinks = new Set<string>();
  const expectedFiles = options.expectedFiles
    ? new Set(
        [...options.expectedFiles].map((file) => file.split(sep).join("/")),
      )
    : null;

  if (expectedFiles) {
    const actualFiles = new Set(files.map((file) => file.split(sep).join("/")));
    for (const file of actualFiles) {
      if (!expectedFiles.has(file)) {
        errors.push(`Unexpected production artifact: ${file}`);
      }
    }
    for (const file of expectedFiles) {
      if (!actualFiles.has(file)) {
        errors.push(`Missing production artifact from manifest: ${file}`);
      }
    }
  }

  for (const file of files) {
    const normalized = file.split(sep).join("/");
    if (normalized === "cms" || normalized.startsWith("cms/")) {
      errors.push(`CMS artifact found: ${normalized}`);
    }
    if (extname(file) === ".map")
      errors.push(`Source map found: ${normalized}`);
    if (/site\.config|content-originals|(^|\/)src\//i.test(normalized)) {
      errors.push(`Private source file found: ${normalized}`);
    }
    for (const forbidden of options.forbiddenPaths ?? []) {
      if (normalized.startsWith(forbidden.replace(/^\//, ""))) {
        errors.push(`Draft asset path found: ${normalized}`);
      }
    }

    if (!/\.(?:html|xml|txt|js|css|json|svg)$/i.test(file)) continue;
    const source = await readFile(join(absoluteRoot, file), "utf8");
    if (/\/(?:home|Users)\/[^\s"'<]+|[A-Z]:\\Users\\/i.test(source)) {
      errors.push(`Absolute local path found in ${normalized}`);
    }
    for (const forbidden of options.forbiddenText ?? []) {
      if (forbidden && source.includes(forbidden)) {
        errors.push(
          `Forbidden draft text "${forbidden.slice(0, 60)}" found in ${normalized}`,
        );
      }
    }
    if (!file.endsWith(".html")) continue;

    for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\balt\s*=/i.test(match[0])) {
        errors.push(`Image without alt attribute in ${normalized}`);
      }
      if (!/\bsrc\s*=\s*["'][^"']+["']/i.test(match[0])) {
        errors.push(`Image without source in ${normalized}`);
      }
    }

    for (const match of source.matchAll(/<iframe\b[^>]*>/gi)) {
      if (!/\btitle\s*=\s*["'][^"']+[^\s"'][^"']*["']/i.test(match[0])) {
        errors.push(`Iframe without a descriptive title in ${normalized}`);
      }
    }

    for (const match of source.matchAll(
      /<video\b[^>]*>[\s\S]*?<\/video\s*>/gi,
    )) {
      if (!/<track\b[^>]*\bkind\s*=\s*["']captions["'][^>]*>/i.test(match[0])) {
        warnings.push(
          `Video without a captions track in ${normalized}; confirm it is silent or provide captions`,
        );
      }
    }

    for (const reference of references(source)) {
      const target = targetFor(reference.value, file);
      if (target.kind === "ignored") continue;
      if (target.kind === "external") {
        if (reference.reportExternal) {
          externalLinks.add(reference.value);
        }
        continue;
      }
      if (target.kind === "unsafe") {
        errors.push(
          `Unsafe or invalid reference ${reference.value} in ${normalized}`,
        );
        continue;
      }
      const targetFile = await firstFile(
        routeCandidates(absoluteRoot, target.path),
      );
      if (!targetFile) {
        errors.push(
          `Broken internal reference ${reference.value} in ${normalized}`,
        );
        continue;
      }
      if (target.hash) {
        const targetHtml = await readFile(targetFile, "utf8");
        const anchor = escapeRegex(target.hash);
        if (!new RegExp(`\\b(?:id|name)=["']${anchor}["']`).test(targetHtml)) {
          errors.push(
            `Broken internal anchor #${target.hash} in ${normalized}`,
          );
        }
      }
    }
  }

  if (options.checkExternalLinks) {
    for (const value of externalLinks) {
      const warning = await checkExternalLink(
        value,
        options.fetcher,
        options.externalTimeoutMs,
        options.resolver,
      );
      if (warning) warnings.push(warning);
    }
  }

  return {
    errors: [...new Set(errors)].sort(),
    warnings: [...new Set(warnings)].sort(),
  };
}

export async function auditBuild(root: string, options: AuditOptions = {}) {
  return (await auditBuildReport(root, options)).errors;
}
