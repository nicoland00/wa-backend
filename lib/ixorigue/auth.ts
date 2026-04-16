export function decodeJwtPayload(token: string) {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("Invalid JWT structure");
  }

  const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const json = Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

export function inferIxorigueRefreshTokenMetadata(refreshToken: string) {
  const payload = decodeJwtPayload(refreshToken);
  const issuer = typeof payload.iss === "string" ? payload.iss.replace(/\/+$/, "") : null;

  return {
    clientId: typeof payload.azp === "string" ? payload.azp : process.env.IXORIGUE_CLIENT_ID || "platform",
    tokenUrl: process.env.IXORIGUE_TOKEN_URL || (issuer ? `${issuer}/protocol/openid-connect/token` : null),
  };
}

