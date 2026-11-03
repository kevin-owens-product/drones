export declare const BANNER: string;

export interface DemoOptions {
  speed?: number | string;
  extra?: number | string;
  terrain?: unknown;
  assetBase?: string;
}

export interface Demo {
  extra: number;
  handle(method: string, url: URL, raw?: string): { status: number; body: unknown };
}

export declare function createDemo(opts?: DemoOptions): Demo;
