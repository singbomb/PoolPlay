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

import { z } from "zod/v4";
import { TEAM_GENDERS, TEAM_REGIONS } from "@/lib/constants/team";
import {
  USER_PLAYER_GENDERS,
  VOLLEYBALL_POSITIONS,
} from "@/lib/constants/profile";
import { CREATABLE_PLAY_FORMATS } from "@/lib/labels/play-format";
import { isCollegeEmail } from "@/lib/utils/college-email";

export const signUpSchema = z.object({
  email: z
    .email()
    .refine(
      (val) => isCollegeEmail(val),
      "Use your school email (e.g. name@school.edu or your institution’s domain)."
    ),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(1, "Full name is required"),
  university: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required"),
});

const optionalEnum = <T extends readonly string[]>(values: T) =>
  z
    .union([z.enum(values), z.literal("")])
    .optional()
    .transform((value) => (value === "" || value === undefined ? null : value));

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(120),
  playerGender: optionalEnum(USER_PLAYER_GENDERS),
  volleyballPosition: optionalEnum(VOLLEYBALL_POSITIONS),
});

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email address"),
});

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const createTeamSchema = z.object({
  name: z.string().min(1, "Team name is required"),
  gender: z.enum(TEAM_GENDERS, { message: "Select men's or women's" }),
  region: z.enum(TEAM_REGIONS, { message: "Select a region" }),
  schoolId: z.string().uuid().optional().nullable(),
});

export const createSchoolSchema = z.object({
  name: z.string().min(1, "School name is required").max(120),
  university: z.string().min(1, "University is required").max(120),
  gender: z.enum(TEAM_GENDERS, { message: "Select men's or women's" }),
  region: z.enum(TEAM_REGIONS, { message: "Select a region" }),
  description: z.string().max(2000).optional().nullable(),
  websiteUrl: z
    .string()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
  domainHint: z
    .string()
    .max(120)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim().length > 0 ? v.trim().toLowerCase() : null)),
});

export const updateSchoolSchema = createSchoolSchema.partial();

export const addSchoolMemberSchema = z.object({
  email: z.email("Enter a valid email"),
  role: z.enum(["officer", "member"], {
    message: "Choose officer or member",
  }),
  title: z
    .string()
    .max(60)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null)),
});

export const createTournamentSchema = z.object({
  hostSchoolId: z.string().uuid("Select the hosting school"),
  name: z.string().min(1, "Tournament name is required"),
  description: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  location: z.string().min(1, "Location is required"),
  address: z.string().optional(),
  playFormat: z.enum(CREATABLE_PLAY_FORMATS, {
    message: "Choose a supported tournament format",
  }),
});

export const createDivisionSchema = z.object({
  name: z.string().min(1, "Pool name is required"),
});

export const updateScoreSchema = z.object({
  matchId: z.string().uuid(),
  setNumber: z.number().int().positive(),
  teamAScore: z.number().int().min(0),
  teamBScore: z.number().int().min(0),
  expectedRevision: z.number().int().min(0),
});

const updateMatchFormatBaseSchema = z.object({
  matchFormat: z.enum(["play_all_3", "best_of_2", "two_with_tiebreak"], {
    message: "Choose a match format",
  }),
  setStartingScore: z
    .number()
    .int()
    .min(0, "Starting score can't be negative")
    .max(50, "Starting score is too high"),
  setTargetScore: z
    .number()
    .int()
    .min(5, "Target score must be at least 5")
    .max(50, "Target score is too high"),
  tiebreakTargetScore: z
    .number()
    .int()
    .min(5, "Tiebreak target must be at least 5")
    .max(30, "Tiebreak target is too high"),
  warmupFormat: z.enum(["none", "three_three_one"], {
    message: "Choose a warmup format",
  }),
  poolTiebreakCriteria: z
    .array(z.enum(["match_record", "set_record", "point_diff", "head_to_head"]))
    .min(1, "Select at least one tie-break criterion"),
});

export const updateMatchFormatSchema = updateMatchFormatBaseSchema
  .refine((v) => v.setStartingScore < v.setTargetScore, {
    path: ["setStartingScore"],
    message: "Starting score must be less than the target score",
  })
  .refine((v) => v.setStartingScore < v.tiebreakTargetScore, {
    path: ["setStartingScore"],
    message: "Starting score must be less than the tiebreak target",
  })
  .refine((v) => new Set(v.poolTiebreakCriteria).size === v.poolTiebreakCriteria.length, {
    path: ["poolTiebreakCriteria"],
    message: "Tie-break criteria must be unique",
  });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type CreateDivisionInput = z.infer<typeof createDivisionSchema>;
export type UpdateScoreInput = z.infer<typeof updateScoreSchema>;
export type UpdateMatchFormatInput = z.infer<typeof updateMatchFormatSchema>;
export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;
export type AddSchoolMemberInput = z.infer<typeof addSchoolMemberSchema>;
