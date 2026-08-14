/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly IS_FIREFOX?: boolean;
  readonly BUILD_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}