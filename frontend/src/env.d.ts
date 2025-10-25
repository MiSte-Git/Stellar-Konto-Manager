/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPPORT_EMAIL: string;
  readonly VITE_BUGTRACKER_ADMIN_SECRET: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
