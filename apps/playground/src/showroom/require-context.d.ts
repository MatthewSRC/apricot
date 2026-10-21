// Types for Metro's require.context, which Expo's Metro config enables.
interface NodeRequire {
  context(
    path: string,
    recursive?: boolean,
    filter?: RegExp,
  ): {
    keys(): string[];
    // biome-ignore lint/suspicious/noExplicitAny: modules of any kind
    (id: string): any;
  };
}
