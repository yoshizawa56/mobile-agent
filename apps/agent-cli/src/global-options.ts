export type ParsedGlobalOptions = {
  args: string[];
  verbose: boolean;
};

export function parseGlobalOptions(args: string[]): ParsedGlobalOptions {
  let index = 0;
  let verbose = false;
  while (index < args.length && (args[index] === "-v" || args[index] === "--verbose")) {
    verbose = true;
    index += 1;
  }
  return { args: args.slice(index), verbose };
}
