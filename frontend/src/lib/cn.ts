export function cn(...args: Array<string | false | undefined | null>): string {
  return args.filter(Boolean).join(' ');
}