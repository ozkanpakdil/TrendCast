/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly IS_FIREFOX?: boolean;
  readonly BUILD_VERSION?: string;
  readonly DEBUG_LOG_FORWARD?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite worker import type — `import X from './file?worker'` gives a
// Worker constructor.
declare module '*?worker' {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}