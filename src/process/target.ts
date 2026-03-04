import { config } from "../config.js";

export interface OpenCodeTarget {
  apiUrl: string;
  port: number;
}

function inferPort(url: URL): number {
  if (url.port) {
    return Number.parseInt(url.port, 10);
  }

  return url.protocol === "https:" ? 443 : 80;
}

export function getConfiguredOpenCodeTarget(): OpenCodeTarget {
  const apiUrl = config.opencode.apiUrl;
  const parsed = new URL(apiUrl);
  const port = inferPort(parsed);
  return { apiUrl, port };
}
