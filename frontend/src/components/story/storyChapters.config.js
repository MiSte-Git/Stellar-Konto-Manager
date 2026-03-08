/**
 * Central chapter configuration.
 *
 * Edit ONLY this file to change:
 *   - durationMinutes  – estimated play time shown in ChapterSelect
 *   - tested           – dev-only badge; set to true once a chapter is fully tested
 *   - subtitle         – topic label shown below the chapter title (i18n key: chapter{n}.subtitle)
 *   - ADVANCED_CHAPTERS – which chapters get the 🔴 "Fortgeschritten" badge
 *   - TOTAL_CHAPTERS   – total number of chapters in the story
 *
 * No component or locale file needs to be touched for these data changes.
 */

export const TOTAL_CHAPTERS = 9;

export const ADVANCED_CHAPTERS = [8, 9];

/** @type {Record<number, { durationMinutes: number, tested: boolean, subtitle: string }>} */
export const CHAPTER_REGISTRY = {
  1: { tested: true,  durationMinutes: 5,  subtitle: "Wallet & Keypair" },
  2: { tested: true,  durationMinutes: 7,  subtitle: "Transaktionen & Memo" },
  3: { tested: true,  durationMinutes: 7,  subtitle: "Assets & Trust Lines" },
  4: { tested: true,  durationMinutes: 10, subtitle: "Scams & Social Engineering" },
  5: { tested: true,  durationMinutes: 12, subtitle: "Dezentralisierung & Sicherheit" },
  6: { tested: true, durationMinutes: 10, subtitle: "Muxed Accounts" },
  7: { tested: true, durationMinutes: 12, subtitle: "Multisignatur" },
  8: { tested: false, durationMinutes: 15, subtitle: "Smart Contracts & Soroban" },
  9: { tested: false, durationMinutes: 15, subtitle: "Clawback" },
};
