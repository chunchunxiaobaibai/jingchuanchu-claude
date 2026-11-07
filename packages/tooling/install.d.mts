export declare function addModules(
  project?: string,
  options?: { modules?: string[]; all?: boolean; bundle?: string },
): Promise<{ packages: string[]; vendor: string; next: string }>;
