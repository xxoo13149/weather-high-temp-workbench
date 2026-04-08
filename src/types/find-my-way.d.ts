declare module "find-my-way/lib/node.js" {
  type StaticNodeConstructor = {
    prototype: {
      prefix?: string;
      matchPrefix?: (path: string, index: number) => boolean;
      _compilePrefixMatch?: () => void;
      __patchedFindMyWay?: boolean;
    };
  };

  const value: {
    StaticNode?: StaticNodeConstructor;
  };

  export default value;
}
