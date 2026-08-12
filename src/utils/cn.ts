export type ClassValue = string | false | null | undefined;

/** Small class-name joiner used by NativeWind components. */
export const cn = (...values: ClassValue[]): string => values.filter(Boolean).join(' ');

export default cn;
