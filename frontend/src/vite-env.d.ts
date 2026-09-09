export {};

declare global {
  interface ImportMeta {
    readonly env: {
      readonly [key: string]: string | undefined;
      readonly MODE: string;
      readonly DEV: boolean;
      readonly VITE_API_BASE_URL?: string;
    };
  }
}