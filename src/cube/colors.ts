// Printed-ink takes on the six cube colours, in facelet face order
// (U R F D L B = white, red, green, yellow, orange, blue). Kept apart from
// CubeView so pages without three.js (the timer) can use them.
export const STICKER_HEX = [0xf4f3ee, 0xd3262c, 0x16965a, 0xf5c518, 0xf0761b, 0x1f4cc2];

export const hexCss = (hex: number) => `#${hex.toString(16).padStart(6, "0")}`;
