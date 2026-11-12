const IPV4_PART = /^\d{1,3}$/;
const HEXTET_PART = /^[0-9a-fA-F]{1,4}$/;
const PORT_SUFFIX = /^:(\d{1,5})$/;

function parseIpv4Octets(input: string): [number, number, number, number] | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!IPV4_PART.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }

  const [a, b, c, d] = octets;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return null;
  }
  return [a, b, c, d];
}

function isValidPort(rawPort: string): boolean {
  const port = Number(rawPort);
  return Number.isInteger(port) && port >= 0 && port <= 65535;
}

function stripPortAndZone(trimmed: string): string | null {
  if (trimmed.startsWith("[")) {
    const closeIdx = trimmed.indexOf("]");
    if (closeIdx <= 1) return null;
    const rest = trimmed.slice(closeIdx + 1);
    if (rest !== "") {
      const portMatch = PORT_SUFFIX.exec(rest);
      if (!portMatch?.[1] || !isValidPort(portMatch[1])) return null;
    }
    const inside = trimmed.slice(1, closeIdx);
    const zoneIdx = inside.indexOf("%");
    if (zoneIdx === -1) return inside;
    return zoneIdx > 0 && zoneIdx < inside.length - 1 ? inside.slice(0, zoneIdx) : null;
  }

  const firstColon = trimmed.indexOf(":");
  if (firstColon !== -1 && trimmed.indexOf(":", firstColon + 1) === -1) {
    const host = trimmed.slice(0, firstColon);
    const port = trimmed.slice(firstColon + 1);
    if (!PORT_SUFFIX.test(`:${port}`) || !isValidPort(port)) return null;
    return host;
  }

  if (firstColon !== -1) {
    const zoneIdx = trimmed.indexOf("%");
    if (zoneIdx !== -1) {
      return zoneIdx > 0 && zoneIdx < trimmed.length - 1 ? trimmed.slice(0, zoneIdx) : null;
    }
  }

  return trimmed;
}

function expandIpv4Tail(parts: string[]): boolean {
  const last = parts[parts.length - 1];
  if (!last || !last.includes(".")) return true;
  const octets = parseIpv4Octets(last);
  if (!octets) return false;
  const high = ((octets[0] << 8) | octets[1]).toString(16);
  const low = ((octets[2] << 8) | octets[3]).toString(16);
  parts.splice(parts.length - 1, 1, high, low);
  return true;
}

function parseIpv6Hextets(input: string): number[] | null {
  const halves = input.split("::");
  if (halves.length > 2) return null;

  const leftRaw = halves[0] ?? "";
  const rightRaw = halves.length === 2 ? (halves[1] ?? "") : null;

  const leftParts = leftRaw === "" ? [] : leftRaw.split(":");
  const rightParts = rightRaw === null || rightRaw === "" ? [] : rightRaw.split(":");

  if (rightRaw !== null) {
    if (rightParts.length > 0) {
      if (!expandIpv4Tail(rightParts)) return null;
    } else if (leftParts.length > 0 && leftParts[leftParts.length - 1]?.includes(".")) {
      return null;
    }
  } else if (!expandIpv4Tail(leftParts)) {
    return null;
  }

  for (const part of leftParts) {
    if (!HEXTET_PART.test(part)) return null;
  }
  for (const part of rightParts) {
    if (!HEXTET_PART.test(part)) return null;
  }

  let fullParts: string[];
  if (rightRaw === null) {
    if (leftParts.length !== 8) return null;
    fullParts = leftParts;
  } else {
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing < 1) return null;
    fullParts = [...leftParts, ...Array.from({ length: missing }, () => "0"), ...rightParts];
  }

  return fullParts.map((part) => Number.parseInt(part, 16));
}

export function ipBucket(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  const trimmed = raw.trim();
  if (!trimmed) return "unknown";

  const cleaned = stripPortAndZone(trimmed);
  if (!cleaned) return "unknown";

  if (!cleaned.includes(":")) {
    const octets = parseIpv4Octets(cleaned);
    if (!octets) return "unknown";
    return `${octets[0]}.${octets[1]}.${octets[2]}.${octets[3]}`;
  }

  const hextets = parseIpv6Hextets(cleaned);
  if (!hextets || hextets.length !== 8) return "unknown";

  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;
  if (
    h0 === undefined ||
    h1 === undefined ||
    h2 === undefined ||
    h3 === undefined ||
    h4 === undefined ||
    h5 === undefined ||
    h6 === undefined ||
    h7 === undefined
  ) {
    return "unknown";
  }

  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return `${h6 >> 8}.${h6 & 0xff}.${h7 >> 8}.${h7 & 0xff}`;
  }

  // Residential and mobile IPv6 clients rotate interface identifiers inside a /64 prefix.
  return [h0, h1, h2, h3]
    .map((h) => h.toString(16).padStart(4, "0"))
    .join(":")
    .concat("/64");
}
