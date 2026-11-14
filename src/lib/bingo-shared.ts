/** Client-safe bingo constants (game.ts is server-only). */
export const COLUMNS = [0, 1, 2, 3, 4].map(c => [c, c + 5, c + 10, c + 15, c + 20]);
export const LETTERS = ["B", "I", "N", "G", "O"] as const;
