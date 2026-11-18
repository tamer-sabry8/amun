/** xterm's supported documentOverride keeps its dynamic styles nonce-scoped. */
export function terminalDocument(document: Document, nonce: string): Document {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(nonce))
    throw Error("Invalid terminal style nonce");
  return new Proxy(document, {
    get(target, key) {
      if (key === "createElement")
        return (tag: string, options?: ElementCreationOptions) => {
          const element = target.createElement(tag, options);
          if (tag.toLowerCase() === "style") element.nonce = nonce;
          return element;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
