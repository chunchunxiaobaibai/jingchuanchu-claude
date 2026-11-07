export declare const APPLICATION_PROFILE: 'application';
export declare const LEGACY_PROFILE: 'legacy-v0.4';
export declare const DEFAULT_PATHS: Readonly<{
  app: string;
  pages: string;
  game: string;
  components: string;
  themes: string;
  account: string;
}>;

export declare class ProjectConfigError extends Error {
  readonly file: string;
  constructor(file: string, message: string);
}

export interface ProjectConfig {
  readonly profile: 'application' | 'legacy-v0.4';
  readonly schemaVersion?: 2;
  readonly preset: string;
  readonly style: string;
  readonly paths:
    | undefined
    | Readonly<{
        app: string;
        pages: string;
        game: string;
        components: string;
        themes: string;
        account: string;
      }>;
  readonly raw: Record<string, unknown>;
  readonly configPath: string;
  readonly root: string;
}

export declare function readProjectConfig(root: string): Promise<ProjectConfig>;
