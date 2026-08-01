const SUSPICIOUS_PROTOCOL_PATTERN = /(?:javascript|vbscript|data|file)\s*:/i;

function decodedUrlText(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.toLowerCase();
}

function ipv4Octets(hostname: string): readonly [number, number, number, number] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return undefined;
  const octets = hostname.split(".").map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return undefined;
  return octets as [number, number, number, number];
}

function isUnsafeIpv4Octets([first, second]: readonly [number, number, number, number]): boolean {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function expandedIpv6(hostname: string): readonly number[] | undefined {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host.includes(":")) return undefined;
  if (!/^[0-9a-f:]+$/.test(host) || host.indexOf("::") !== host.lastIndexOf("::")) return undefined;

  const [leftText, rightText] = host.split("::") as [string, string?];
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;

  const missing = 8 - left.length - right.length;
  if ((host.includes("::") && missing < 1) || (!host.includes("::") && missing !== 0)) return undefined;
  const groups = [
    ...left.map((group) => Number.parseInt(group, 16)),
    ...Array.from({ length: missing }, () => 0),
    ...right.map((group) => Number.parseInt(group, 16)),
  ];
  return groups.length === 8 ? groups : undefined;
}

function isUnsafeIpv6(hostname: string): boolean {
  const groups = expandedIpv6(hostname);
  if (!groups) return false;
  const [first] = groups as readonly [number, ...number[]];

  const unspecified = groups.every((group) => group === 0);
  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const uniqueLocal = (first & 0xfe00) === 0xfc00;
  const linkLocal = (first & 0xffc0) === 0xfe80;
  const multicast = (first & 0xff00) === 0xff00;

  const ipv4MappedPrefix = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const ipv4CompatiblePrefix = groups.slice(0, 6).every((group) => group === 0);
  const embeddedIpv4 = ipv4MappedPrefix || ipv4CompatiblePrefix
    ? ([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff] as const)
    : undefined;

  return (
    unspecified ||
    loopback ||
    uniqueLocal ||
    linkLocal ||
    multicast ||
    (embeddedIpv4 !== undefined && isUnsafeIpv4Octets(embeddedIpv4))
  );
}

export function safeExternalHttpsUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const ipv4 = ipv4Octets(hostname);
  if (
    url.protocol !== "https:" ||
    Boolean(url.username || url.password) ||
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (ipv4 !== undefined && isUnsafeIpv4Octets(ipv4)) ||
    isUnsafeIpv6(hostname) ||
    SUSPICIOUS_PROTOCOL_PATTERN.test(decodedUrlText(url.href))
  ) {
    return undefined;
  }

  return url;
}

export function isSafeExternalHttpsUrl(value: string): boolean {
  return safeExternalHttpsUrl(value) !== undefined;
}

export function isUnsafeSourceUrl(value: string): boolean {
  return !isSafeExternalHttpsUrl(value);
}

export function canonicalizeSafeExternalHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = safeExternalHttpsUrl(value);
  if (!url) return undefined;
  url.hash = "";
  return url.toString();
}
