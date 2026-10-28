export interface SessionConfig {
  auth_mode: string;
  dev_login: boolean;
  system_high: string;
  login_url: string;
}

export interface PlatformRow {
  id: string;
  tail_number: string;
  designation: string;
  group_size: string;
  portion_mark: string;
  airworthiness: string;
  classification: string;
}

export class BannerMissing extends Error {
  constructor() {
    super("banner header missing");
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<{ banner: string; body: T }> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const banner = response.headers.get("X-A2E-Banner");
  if (!banner) {
    throw new BannerMissing();
  }
  const body = (await response.json()) as T;
  if (!response.ok) {
    const detail = typeof body === "object" && body && "detail" in body ? String((body as { detail: unknown }).detail) : response.statusText;
    throw new Error(detail);
  }
  return { banner, body };
}
