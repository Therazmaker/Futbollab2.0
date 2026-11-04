export interface ClubData {
  id: string;
  name: string;
  shortName: string;
  leagueCode: string;
  leagueName: string;
  rank: number;
  points: number;
  goalDifference: number;
  winRate: number;
  meanXg: number;
  ppda: number;
  tempo: string;
  form: string[];
  formation: string;
  badgeUrl: string;
  density: number;
  predAccuracy: number;
}

export interface PlayerData {
  id: string;
  name: string;
  number: number;
  clubName: string;
  nationality: string;
  position: string;
  role: string;
  age: number;
  height: number;
  photoUrl: string;
  predictiveForm: number;
  pitchBiasDelta: number;
  confidence: number;
  metrics: {
    shotsObserved: number;
    shotsPredicted: number;
    keyPassesObserved: number;
    keyPassesPredicted: number;
    aerialDuelWinPct: number;
    xtThreat: number;
  };
}

export const INITIAL_CLUBS: ClubData[] = [
  {
    id: "rmd",
    name: "Real Madrid CF",
    shortName: "RMD",
    leagueCode: "laliga",
    leagueName: "LaLiga",
    rank: 1,
    points: 68,
    goalDifference: 34,
    winRate: 82,
    meanXg: 2.41,
    ppda: 8.6,
    tempo: "18.4 m/s",
    form: ["W", "W", "W", "D", "W"],
    formation: "4-3-1-2",
    badgeUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuDIfxcvoBCPvtYy-GIQmSp-Dow-fMvM-g40ZpzX4LW3EprnYvecexSz2jZ1hVGp28kmIVJkIHlBM8OvL0j4qY9Cs-0CFUC6tQwDHoNE2IO7l6B71Slde3MdVfdsLdy4XJkQk7XfmRYoDdnLXb5m2gNvNOS5nxVqDMcu-xA0AzEU2_zM5a_jlavqxMZ5EsSn1iQHslWNjVLOP1Zm1OjeO5XGNT9eCQNvBNY1Qln8xFrU",
    density: 94.2,
    predAccuracy: 96.4,
  },
  {
    id: "mci",
    name: "Manchester City",
    shortName: "MCI",
    leagueCode: "premier",
    leagueName: "Premier League",
    rank: 1,
    points: 67,
    goalDifference: 38,
    winRate: 79,
    meanXg: 2.58,
    ppda: 7.9,
    tempo: "16.8 m/s",
    form: ["W", "W", "D", "W", "W"],
    formation: "3-2-4-1",
    badgeUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuCCZxX_RKG9Kw3V_AeffYvAEQZ2O-5SNDJjJEqhkjWP8GPcs1IU8folt_fcjW990glWUrRs9flIwRjiTzynkHsXm5RqkDcE4EQLrOGrNucBcf3IJ9qRXStGoFVJJTa7B5T4xcQhC33v621mQumluyW0ASW341nwt8t57tCU32NG0YQ4gnG3Mlm00Wgo5wvOl3cNDCVAI_Xc8UyMmliSxBJkglldb8klQJ1tOUvVjNnO",
    density: 96.1,
    predAccuracy: 95.8,
  },
  {
    id: "fcb",
    name: "FC Barcelona",
    shortName: "BAR",
    leagueCode: "laliga",
    leagueName: "LaLiga",
    rank: 2,
    points: 62,
    goalDifference: 29,
    winRate: 73,
    meanXg: 2.29,
    ppda: 8.2,
    tempo: "17.2 m/s",
    form: ["W", "D", "W", "W", "L"],
    formation: "4-3-3",
    badgeUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuB0A5-GaExMX0cNCouFyrxKzk5ScShdPQ6A26VEwd6Ni2YtaAp4jUVnSupHxD6m65qdlGGjKrgaIGmta2dx_ncybtv7O-dUDosyF9Qp3VWq3De15Y-MWZUsYgvgtcVVc098gP9C1lLBAwRl4poSTs8cdUlqfZsD4Vpuv-gwbS3DwSdylHf3Kho3fm-KkfaPF3ABN-vb-FsUo-__tFXY5jJMYlnSVa50NF6wixwlI71E",
    density: 91.5,
    predAccuracy: 93.1,
  },
  {
    id: "ars",
    name: "Arsenal FC",
    shortName: "ARS",
    leagueCode: "premier",
    leagueName: "Premier League",
    rank: 2,
    points: 65,
    goalDifference: 35,
    winRate: 76,
    meanXg: 2.34,
    ppda: 8.4,
    tempo: "17.9 m/s",
    form: ["W", "W", "W", "W", "D"],
    formation: "4-3-3",
    badgeUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuAKJYvbPUeSnZf54oZrzLQMUQ6QZxo1JxZUX-oO7C1xUN28V7PVBNxt3nlcAOvnE5Rw8A0LTkY0ODrvOoTpP8hZA3_V38oE9Z43AMvv7fSRxAzSf0ka2hjBqfqLRQcfkB3J0czmS-_oD2qk1joeD7lX38uEdLw901OLid8UbL2_slu__TgMo_JstpqJoxWi7xp_6yVo5CHUC0zN0MaRp0WwuS9CjedFv0ixAJvDFnrU",
    density: 93.8,
    predAccuracy: 94.7,
  },
];

export const INITIAL_PLAYER: PlayerData = {
  id: "jude-5",
  name: "Jude Bellingham",
  number: 5,
  clubName: "Real Madrid CF",
  nationality: "ENG",
  position: "AM / Box-to-Box",
  role: "Midfield Infiltrator & Shadow Striker",
  age: 20,
  height: 186,
  photoUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuBmp3UT4x6eeOZBQ4lYVC34e4635kRT-n3a4j0Ryu3pmTIYhyJtPE3wMs8Wunqbnq7Ry6pUYGdJ4DjtsMoQoumh71lGAJHc8xGKQ3TgiLKYB4h67dqKVWqTFKPmjkTJGWilcQhUjgS-9oFprvSUqs2XogenY2Y9q6bnjtWQATXbmTh0pwIPfojZDOTq4J-3TKrA3qn6zEKFHsoACuO0-SRr7tfmPk3XcpXmf_QL7ETm",
  predictiveForm: 9.42,
  pitchBiasDelta: 8.4,
  confidence: 99.4,
  metrics: {
    shotsObserved: 2.1,
    shotsPredicted: 2.4,
    keyPassesObserved: 2.8,
    keyPassesPredicted: 3.1,
    aerialDuelWinPct: 68.4,
    xtThreat: 0.84,
  },
};
