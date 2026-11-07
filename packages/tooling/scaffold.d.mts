export declare function createProject(
  target: string,
  options?: {
    preset?: string;
    style?: string;
    bundle?: string;
    legacy?: boolean;
  },
): Promise<string>;
export declare function generate(
  kind: string,
  name: string,
  options?: {
    project?: string;
    parent?: string;
    style?: string;
    route?: string;
    page?: string;
    shared?: boolean;
    domain?: string;
    extends?: string;
  },
): Promise<string[]>;
