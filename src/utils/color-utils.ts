/* src/utils/color-utils.ts
 * Color parsing/formatting helpers for RGBA theme settings.
 * Why: keep user input safe and consistent across UI + CSS output.
 * Related: src/settings.ts, src/main.ts, styles.css */
export interface RgbaColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface HsvColor {
	h: number;
	s: number;
	v: number;
	a: number;
}

const HEX_REGEX = /^#([0-9a-f]{3,8})$/i;

export function parseRgbaColor(value: string): RgbaColor | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const hexMatch = trimmed.match(HEX_REGEX);
	if (hexMatch?.[1]) {
		return parseHexColor(hexMatch[1]);
	}
	if (trimmed.toLowerCase().startsWith("rgb")) {
		return parseRgbFunction(trimmed);
	}
	return null;
}

export function formatRgbaColor(color: RgbaColor): string {
	const safe = clampRgbaColor(color);
	const alpha = formatAlpha(safe.a);
	return `rgba(${safe.r}, ${safe.g}, ${safe.b}, ${alpha})`;
}

export function formatHexColor(color: RgbaColor): string {
	const safe = clampRgbaColor(color);
	return `#${toHex(safe.r)}${toHex(safe.g)}${toHex(safe.b)}`;
}

export function rgbToHsv(color: RgbaColor): HsvColor {
	// Normalize to 0-1 for stable HSV conversion.
	const r = clampChannel(color.r) / 255;
	const g = clampChannel(color.g) / 255;
	const b = clampChannel(color.b) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;

	let h = 0;
	if (delta > 0) {
		if (max === r) {
			h = ((g - b) / delta) % 6;
		} else if (max === g) {
			h = (b - r) / delta + 2;
		} else {
			h = (r - g) / delta + 4;
		}
		h *= 60;
		if (h < 0) {
			h += 360;
		}
	}

	const s = max === 0 ? 0 : delta / max;
	return {h, s, v: max, a: clampAlpha(color.a)};
}

export function hsvToRgb(color: HsvColor): RgbaColor {
	// Wrap hue into 0..360 to avoid NaN when users drag fast.
	const h = ((color.h % 360) + 360) % 360;
	const s = clampUnit(color.s);
	const v = clampUnit(color.v);
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;

	let r = 0;
	let g = 0;
	let b = 0;

	if (h < 60) {
		r = c;
		g = x;
	} else if (h < 120) {
		r = x;
		g = c;
	} else if (h < 180) {
		g = c;
		b = x;
	} else if (h < 240) {
		g = x;
		b = c;
	} else if (h < 300) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}

	return clampRgbaColor({
		r: (r + m) * 255,
		g: (g + m) * 255,
		b: (b + m) * 255,
		a: color.a,
	});
}

export function normalizeRgbaString(value: string, fallback: string): string {
	const parsed = parseRgbaColor(value) ?? parseRgbaColor(fallback);
	if (!parsed) {
		return "rgba(0, 0, 0, 1)";
	}
	return formatRgbaColor(parsed);
}

function parseHexColor(hex: string): RgbaColor | null {
	const normalized = hex.toLowerCase();
	if (![3, 4, 6, 8].includes(normalized.length)) {
		return null;
	}
	const expanded =
		normalized.length <= 4
			? normalized
					.split("")
					.map((value) => `${value}${value}`)
					.join("")
			: normalized;
	const r = Number.parseInt(expanded.slice(0, 2), 16);
	const g = Number.parseInt(expanded.slice(2, 4), 16);
	const b = Number.parseInt(expanded.slice(4, 6), 16);
	const a =
		expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
	if (![r, g, b, a].every((value) => Number.isFinite(value))) {
		return null;
	}
	return clampRgbaColor({r, g, b, a});
}

function parseRgbFunction(value: string): RgbaColor | null {
	const openParen = value.indexOf("(");
	const closeParen = value.lastIndexOf(")");
	if (openParen < 0 || closeParen <= openParen) {
		return null;
	}
	const body = value.slice(openParen + 1, closeParen);
	const parts = body
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	if (parts.length < 3) {
		return null;
	}
	const [rPart, gPart, bPart, aPart] = parts;
	if (!rPart || !gPart || !bPart) {
		return null;
	}
	const r = parseRgbChannel(rPart);
	const g = parseRgbChannel(gPart);
	const b = parseRgbChannel(bPart);
	const a = aPart ? parseAlphaChannel(aPart) : 1;
	if (r === null || g === null || b === null || a === null) {
		return null;
	}
	return clampRgbaColor({r, g, b, a});
}

function parseRgbChannel(value: string): number | null {
	if (value.endsWith("%")) {
		const percentage = Number.parseFloat(value);
		if (!Number.isFinite(percentage)) {
			return null;
		}
		return clampChannel(Math.round(percentage * 2.55));
	}
	const numeric = Number.parseFloat(value);
	if (!Number.isFinite(numeric)) {
		return null;
	}
	return clampChannel(Math.round(numeric));
}

function parseAlphaChannel(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed.endsWith("%")) {
		const percentage = Number.parseFloat(trimmed);
		if (!Number.isFinite(percentage)) {
			return null;
		}
		return clampAlpha(percentage / 100);
	}
	const numeric = Number.parseFloat(trimmed);
	if (!Number.isFinite(numeric)) {
		return null;
	}
	if (numeric > 1) {
		// Accept 0-255 style alpha input when users paste hex-like values.
		return clampAlpha(numeric / 255);
	}
	return clampAlpha(numeric);
}

function clampRgbaColor(color: RgbaColor): RgbaColor {
	return {
		r: clampChannel(color.r),
		g: clampChannel(color.g),
		b: clampChannel(color.b),
		a: clampAlpha(color.a),
	};
}

function clampChannel(value: number): number {
	return Math.min(255, Math.max(0, Math.round(value)));
}

function clampAlpha(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function formatAlpha(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	const fixed = rounded.toFixed(2);
	return fixed.replace(/\.?0+$/, "");
}

function toHex(value: number): string {
	return clampChannel(value).toString(16).padStart(2, "0");
}
