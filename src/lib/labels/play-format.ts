/*
 * PoolPlay - Collegiate club volleyball tournament hub
 * Copyright (C) 2026 Andrew Chang
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

export const PLAY_FORMATS = [
  "pool_to_bracket",
  "single_elimination",
  "double_elimination",
] as const;

export type PlayFormat = (typeof PLAY_FORMATS)[number];

export const CREATABLE_PLAY_FORMATS = [
  "pool_to_bracket",
  "single_elimination",
] as const satisfies readonly PlayFormat[];

export type CreatablePlayFormat = (typeof CREATABLE_PLAY_FORMATS)[number];

export const DOUBLE_ELIMINATION_UNAVAILABLE_MESSAGE =
  "Double elimination is not available for new tournaments yet.";

export function isCreatablePlayFormat(
  value: unknown
): value is CreatablePlayFormat {
  return CREATABLE_PLAY_FORMATS.includes(value as CreatablePlayFormat);
}

const PLAY_FORMAT_LABELS: Record<PlayFormat, string> = {
  pool_to_bracket: "Group play to bracket",
  single_elimination: "Single elimination",
  double_elimination: "Double elimination",
};

const PLAY_FORMAT_DESCRIPTIONS: Record<PlayFormat, string> = {
  pool_to_bracket:
    "Teams play round-robin in pools, then top finishers advance to elimination brackets.",
  single_elimination:
    "Teams go straight into a single-elimination bracket; one loss eliminates a team.",
  double_elimination:
    "Teams play in winners and losers brackets; a team must lose twice to be eliminated.",
};

export function formatPlayFormatLabel(format: PlayFormat | string): string {
  return (
    PLAY_FORMAT_LABELS[format as PlayFormat] ??
    format.replace(/_/g, " ")
  );
}

export function playFormatDescription(format: PlayFormat | string): string {
  return (
    PLAY_FORMAT_DESCRIPTIONS[format as PlayFormat] ??
    ""
  );
}

export const PLAY_FORMAT_OPTIONS = CREATABLE_PLAY_FORMATS.map((value) => ({
  value,
  label: PLAY_FORMAT_LABELS[value],
  description: PLAY_FORMAT_DESCRIPTIONS[value],
}));
