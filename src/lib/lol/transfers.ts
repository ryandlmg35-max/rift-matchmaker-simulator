import type { CareerLedger, Championship, GameId, Player, PlayerRole, Team, TransferNews } from "./types";
import { uid } from "./generate";
import { ensureRoster, generateAcademyRookie, getResolvedAttrs, pickStarters, playerOverall } from "./players";
import { getOfficialRegionRanking, normalizeRegion } from "./international";

// ---------------------------------------------------------------------------
// Sistema Financeiro e Teto Salarial (Economia de Esports)
// ---------------------------------------------------------------------------

export type FinancialTier = "superteam" | "rich" | "mid" | "budget";

/**
 * Retorna o tier financeiro da região no simulador.
 * As TOP 2 regiões no Ranking Regional Oficial do Hall da Fama são as regiões Major / Superteam!
 */
export function getRegionFinancialTier(
  regionRaw?: string,
  career?: CareerLedger,
  game: GameId = "lol",
): FinancialTier {
  const norm = normalizeRegion(regionRaw ?? "");
  const ranking = getOfficialRegionRanking(career, game);
  const entry = ranking.find((r) => r.region === norm);
  const rank = entry ? entry.rank : 99;

  if (rank <= 2) return "superteam"; // Top 2 do Ranking Regional = Major
  if (rank <= 4) return "rich";      // #3 e #4
  if (rank <= 6) return "mid";       // #5 e #6
  return "budget";
}

/** Teto orçamentário anual base da equipe (em milhares de dólares) */
export function getTeamBaseBudget(
  team: Team,
  regionRaw?: string,
  isChampion = false,
  isSerieB = false,
  career?: CareerLedger,
  game: GameId = "lol",
): number {
  if (team.budget && team.budget > 0) return team.budget;

  const tier = getRegionFinancialTier(team.region || regionRaw, career, game);
  let base = 1000;

  switch (tier) {
    case "superteam":
      base = 3200; // Top 2 do Ranking (Major): $3.2M base
      break;
    case "rich":
      base = 2200; // #3-#4: $2.2M base
      break;
    case "mid":
      base = 1100; // #5-#6: $1.1M base
      break;
    case "budget":
      base = 650;
      break;
  }

  // Grandes organizações históricas têm patrocínios maiores
  const normName = team.name.toLowerCase();
  const isGiant = /t1|gen\.g|g2|fnatic|cloud9|liquid|furia|loud|pain|edg|bilibili|wbg|jdg/i.test(
    normName,
  );
  if (isGiant) base += 500;

  // Bônus por título recente
  if (isChampion) base += 350;

  // Penalidade de 2ª divisão
  if (isSerieB) base = Math.round(base * 0.55);

  return base;
}

/**
 * Salário anual estimado de um jogador (em K dólares).
 * Jogadores vindos das 2 melhores regiões do ranking mundial possuem custo salarial muito maior
 * se contratados por ligas de escalões inferiores (taxa de importação, moradia, moeda forte).
 */
export function getPlayerSalary(
  player: Player,
  teamRegionRaw?: string,
  career?: CareerLedger,
  game: GameId = "lol",
): number {
  const attrs = getResolvedAttrs(player.attrs, player.ign, player.role, player.country, player.age);
  const overall = Math.round(
    attrs.mechanics * 0.35 +
      attrs.gameIq * 0.25 +
      attrs.clutch * 0.15 +
      attrs.mentality * 0.15 +
      attrs.intlExperience * 0.1,
  );

  let baseSalary = 60;
  if (overall >= 90) baseSalary = 500 + (overall - 90) * 35; // 500k - 800k
  else if (overall >= 84) baseSalary = 280 + (overall - 84) * 30; // 280k - 460k
  else if (overall >= 78) baseSalary = 160 + (overall - 78) * 18; // 160k - 260k
  else if (overall >= 70) baseSalary = 90 + (overall - 70) * 8; // 90k - 150k
  else baseSalary = 45 + Math.max(0, overall - 50) * 2; // 45k - 85k

  // Identifica dinamicamente quais são os países das 2 melhores regiões do ranking do save:
  const ranking = getOfficialRegionRanking(career, game);
  const top2Regions = ranking.filter((r) => r.isTop2).map((r) => r.region);

  const majorCountries = new Set<string>();
  for (const reg of top2Regions) {
    if (reg === "LCK") majorCountries.add("KR");
    else if (reg === "LPL") majorCountries.add("CN");
    else if (reg === "CBLOL") majorCountries.add("BR");
    else if (reg === "LEC") ["EU", "FR", "DE", "ES", "DK", "SE", "PL", "GB"].forEach((c) => majorCountries.add(c));
    else if (reg === "LCS") ["US", "CA"].forEach((c) => majorCountries.add(c));
    else if (reg === "LCP") ["TW", "HK", "VN", "SG", "PH"].forEach((c) => majorCountries.add(c));
  }

  const playerCountry = (player.country ?? "").toUpperCase();
  const teamRegNorm = normalizeRegion(teamRegionRaw ?? "");
  const isTeamInTop2 = top2Regions.includes(teamRegNorm);
  const isPlayerFromTop2 = majorCountries.has(playerCountry);

  if (isPlayerFromTop2 && !isTeamInTop2) {
    // Para um time de região que não está no Top 2, importar jogador de região elite custa 60% a mais!
    baseSalary = Math.round(baseSalary * 1.6);
  }

  return baseSalary;
}

/**
 * Splits restantes no contrato atual de um jogador.
 * Se não houver valor explícito, atribui deterministicamente 1 a 3 splits
 * para evitar que todo mundo fique livre ou saia do nada ao mesmo tempo.
 */
export function getPlayerContractSplits(player: Player): number {
  if (typeof player.contractSplits === "number") {
    return Math.max(0, Math.round(player.contractSplits));
  }
  const key = `${player.ign}|${player.role}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return 1 + (Math.abs(h) % 3); // 1, 2 ou 3 splits
}

/**
 * Multa rescisória (buyout) em K dólares para tirar um jogador sob contrato.
 * Em fim de contrato (0 splits), a multa é zero.
 */
export function getPlayerBuyout(
  player: Player,
  teamRegionRaw?: string,
  career?: CareerLedger,
  game: GameId = "lol",
): number {
  const splits = getPlayerContractSplits(player);
  if (splits <= 0) return 0;
  const salary = getPlayerSalary(player, teamRegionRaw, career, game);
  const subFactor = player.sub ? 0.45 : 1;
  return Math.round(salary * (0.75 + splits * 0.6) * subFactor);
}

/** País nativo correspondente à região */
export function getNativeCountryForRegion(regionRaw?: string): string {
  const r = (regionRaw ?? "").toUpperCase();
  if (["CBLOL", "BR"].includes(r)) return "BR";
  if (["LCK", "KR"].includes(r)) return "KR";
  if (["LPL", "CN"].includes(r)) return "CN";
  if (["LCS", "NA"].includes(r)) return "US";
  if (["LEC", "EU"].includes(r)) return "EU";
  if (["LCP", "PCS"].includes(r)) return "TW";
  return "BR";
}

/** Verifica se um jogador é considerado estrangeiro (import) naquela liga */
export function isPlayerImport(player: Player, teamRegionRaw?: string): boolean {
  const native = getNativeCountryForRegion(teamRegionRaw);
  const pCountry = (player.country ?? "").toUpperCase();
  if (!pCountry) return false;
  if (native === "US" && ["US", "CA"].includes(pCountry)) return false;
  if (native === "EU" && ["EU", "FR", "DE", "ES", "DK", "SE", "PL", "GB"].includes(pCountry))
    return false;
  if (native === "TW" && ["TW", "HK", "VN", "SG", "PH"].includes(pCountry)) return false;
  return pCountry !== native;
}

// ---------------------------------------------------------------------------
// Pool Global de Agentes Livres Reais (Separados por Região)
// ---------------------------------------------------------------------------

/** Nomes genéricos antigos que eram clonados entre várias ligas — removidos automaticamente na hidratação */
export const LEGACY_FICTIONAL_FREE_AGENTS = new Set([
  "zephyr",
  "predator",
  "horizon",
  "shadowaim",
  "colossus",
  "valkyrie",
  "titanclaw",
  "krypton",
  "vortex",
  "solari",
  "nightfall",
  "sparky",
  "bould",
  "raptor",
  "misty",
]);

export function isLegacyClonedPlayer(p: Player, teamName = ""): boolean {
  const norm = p.ign.trim().toLowerCase();
  if (LEGACY_FICTIONAL_FREE_AGENTS.has(norm)) return true;
  // O antigo pool tinha um "Aegis" fictício (Support, KR, 86 OVR) que entrava em todas as ligas;
  // o Aegis real é Jungler BR (RED Canids).
  if (norm === "aegis" && (p.role === "support" || p.country === "KR")) {
    return true;
  }
  return false;
}

export const GLOBAL_FREE_AGENT_POOL: Omit<Player, "id">[] = [
  // LCK / Coreia do Sul (Jogadores reais disponíveis no mercado)
  {
    ign: "Rascal",
    real: "Kim Kwang-hee",
    role: "top",
    country: "KR",
    age: 26,
    attrs: { mechanics: 79, gameIq: 81, clutch: 78, mentality: 80, intlExperience: 65 },
  },
  {
    ign: "Croco",
    real: "Kim Dong-beom",
    role: "jungle",
    country: "KR",
    age: 24,
    attrs: { mechanics: 80, gameIq: 79, clutch: 78, mentality: 77, intlExperience: 55 },
  },
  {
    ign: "Fate",
    real: "Yoo Su-hyeok",
    role: "mid",
    country: "KR",
    age: 24,
    attrs: { mechanics: 80, gameIq: 81, clutch: 77, mentality: 79, intlExperience: 50 },
  },
  {
    ign: "Teddy",
    real: "Park Jin-seong",
    role: "adc",
    country: "KR",
    age: 26,
    attrs: { mechanics: 82, gameIq: 81, clutch: 80, mentality: 82, intlExperience: 68 },
  },
  {
    ign: "Effort",
    real: "Lee Sang-ho",
    role: "support",
    country: "KR",
    age: 24,
    attrs: { mechanics: 77, gameIq: 80, clutch: 76, mentality: 78, intlExperience: 60 },
  },

  // LPL / China
  {
    ign: "Cube",
    real: "Dai Yi",
    role: "top",
    country: "CN",
    age: 22,
    attrs: { mechanics: 79, gameIq: 78, clutch: 77, mentality: 77, intlExperience: 45 },
  },
  {
    ign: "Meteor",
    real: "Zeng Guo-Hao",
    role: "jungle",
    country: "CN",
    age: 24,
    attrs: { mechanics: 80, gameIq: 80, clutch: 78, mentality: 79, intlExperience: 45 },
  },
  {
    ign: "Angel",
    real: "Xiang Tao",
    role: "mid",
    country: "CN",
    age: 24,
    attrs: { mechanics: 80, gameIq: 81, clutch: 79, mentality: 80, intlExperience: 68 },
  },
  {
    ign: "Lwx",
    real: "Lin Wei-Xiang",
    role: "adc",
    country: "CN",
    age: 26,
    attrs: { mechanics: 80, gameIq: 80, clutch: 81, mentality: 80, intlExperience: 75 },
  },
  {
    ign: "Mark",
    real: "Ling Xu",
    role: "support",
    country: "CN",
    age: 25,
    attrs: { mechanics: 78, gameIq: 81, clutch: 78, mentality: 79, intlExperience: 60 },
  },

  // LEC / Europa
  {
    ign: "Wunder",
    real: "Martin Hansen",
    role: "top",
    country: "EU",
    age: 26,
    attrs: { mechanics: 78, gameIq: 82, clutch: 80, mentality: 81, intlExperience: 78 },
  },
  {
    ign: "Markoon",
    real: "Mark van Woerkom",
    role: "jungle",
    country: "EU",
    age: 22,
    attrs: { mechanics: 78, gameIq: 77, clutch: 75, mentality: 76, intlExperience: 40 },
  },
  {
    ign: "Abbedagge",
    real: "Felix Braun",
    role: "mid",
    country: "EU",
    age: 25,
    attrs: { mechanics: 78, gameIq: 79, clutch: 76, mentality: 77, intlExperience: 55 },
  },
  {
    ign: "Crownie",
    real: "Juš Marušič",
    role: "adc",
    country: "EU",
    age: 26,
    attrs: { mechanics: 79, gameIq: 79, clutch: 78, mentality: 78, intlExperience: 52 },
  },
  {
    ign: "Trymbi",
    real: "Adrian Trybus",
    role: "support",
    country: "EU",
    age: 24,
    attrs: { mechanics: 78, gameIq: 80, clutch: 78, mentality: 77, intlExperience: 62 },
  },

  // LCS / América do Norte
  {
    ign: "Licorice",
    real: "Eric Ritchie",
    role: "top",
    country: "US",
    age: 26,
    attrs: { mechanics: 77, gameIq: 80, clutch: 78, mentality: 80, intlExperience: 65 },
  },
  {
    ign: "Spica",
    real: "Mingyi Lu",
    role: "jungle",
    country: "US",
    age: 23,
    attrs: { mechanics: 78, gameIq: 78, clutch: 77, mentality: 77, intlExperience: 52 },
  },
  {
    ign: "Insanity",
    real: "David Challe",
    role: "mid",
    country: "US",
    age: 24,
    attrs: { mechanics: 76, gameIq: 77, clutch: 75, mentality: 76, intlExperience: 35 },
  },
  {
    ign: "Zven",
    real: "Jesper Svenningsen",
    role: "adc",
    country: "US",
    age: 27,
    attrs: { mechanics: 79, gameIq: 82, clutch: 79, mentality: 81, intlExperience: 78 },
  },
  {
    ign: "Zeyzal",
    real: "Tristan Stidam",
    role: "support",
    country: "US",
    age: 25,
    attrs: { mechanics: 75, gameIq: 80, clutch: 76, mentality: 79, intlExperience: 58 },
  },

  // CBLOL / Brasil
  {
    ign: "Tay",
    real: "Rodrigo Panisa",
    role: "top",
    country: "BR",
    age: 27,
    attrs: { mechanics: 76, gameIq: 79, clutch: 77, mentality: 79, intlExperience: 55 },
  },
  {
    ign: "Ranger",
    real: "Filipe Brombilla",
    role: "jungle",
    country: "BR",
    age: 26,
    attrs: { mechanics: 76, gameIq: 80, clutch: 77, mentality: 80, intlExperience: 45 },
  },
  {
    ign: "Hauz",
    real: "Bruno Ferreira",
    role: "mid",
    country: "BR",
    age: 24,
    attrs: { mechanics: 78, gameIq: 76, clutch: 76, mentality: 75, intlExperience: 35 },
  },
  {
    ign: "Netuno",
    real: "Lucas Flores",
    role: "adc",
    country: "BR",
    age: 22,
    attrs: { mechanics: 78, gameIq: 75, clutch: 76, mentality: 75, intlExperience: 30 },
  },
  {
    ign: "Damage",
    real: "Yan Sales",
    role: "support",
    country: "BR",
    age: 25,
    attrs: { mechanics: 76, gameIq: 78, clutch: 77, mentality: 78, intlExperience: 45 },
  },

  // LCP / PCS
  {
    ign: "Rest",
    real: "Hsu Shih-Chieh",
    role: "top",
    country: "TW",
    age: 25,
    attrs: { mechanics: 77, gameIq: 78, clutch: 76, mentality: 77, intlExperience: 55 },
  },
  {
    ign: "Gemini",
    real: "Huang Chu-Xuan",
    role: "jungle",
    country: "TW",
    age: 24,
    attrs: { mechanics: 76, gameIq: 77, clutch: 75, mentality: 76, intlExperience: 48 },
  },
  {
    ign: "Mission",
    real: "Chen Hsiao-Hsien",
    role: "mid",
    country: "TW",
    age: 25,
    attrs: { mechanics: 76, gameIq: 78, clutch: 75, mentality: 76, intlExperience: 45 },
  },
  {
    ign: "Shunn",
    real: "Chao Ying-Shun",
    role: "adc",
    country: "TW",
    age: 22,
    attrs: { mechanics: 77, gameIq: 75, clutch: 75, mentality: 75, intlExperience: 40 },
  },
  {
    ign: "Koala",
    real: "Lin Chih-Chiang",
    role: "support",
    country: "TW",
    age: 27,
    attrs: { mechanics: 75, gameIq: 79, clutch: 76, mentality: 78, intlExperience: 60 },
  },

  // Alemanha (DE)
  {
    ign: "Gilius",
    real: "Erberk Demir",
    role: "jungle",
    country: "DE",
    age: 27,
    attrs: { mechanics: 78, gameIq: 80, clutch: 79, mentality: 78, intlExperience: 62 },
  },

  // Dinamarca (DK)
  {
    ign: "Broxah",
    real: "Mads Brock-Pedersen",
    role: "jungle",
    country: "DK",
    age: 27,
    attrs: { mechanics: 79, gameIq: 82, clutch: 80, mentality: 83, intlExperience: 78 },
  },
  {
    ign: "Santorin",
    real: "Lucas Tao Kilmer Larsen",
    role: "jungle",
    country: "DK",
    age: 27,
    attrs: { mechanics: 78, gameIq: 82, clutch: 79, mentality: 82, intlExperience: 72 },
  },
  {
    ign: "TynX",
    real: "Kristian Hansen",
    role: "jungle",
    country: "DK",
    age: 25,
    attrs: { mechanics: 77, gameIq: 77, clutch: 75, mentality: 76, intlExperience: 45 },
  },

  // Espanha (ES)
  {
    ign: "xPeke",
    real: "Enrique Cedeño Martínez",
    role: "mid",
    country: "ES",
    age: 30,
    attrs: { mechanics: 77, gameIq: 85, clutch: 86, mentality: 84, intlExperience: 88 },
  },
  {
    ign: "Pepiinero",
    real: "Isaac Alvarado",
    role: "mid",
    country: "ES",
    age: 28,
    attrs: { mechanics: 76, gameIq: 78, clutch: 76, mentality: 77, intlExperience: 50 },
  },

  // Polônia (PL)
  {
    ign: "Agresivoo",
    real: "Tobiasz Ciba",
    role: "top",
    country: "PL",
    age: 25,
    attrs: { mechanics: 78, gameIq: 78, clutch: 76, mentality: 77, intlExperience: 48 },
  },
  {
    ign: "Woolite",
    real: "Paweł Pruski",
    role: "adc",
    country: "PL",
    age: 28,
    attrs: { mechanics: 77, gameIq: 78, clutch: 75, mentality: 77, intlExperience: 52 },
  },

  // Japão (JP)
  {
    ign: "Ceros",
    real: "Kyohei Yoshida",
    role: "mid",
    country: "JP",
    age: 29,
    attrs: { mechanics: 75, gameIq: 81, clutch: 77, mentality: 80, intlExperience: 68 },
  },
  {
    ign: "Enty",
    real: "Ryosei Tanioka",
    role: "support",
    country: "JP",
    age: 27,
    attrs: { mechanics: 75, gameIq: 79, clutch: 76, mentality: 78, intlExperience: 60 },
  },

  // Chile (CL)
  {
    ign: "Warangelus",
    real: "Fabián Llanos",
    role: "adc",
    country: "CL",
    age: 27,
    attrs: { mechanics: 77, gameIq: 77, clutch: 76, mentality: 76, intlExperience: 55 },
  },
  {
    ign: "Slow",
    real: "Eduardo Garcés",
    role: "support",
    country: "CL",
    age: 27,
    attrs: { mechanics: 75, gameIq: 78, clutch: 76, mentality: 77, intlExperience: 55 },
  },

  // Turquia (TR)
  {
    ign: "Armut",
    real: "İrfan Tükek",
    role: "top",
    country: "TR",
    age: 26,
    attrs: { mechanics: 80, gameIq: 80, clutch: 81, mentality: 79, intlExperience: 74 },
  },
  {
    ign: "Serin",
    real: "Tolga Ölmez",
    role: "mid",
    country: "TR",
    age: 25,
    attrs: { mechanics: 77, gameIq: 78, clutch: 76, mentality: 76, intlExperience: 48 },
  },
  {
    ign: "HolyPhoenix",
    real: "Anıl Işık",
    role: "adc",
    country: "TR",
    age: 28,
    attrs: { mechanics: 78, gameIq: 79, clutch: 78, mentality: 79, intlExperience: 64 },
  },

  // República Tcheca (CZ)
  {
    ign: "Dreedy",
    real: "Jakub Viceník",
    role: "top",
    country: "CZ",
    age: 25,
    attrs: { mechanics: 77, gameIq: 77, clutch: 75, mentality: 76, intlExperience: 46 },
  },
  {
    ign: "Jejky",
    real: "David Jakubec",
    role: "jungle",
    country: "CZ",
    age: 25,
    attrs: { mechanics: 76, gameIq: 77, clutch: 75, mentality: 76, intlExperience: 44 },
  },
  {
    ign: "Denyk",
    real: "Petr Haramach",
    role: "support",
    country: "CZ",
    age: 27,
    attrs: { mechanics: 76, gameIq: 79, clutch: 76, mentality: 77, intlExperience: 54 },
  },

  // Reino Unido (GB)
  {
    ign: "Alphari",
    real: "Barney Morris",
    role: "top",
    country: "GB",
    age: 25,
    attrs: { mechanics: 82, gameIq: 81, clutch: 78, mentality: 79, intlExperience: 70 },
  },
  {
    ign: "Maxlore",
    real: "Nubar Sarafian",
    role: "jungle",
    country: "GB",
    age: 28,
    attrs: { mechanics: 77, gameIq: 81, clutch: 78, mentality: 80, intlExperience: 68 },
  },
  {
    ign: "Caedrel",
    real: "Marc Lamont",
    role: "mid",
    country: "GB",
    age: 28,
    attrs: { mechanics: 76, gameIq: 85, clutch: 78, mentality: 82, intlExperience: 65 },
  },
  {
    ign: "xMatty",
    real: "Matthew Coombs",
    role: "adc",
    country: "GB",
    age: 24,
    attrs: { mechanics: 78, gameIq: 77, clutch: 75, mentality: 76, intlExperience: 48 },
  },
  {
    ign: "kaSing",
    real: "Raymond Tsang",
    role: "support",
    country: "GB",
    age: 30,
    attrs: { mechanics: 76, gameIq: 82, clutch: 78, mentality: 81, intlExperience: 72 },
  },

  // Países Baixos (NL)
  {
    ign: "Morsu",
    real: "Bram Knol",
    role: "top",
    country: "NL",
    age: 27,
    attrs: { mechanics: 76, gameIq: 77, clutch: 75, mentality: 76, intlExperience: 46 },
  },
  {
    ign: "Kirei",
    real: "Thomas Yuen",
    role: "jungle",
    country: "NL",
    age: 27,
    attrs: { mechanics: 78, gameIq: 79, clutch: 77, mentality: 77, intlExperience: 58 },
  },
  {
    ign: "Febiven",
    real: "Fabian Diepstraten",
    role: "mid",
    country: "NL",
    age: 28,
    attrs: { mechanics: 79, gameIq: 82, clutch: 81, mentality: 80, intlExperience: 78 },
  },
  {
    ign: "Tabzz",
    real: "Erik van Helvert",
    role: "adc",
    country: "NL",
    age: 30,
    attrs: { mechanics: 76, gameIq: 80, clutch: 78, mentality: 79, intlExperience: 70 },
  },
  {
    ign: "Hybrid",
    real: "Glenn Doornenbal",
    role: "support",
    country: "NL",
    age: 28,
    attrs: { mechanics: 76, gameIq: 80, clutch: 77, mentality: 79, intlExperience: 64 },
  },
];

// ---------------------------------------------------------------------------
// IA Autônoma do Mercado de Transferências
// ---------------------------------------------------------------------------

export interface ExternalLeagueUpdate {
  championshipId: string;
  teamId: string;
  isSerieB: boolean;
  updatedTeam: Team;
  newsItem?: TransferNews;
}

interface MutableExternalLeague {
  champ: Championship;
  region: string;
  teams: Team[];
  serieBTeams: Team[];
}

export interface AutonomousMarketResult {
  updatedTeams: Team[];
  updatedSerieBTeams?: Team[];
  news: TransferNews[];
  remainingFreeAgents: Player[];
  externalUpdates: ExternalLeagueUpdate[];
}

function isBlockedInternational(c: Championship): boolean {
  if (c.internationalLevel === "major" || c.internationalLevel === "minor") return true;
  if (c.isInternational === true) return true;
  if (
    /copa do mundo|world cup|seleções|selecoes|world|mundial|\bmsi\b|first\s*stand|kickoff|rift\s*rivals|global\s*master|supercopa|desafiante/i.test(
      c.name ?? "",
    )
  ) {
    return true;
  }
  const regs = new Set(
    c.teams.map((t) => normalizeRegion(t.region ?? "")).filter((r) => !!r && r !== "OUTROS"),
  );
  return regs.size > 1;
}

function collectUsedIgns(teams: Team[]): Set<string> {
  const used = new Set<string>();
  for (const t of teams) {
    for (const p of ensureRoster(t) ?? []) {
      used.add(p.ign.trim().toLowerCase());
    }
  }
  return used;
}

/**
 * Avalia a VONTADE DO JOGADOR antes de fechar a contratação:
 * o atleta analisa se o time oferece o melhor ambiente para ser campeão e evoluir.
 */
function doesPlayerAcceptMove(params: {
  player: Player;
  targetTeam: Team;
  targetStarters: Player[];
  replacedStarter: Player;
  fromTeam?: Team;
  fromStarters?: Player[];
  isImport: boolean;
  isSerieB: boolean;
  career?: CareerLedger;
  game: GameId;
}): boolean {
  const {
    player,
    targetTeam,
    targetStarters,
    replacedStarter,
    fromTeam,
    fromStarters,
    isImport,
    isSerieB,
    career,
    game,
  } = params;

  const pOvr = playerOverall(player);
  const age = player.age ?? 22;
  const culture = targetTeam.culture ?? 50;
  const synergy = targetTeam.synergy ?? 10;

  // Força média do novo elenco JÁ contando a entrada do jogador no lugar do titular substituído
  const projectedStarters = targetStarters
    .filter((s) => s.id !== replacedStarter.id)
    .concat(player);
  const projectedAvgOvr =
    projectedStarters.reduce((acc, s) => acc + playerOverall(s), 0) /
    Math.max(1, projectedStarters.length);

  const careerEntry = career?.[game]?.[targetTeam.name.trim().toLowerCase()];
  const teamPrestige = careerEntry?.rating ?? 50;
  const hasTitles = (careerEntry?.titles ?? 0) > 0;

  // 1. Vontade de ser CAMPEÃO (especialmente estrelas e veteranos 24+)
  if (pOvr >= 82 || age >= 25) {
    // Superestrela não vai pra Série B, a menos que esteja em queda livre (< 76)
    if (isSerieB && pOvr >= 76) return false;
    // Vestiário em crise (cultura < 38) afasta estrelas que querem taça
    if (pOvr >= 82 && culture < 38 && !hasTitles) return false;
    // Jogador de elite exige elenco competitivo ao redor para poder brigar por título
    const minTeamLevel = pOvr >= 86 ? pOvr - 11 : pOvr - 13;
    if (projectedAvgOvr < minTeamLevel && teamPrestige < 58 && !hasTitles) return false;
  }

  // 2. Vontade de EVOLUIR (jovens <= 22 anos)
  if (age <= 22) {
    // Jovem precisa de ambiente minimamente saudável e companheiros que agreguem experiência
    if (culture < 30) return false;
    const avgTeammateIq =
      projectedStarters.reduce(
        (acc, s) => acc + getResolvedAttrs(s.attrs, s.ign, s.role, s.country, s.age).gameIq,
        0,
      ) / Math.max(1, projectedStarters.length);
    // Se o time é muito fraco de macro e tem cultura ruim, o jovem prefere esperar proposta melhor
    if (avgTeammateIq < 64 && culture < 45 && isSerieB) return false;
  }

  // 3. Jogador que já está em outro time da liga (troca/compra):
  // Se era titular lá, só aceita sair se o novo time for projeto igual/melhor (ou cultura muito superior)
  if (fromTeam && !player.sub && fromStarters && fromStarters.length > 0) {
    const fromAvgOvr =
      fromStarters.reduce((acc, s) => acc + playerOverall(s), 0) / fromStarters.length;
    const fromPrestige = career?.[game]?.[fromTeam.name.trim().toLowerCase()]?.rating ?? 50;
    const betterProject =
      projectedAvgOvr >= fromAvgOvr - 1.5 ||
      teamPrestige >= fromPrestige + 4 ||
      culture >= (fromTeam.culture ?? 50) + 10 ||
      synergy >= (fromTeam.synergy ?? 10) + 12;
    if (!betterProject) return false;
  }

  // 4. Gringo de alto nível (import) só atravessa o oceano por projeto sólido e chance real de título
  if (isImport && pOvr >= 80) {
    if (isSerieB) return false;
    if (projectedAvgOvr < 73 && teamPrestige < 54 && culture < 52) return false;
  }

  return true;
}

function buildExternalLeagues(
  championship: Championship,
  allChampionships: Championship[],
  game: GameId,
): MutableExternalLeague[] {
  return allChampionships
    .filter(
      (c) =>
        c.id !== championship.id &&
        (c.game ?? "lol") === game &&
        !isBlockedInternational(c) &&
        c.teams.length > 0,
    )
    .map((c) => ({
      champ: c,
      region: c.region || "CBLOL",
      teams: c.teams.map((t) => ({ ...t, roster: ensureRoster(t) })),
      serieBTeams: (c.serieB?.teams ?? []).map((t) => ({ ...t, roster: ensureRoster(t) })),
    }));
}

/**
 * Repõe automaticamente o elenco de um time de outra liga que perdeu um jogador
 * (mesmo se a liga ainda não tiver sido simulada).
 * Ordem: 1) promove reserva da mesma rota; 2) contrata melhor agente livre compatível;
 * 3) sobe um rookie da base (Academy) para nunca deixar o time sem 5 titulares.
 */
function replenishSellerTeam(params: {
  seller: Team;
  soldPlayer: Player;
  sellerRegion: string;
  isSerieB: boolean;
  pool: Player[];
  usedIgns: Set<string>;
  career?: CareerLedger;
  game: GameId;
}): { updatedSeller: Team; replacementNews?: TransferNews } {
  const { seller, soldPlayer, sellerRegion, isSerieB, pool, usedIgns, career, game } = params;
  const remainingRoster = (ensureRoster(seller) ?? []).filter((p) => p.id !== soldPlayer.id);
  const currentStarters = pickStarters(remainingRoster);
  const needsStarterForRole = !currentStarters.some((p) => p.role === soldPlayer.role);

  if (!needsStarterForRole && currentStarters.length >= 5) {
    return {
      updatedSeller: {
        ...seller,
        roster: remainingRoster,
        synergy: Math.max(0, (seller.synergy ?? 10) - 6),
      },
    };
  }

  // 1. Tenta promover um reserva da mesma rota já no elenco
  const roleSub = remainingRoster.find((p) => p.sub && p.role === soldPlayer.role);
  if (roleSub) {
    const promoted = remainingRoster.map((p) =>
      p.id === roleSub.id ? { ...p, sub: false } : p,
    );
    return {
      updatedSeller: {
        ...seller,
        roster: promoted,
        synergy: Math.max(0, (seller.synergy ?? 10) - 5),
      },
      replacementNews: {
        id: uid(),
        headline: `REPOSIÇÃO: ${seller.name} promove o reserva ${roleSub.ign} (${soldPlayer.role.toUpperCase()}) após saída de ${soldPlayer.ign}.`,
        fromTeam: "Reserva",
        toTeam: seller.name,
        playerIgn: roleSub.ign,
        role: roleSub.role,
        kind: "signing",
        date: new Date().toISOString(),
      },
    };
  }

  // 2. Busca o melhor Agente Livre disponível para a rota dentro do orçamento e limite de imports
  const sellerBudget = getTeamBaseBudget(seller, sellerRegion, false, isSerieB, career, game);
  const currentImports = currentStarters.filter((p) => isPlayerImport(p, sellerRegion)).length;
  let bestIdx = -1;
  let bestOvr = -1;
  for (let i = 0; i < pool.length; i++) {
    const fa = pool[i];
    if (fa.role !== soldPlayer.role) continue;
    if (usedIgns.has(fa.ign.trim().toLowerCase())) continue;
    if (isPlayerImport(fa, sellerRegion) && currentImports >= 2) continue;
    const salary = getPlayerSalary(fa, sellerRegion, career, game);
    if (salary > sellerBudget * 0.55) continue;
    const ovr = playerOverall(fa);
    if (ovr > bestOvr) {
      bestOvr = ovr;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    const signed = pool.splice(bestIdx, 1)[0];
    usedIgns.add(signed.ign.trim().toLowerCase());
    const newPlayer: Player = {
      ...signed,
      id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sub: false,
    };
    return {
      updatedSeller: {
        ...seller,
        roster: [...remainingRoster, newPlayer],
        synergy: Math.max(0, (seller.synergy ?? 10) - 8),
      },
      replacementNews: {
        id: uid(),
        headline: `REPOSIÇÃO NO MERCADO: ${seller.name} contrata ${signed.ign} (${signed.role.toUpperCase()}) para repor a saída de ${soldPlayer.ign}.`,
        fromTeam: "Agente Livre",
        toTeam: seller.name,
        playerIgn: signed.ign,
        role: signed.role,
        kind: "signing",
        value: getPlayerSalary(signed, sellerRegion, career, game),
        date: new Date().toISOString(),
      },
    };
  }

  // 3. Garantia absoluta: sobe um rookie da base da própria região
  const rookie = generateAcademyRookie(soldPlayer.role, sellerRegion, seller.name);
  usedIgns.add(rookie.ign.trim().toLowerCase());
  return {
    updatedSeller: {
      ...seller,
      roster: [...remainingRoster, { ...rookie, sub: false }],
      synergy: Math.max(0, (seller.synergy ?? 10) - 7),
    },
    replacementNews: {
      id: uid(),
      headline: `BASE PROMOVIDA: ${seller.name} sobe o jovem ${rookie.ign} (${rookie.role.toUpperCase()}) da Academy após saída de ${soldPlayer.ign}.`,
      fromTeam: "Academy",
      toTeam: seller.name,
      playerIgn: rookie.ign,
      role: rookie.role,
      kind: "signing",
      date: new Date().toISOString(),
    },
  };
}

export function applyExternalUpdatesToChampionships(
  championships: Championship[],
  updates: ExternalLeagueUpdate[],
): Championship[] {
  if (updates.length === 0) return championships;
  const byChamp = new Map<string, ExternalLeagueUpdate[]>();
  for (const u of updates) {
    const arr = byChamp.get(u.championshipId) ?? [];
    arr.push(u);
    byChamp.set(u.championshipId, arr);
  }
  return championships.map((c) => {
    const list = byChamp.get(c.id);
    if (!list || list.length === 0) return c;
    let nextTeams = c.teams;
    let nextSerieBTeams = c.serieB?.teams;
    const extraNews: TransferNews[] = [];
    for (const u of list) {
      if (u.isSerieB && nextSerieBTeams) {
        nextSerieBTeams = nextSerieBTeams.map((t) => (t.id === u.teamId ? u.updatedTeam : t));
      } else {
        nextTeams = nextTeams.map((t) => (t.id === u.teamId ? u.updatedTeam : t));
      }
      if (u.newsItem) extraNews.push(u.newsItem);
    }
    return {
      ...c,
      teams: nextTeams,
      serieB: c.serieB ? { ...c.serieB, teams: nextSerieBTeams ?? c.serieB.teams } : undefined,
      transferHistory:
        extraNews.length > 0
          ? [...extraNews, ...(c.transferHistory ?? [])].slice(0, 40)
          : c.transferHistory,
    };
  });
}

function moveSingleTeam(params: {
  team: Team;
  allLeagueTeams: Team[];
  pool: Player[];
  region: string;
  career?: CareerLedger;
  game: GameId;
  isSerieB: boolean;
  externalLeagues?: MutableExternalLeague[];
  usedIgns?: Set<string>;
  lockedIgns?: Set<string>;
  isMidSplit?: boolean;
}): {
  updatedTeam: Team;
  updatedAllTeams: Team[];
  newsItem?: TransferNews;
  externalUpdates: ExternalLeagueUpdate[];
} {
  const {
    team,
    allLeagueTeams,
    pool,
    region,
    career,
    game,
    isSerieB,
    externalLeagues = [],
    usedIgns = collectUsedIgns(allLeagueTeams),
    lockedIgns,
    isMidSplit = false,
  } = params;
  const roster = ensureRoster(team) ?? [];
  const starters = pickStarters(roster);
  if (starters.length === 0) {
    return { updatedTeam: team, updatedAllTeams: allLeagueTeams, externalUpdates: [] };
  }

  const budget = getTeamBaseBudget(team, region, false, isSerieB, career, game);
  const currentImports = starters.filter((p) => isPlayerImport(p, region)).length;
  const ownIgns = new Set(roster.map((p) => p.ign.trim().toLowerCase()));
  const leagueIgns = new Set(
    allLeagueTeams.flatMap((t) => (ensureRoster(t) ?? []).map((p) => p.ign.trim().toLowerCase())),
  );

  // Avalia todo o elenco titular pelo Overall real (não só mecânica) para buscar
  // o maior salto de qualidade possível rumo ao título.
  const starterByRole = new Map<PlayerRole, { player: Player; ovr: number; mech: number }>();
  for (const s of starters) {
    const ovr = playerOverall(s);
    const mech = getResolvedAttrs(s.attrs, s.ign, s.role, s.country, s.age).mechanics;
    starterByRole.set(s.role, { player: s, ovr, mech });
  }

  const rankedStarters = [...starters].sort((a, b) => playerOverall(a) - playerOverall(b));
  const weakest = rankedStarters[0];

  // Pontuação de ambição: prioriza quem eleva mais o nível do time e tem perfil vencedor (clutch/ovr alto)
  const scoreUpgrade = (cand: Player, targetStarter: Player, isImport: boolean): number => {
    const candOvr = playerOverall(cand);
    const curOvr = playerOverall(targetStarter);
    const gain = candOvr - curOvr;
    const attrs = getResolvedAttrs(cand.attrs, cand.ign, cand.role, cand.country, cand.age);
    const titleProfile = attrs.clutch * 0.12 + attrs.intlExperience * 0.08 + attrs.mentality * 0.08;
    // Leve preferência por nacional apenas em caso de empate técnico (+1.5); se o gringo for melhor, ganha!
    const domesticTiebreak = isImport ? 0 : 1.5;
    return gain * 2.2 + candOvr * 0.45 + titleProfile + domesticTiebreak;
  };

  // 1. Tenta contratar/puxar o MELHOR jogador disponível de outro time da mesma liga local
  let nextLeagueTeams = allLeagueTeams;
  if (Math.random() < 0.45 && allLeagueTeams.length >= 2) {
    let bestIntra: {
      other: Team;
      otherRoster: Player[];
      candidate: Player;
      targetStarter: Player;
      score: number;
    } | null = null;

    for (const other of allLeagueTeams) {
      if (other.id === team.id) continue;
      const otherRoster = ensureRoster(other) ?? [];
      const otherBudget = getTeamBaseBudget(other, region, false, isSerieB, career, game);

      for (const p of otherRoster) {
        const pKey = p.ign.trim().toLowerCase();
        if (ownIgns.has(pKey) || lockedIgns?.has(pKey)) continue;
        const target = starterByRole.get(p.role);
        if (!target) continue;
        const candOvr = playerOverall(p);

        const splits = getPlayerContractSplits(p);
        const buyout = getPlayerBuyout(p, region, career, game);
        if (isMidSplit && buyout > 0 && !p.sub) continue;
        if (splits >= 2 && !p.sub && Math.random() < 0.65) continue;
        if (candOvr <= target.ovr + (buyout > 0 ? 4 : 2)) continue;

        const isImp = isPlayerImport(p, region);
        if (isImp && currentImports >= 2 && !isPlayerImport(target.player, region)) continue;

        const salary = getPlayerSalary(p, region, career, game);
        const maxShare = candOvr >= 82 ? 0.55 : 0.46;
        if (salary > budget * maxShare) continue;
        if (buyout > 0 && salary + buyout > budget * 0.85) continue;

        // Puxa se for reserva/fim de contrato ou se o comprador tiver orçamento para cobrir multa + salto
        if (!p.sub && buyout > 0 && budget <= otherBudget + Math.max(120, Math.round(buyout * 0.45))) continue;

        // Vontade do jogador: analisa se o novo time é melhor para ser campeão e evoluir
        if (
          !doesPlayerAcceptMove({
            player: p,
            targetTeam: team,
            targetStarters: starters,
            replacedStarter: target.player,
            fromTeam: other,
            fromStarters: pickStarters(otherRoster),
            isImport: isImp,
            isSerieB,
            career,
            game,
          })
        ) {
          continue;
        }

        const sc = scoreUpgrade(p, target.player, isImp);
        if (!bestIntra || sc > bestIntra.score) {
          bestIntra = { other, otherRoster, candidate: p, targetStarter: target.player, score: sc };
        }
      }
    }

    if (bestIntra) {
      const { other, otherRoster, candidate, targetStarter } = bestIntra;
      const buyout = getPlayerBuyout(candidate, region, career, game);
      const salary = getPlayerSalary(candidate, region, career, game);
      const candOvr = playerOverall(candidate);
      lockedIgns?.add(candidate.ign.trim().toLowerCase());
      const bought: Player = {
        ...candidate,
        id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        sub: false,
        contractSplits: candOvr >= 82 ? 3 : 2,
      };
      const buyerRoster = roster.map((p) => (p.id === targetStarter.id ? bought : p));
      const sellerNeedsSub = !candidate.sub;
      const swappedForSeller: Player = { ...targetStarter, sub: false };
      const updatedSellerRoster = sellerNeedsSub
        ? otherRoster.map((p) => (p.id === candidate.id ? swappedForSeller : p))
        : otherRoster.filter((p) => p.id !== candidate.id);

      if (!sellerNeedsSub) {
        buyerRoster.push({ ...targetStarter, sub: true });
      }

      const updatedBuyer: Team = {
        ...team,
        roster: buyerRoster,
        synergy: Math.max(0, (team.synergy ?? 10) - 10),
      };
      nextLeagueTeams = allLeagueTeams.map((t) => {
        if (t.id === team.id) return updatedBuyer;
        if (t.id === other.id) {
          return {
            ...other,
            roster: updatedSellerRoster,
            synergy: Math.max(0, (other.synergy ?? 10) - 8),
          };
        }
        return t;
      });

      return {
        updatedTeam: updatedBuyer,
        updatedAllTeams: nextLeagueTeams,
        externalUpdates: [],
        newsItem: {
          id: uid(),
          headline: sellerNeedsSub
            ? `TROCA NA LIGA: ${team.name} acerta com ${candidate.ign} (ex-${other.name})${buyout > 0 ? ` por $${buyout}k de multa` : ""} e envia ${targetStarter.ign} em troca!`
            : `TRANSFERÊNCIA: ${team.name} contrata ${candidate.ign} junto à ${other.name}${buyout > 0 ? ` pagando multa de $${buyout}k` : " (fim de contrato)"}!`,
          fromTeam: other.name,
          toTeam: team.name,
          playerIgn: candidate.ign,
          role: candidate.role,
          kind: "trade",
          value: salary + buyout,
          date: new Date().toISOString(),
        },
      };
    }
  }

  // 1.5. Mercado Global (outras ligas locais do mesmo jogo, simuladas ou ainda não simuladas!)
  if (externalLeagues.length > 0 && Math.random() < 0.55) {
    let bestGlobal: {
      extLeague: MutableExternalLeague;
      isSellerSerieB: boolean;
      seller: Team;
      candidate: Player;
      targetStarter: Player;
      isImp: boolean;
      score: number;
    } | null = null;

    for (const ext of externalLeagues) {
      const poolsToScan: Array<{ teams: Team[]; isSerieB: boolean }> = [
        { teams: ext.teams, isSerieB: false },
        ...(ext.serieBTeams.length > 0 ? [{ teams: ext.serieBTeams, isSerieB: true }] : []),
      ];
      for (const grp of poolsToScan) {
        for (const seller of grp.teams) {
          const sellerRoster = ensureRoster(seller) ?? [];
          const sellerBudget = getTeamBaseBudget(seller, ext.region, false, grp.isSerieB, career, game);
          for (const p of sellerRoster) {
            const pKey = p.ign.trim().toLowerCase();
            if (ownIgns.has(pKey) || leagueIgns.has(pKey) || lockedIgns?.has(pKey)) continue;
            const target = starterByRole.get(p.role);
            if (!target) continue;

            const candOvr = playerOverall(p);
            const splits = getPlayerContractSplits(p);
            const buyout = getPlayerBuyout(p, ext.region, career, game);
            if (isMidSplit && buyout > 0 && !p.sub) continue;
            if (splits >= 2 && !p.sub && Math.random() < 0.68) continue;
            if (candOvr <= target.ovr + (buyout > 0 ? 4 : 2)) continue;

            const isImp = isPlayerImport(p, region);
            if (isImp && currentImports >= 2 && !isPlayerImport(target.player, region)) continue;

            const salary = getPlayerSalary(p, region, career, game);
            const maxShare = candOvr >= 82 ? 0.56 : 0.47;
            if (salary > budget * maxShare) continue;
            if (buyout > 0 && salary + buyout > budget * 0.85) continue;

            // Só tira titular sob contrato de outra liga se tiver dinheiro pra multa + salto salarial
            if (!p.sub && buyout > 0 && budget <= sellerBudget + Math.max(100, Math.round(buyout * 0.45))) continue;

            if (
              !doesPlayerAcceptMove({
                player: p,
                targetTeam: team,
                targetStarters: starters,
                replacedStarter: target.player,
                fromTeam: seller,
                fromStarters: pickStarters(sellerRoster),
                isImport: isImp,
                isSerieB,
                career,
                game,
              })
            ) {
              continue;
            }

            const sc = scoreUpgrade(p, target.player, isImp);
            if (!bestGlobal || sc > bestGlobal.score) {
              bestGlobal = {
                extLeague: ext,
                isSellerSerieB: grp.isSerieB,
                seller,
                candidate: p,
                targetStarter: target.player,
                isImp,
                score: sc,
              };
            }
          }
        }
      }
    }

    if (bestGlobal) {
      const { extLeague, isSellerSerieB, seller, candidate, targetStarter, isImp } = bestGlobal;
      const buyout = getPlayerBuyout(candidate, extLeague.region, career, game);
      const salary = getPlayerSalary(candidate, region, career, game);
      const candOvr = playerOverall(candidate);
      lockedIgns?.add(candidate.ign.trim().toLowerCase());
      const bought: Player = {
        ...candidate,
        id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        sub: false,
        contractSplits: candOvr >= 82 ? 3 : 2,
      };
      const replacedMech = getResolvedAttrs(
        targetStarter.attrs,
        targetStarter.ign,
        targetStarter.role,
        targetStarter.country,
        targetStarter.age,
      ).mechanics;
      const releaseOld = (targetStarter.age ?? 22) >= 26 || replacedMech < 70;
      const buyerRoster = releaseOld
        ? roster.filter((p) => p.id !== targetStarter.id).concat(bought)
        : roster.map((p) => (p.id === targetStarter.id ? bought : p)).concat({ ...targetStarter, sub: true });
      if (releaseOld) {
        pool.push({ ...targetStarter, sub: false });
        usedIgns.delete(targetStarter.ign.trim().toLowerCase());
      }

      const updatedBuyer: Team = {
        ...team,
        roster: buyerRoster,
        synergy: Math.max(0, (team.synergy ?? 10) - 11),
      };
      nextLeagueTeams = allLeagueTeams.map((t) => (t.id === team.id ? updatedBuyer : t));

      const { updatedSeller, replacementNews } = replenishSellerTeam({
        seller,
        soldPlayer: candidate,
        sellerRegion: extLeague.region,
        isSerieB: isSellerSerieB,
        pool,
        usedIgns,
        career,
        game,
      });

      if (isSellerSerieB) {
        extLeague.serieBTeams = extLeague.serieBTeams.map((t) =>
          t.id === seller.id ? updatedSeller : t,
        );
      } else {
        extLeague.teams = extLeague.teams.map((t) => (t.id === seller.id ? updatedSeller : t));
      }

      const sellerExitNews: TransferNews = {
        id: uid(),
        headline: `TRANSFERÊNCIA GLOBAL: ${candidate.ign} (${extLeague.champ.name}) assina com ${team.name} (${region})${buyout > 0 ? ` — multa de $${buyout}k paga` : " (fim de contrato)"}!`,
        fromTeam: seller.name,
        toTeam: team.name,
        playerIgn: candidate.ign,
        role: candidate.role,
        kind: "trade",
        value: salary + buyout,
        date: new Date().toISOString(),
      };

      const externalUpdates: ExternalLeagueUpdate[] = [
        {
          championshipId: extLeague.champ.id,
          teamId: seller.id,
          isSerieB: isSellerSerieB,
          updatedTeam: updatedSeller,
          newsItem: replacementNews ?? sellerExitNews,
        },
      ];

      return {
        updatedTeam: updatedBuyer,
        updatedAllTeams: nextLeagueTeams,
        externalUpdates,
        newsItem: {
          id: uid(),
          headline: isImp
            ? `MERCADO GLOBAL (IMPORT): ${team.name} busca ${candidate.ign} [${candidate.country}] na ${extLeague.champ.name} (${seller.name})!`
            : `MERCADO GLOBAL: ${team.name} contrata ${candidate.ign} junto à ${seller.name} (${extLeague.champ.name})!`,
          fromTeam: `${seller.name} (${extLeague.region})`,
          toTeam: team.name,
          playerIgn: candidate.ign,
          role: candidate.role,
          kind: "trade",
          value: getPlayerSalary(candidate, region, career, game),
          date: new Date().toISOString(),
        },
      };
    }
  }

  // 2. Procura no pool de Agentes Livres pelo MELHOR reforço disponível (nacional ou gringo)
  // visando título: analisa todas as rotas e escolhe o maior ganho real dentro do orçamento.
  let bestPoolPick: {
    index: number;
    candidate: Player;
    targetStarter: Player;
    score: number;
  } | null = null;

  for (let i = 0; i < pool.length; i++) {
    const fa = pool[i];
    if (leagueIgns.has(fa.ign.trim().toLowerCase())) continue;
    const target = starterByRole.get(fa.role);
    if (!target) continue;

    const candOvr = playerOverall(fa);
    const minJump = candOvr >= 82 ? 1.5 : 2;
    if (candOvr <= target.ovr + minJump) continue;

    const isImp = isPlayerImport(fa, region);
    if (isImp && currentImports >= 2 && !isPlayerImport(target.player, region)) continue;

    const salary = getPlayerSalary(fa, region, career, game);
    // Para estrelas (OVR 82+) que mudam o patamar do time, aceita investir até 54% do orçamento
    const maxShare = candOvr >= 82 ? 0.54 : 0.45;
    if (salary > budget * maxShare) continue;

    // Vontade do jogador: o atleta avalia o projeto esportivo, cultura e chance de título/evolução
    if (
      !doesPlayerAcceptMove({
        player: fa,
        targetTeam: team,
        targetStarters: starters,
        replacedStarter: target.player,
        isImport: isImp,
        isSerieB,
        career,
        game,
      })
    ) {
      continue;
    }

    const sc = scoreUpgrade(fa, target.player, isImp);
    if (!bestPoolPick || sc > bestPoolPick.score) {
      bestPoolPick = { index: i, candidate: fa, targetStarter: target.player, score: sc };
    }
  }

  if (bestPoolPick) {
    const signed = pool.splice(bestPoolPick.index, 1)[0];
    const candOvr = playerOverall(signed);
    lockedIgns?.add(signed.ign.trim().toLowerCase());
    const replacedStarter = bestPoolPick.targetStarter;
    const replacedMech = getResolvedAttrs(
      replacedStarter.attrs,
      replacedStarter.ign,
      replacedStarter.role,
      replacedStarter.country,
      replacedStarter.age,
    ).mechanics;

    const newPlayer: Player = {
      ...signed,
      id: `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sub: false,
      contractSplits: candOvr >= 82 ? 3 : 2,
    };

    const releasedOld = (replacedStarter.age ?? 22) >= 26 || replacedMech < 70;
    let updatedRoster: Player[];
    let newsItem: TransferNews;

    if (releasedOld) {
      pool.push({ ...replacedStarter, sub: false });
      updatedRoster = roster.filter((p) => p.id !== replacedStarter.id).concat(newPlayer);
      const isImp = isPlayerImport(signed, region);
      newsItem = {
        id: uid(),
        headline: isImp
          ? `REFORÇO DE PESO (IMPORT): ${team.name} dispensa ${replacedStarter.ign} e contrata o gringo ${signed.ign} [${signed.country}] para buscar o título!`
          : `${team.name} dispensa ${replacedStarter.ign} para o mercado livre e contrata ${signed.ign}!`,
        fromTeam: "Agente Livre",
        toTeam: team.name,
        playerIgn: signed.ign,
        role: signed.role,
        kind: "signing",
        value: getPlayerSalary(signed, region, career, game),
        date: new Date().toISOString(),
      };
    } else {
      updatedRoster = roster
        .map((p) => (p.id === replacedStarter.id ? newPlayer : p))
        .concat({ ...replacedStarter, sub: true });
      const isImp = isPlayerImport(signed, region);
      newsItem = {
        id: uid(),
        headline: isImp
          ? `REFORÇO IMPORT: ${team.name} contrata ${signed.ign} [${signed.country}] e assume a rota ${signed.role.toUpperCase()}!`
          : `CONTRATAÇÃO: ${team.name} fecha com ${signed.ign} (Agente Livre) para assumir a titularidade!`,
        fromTeam: "Agente Livre",
        toTeam: team.name,
        playerIgn: signed.ign,
        role: signed.role,
        kind: "signing",
        value: getPlayerSalary(signed, region, career, game),
        date: new Date().toISOString(),
      };
    }

    const updatedTeam: Team = {
      ...team,
      roster: updatedRoster,
      synergy: Math.max(0, (team.synergy ?? 10) - 12),
    };
    nextLeagueTeams = allLeagueTeams.map((t) => (t.id === team.id ? updatedTeam : t));
    return { updatedTeam, updatedAllTeams: nextLeagueTeams, newsItem, externalUpdates: [] };
  }

  // 3. Se não contratou ninguém e tem reserva/veterano caro em baixa, pode dispensar para abrir caixa
  const subs = roster.filter((p) => p.sub);
  if (subs.length >= 2) {
    const releasedSub = subs[subs.length - 1];
    pool.push({ ...releasedSub, sub: false });
    const updatedTeam: Team = {
      ...team,
      roster: roster.filter((p) => p.id !== releasedSub.id),
    };
    nextLeagueTeams = allLeagueTeams.map((t) => (t.id === team.id ? updatedTeam : t));
    return {
      updatedTeam,
      updatedAllTeams: nextLeagueTeams,
      externalUpdates: [],
      newsItem: {
        id: uid(),
        headline: `${team.name} libera ${releasedSub.ign} (${releasedSub.role.toUpperCase()}) para o Mercado Livre.`,
        fromTeam: team.name,
        toTeam: "Mercado Livre",
        playerIgn: releasedSub.ign,
        role: releasedSub.role,
        kind: "release",
        date: new Date().toISOString(),
      },
    };
  }

  return { updatedTeam: team, updatedAllTeams: allLeagueTeams, externalUpdates: [] };
}

/**
 * Executa uma rodada completa de transferências de forma autônoma na entressafra.
 * NUNCA altera elencos de torneios internacionais.
 */
export function runAutonomousMarket(params: {
  championship: Championship;
  allChampionships?: Championship[];
  career?: CareerLedger;
  freeAgentsPool?: Player[];
  intensity?: "normal" | "aggressive";
  lockedIgns?: Set<string>;
}): AutonomousMarketResult {
  const {
    championship,
    allChampionships = [],
    career,
    intensity = "normal",
    lockedIgns = new Set<string>(),
  } = params;

  if (isBlockedInternational(championship)) {
    return {
      updatedTeams: championship.teams,
      updatedSerieBTeams: championship.serieB?.teams,
      news: [],
      remainingFreeAgents: params.freeAgentsPool ?? [],
      externalUpdates: [],
    };
  }

  const region = championship.region || "CBLOL";
  const game = (championship.game ?? "lol") as GameId;
  const news: TransferNews[] = [];
  const externalUpdates: ExternalLeagueUpdate[] = [];
  const externalLeagues = buildExternalLeagues(championship, allChampionships, game);

  const allGlobalTeams: Team[] = [
    ...championship.teams,
    ...(championship.serieB?.teams ?? []),
    ...allChampionships.flatMap((c) => [...c.teams, ...(c.serieB?.teams ?? [])]),
  ];
  const usedIgns = collectUsedIgns(allGlobalTeams);

  let pool: Player[] = (
    params.freeAgentsPool
      ? [...params.freeAgentsPool]
      : GLOBAL_FREE_AGENT_POOL.map((fa, i) => ({ ...fa, id: `fa_${i + 1}_${Date.now()}` }))
  )
    .filter((p) => !usedIgns.has(p.ign.trim().toLowerCase()))
    .sort(() => Math.random() - 0.5);

  const processTeamList = (teams: Team[], isSerieB = false): Team[] => {
    let current = [...teams];
    const moveChance = isSerieB ? 0.25 : intensity === "aggressive" ? 0.42 : 0.30;
    const maxMoves = Math.max(2, Math.ceil(teams.length * 0.35));
    let movesCount = 0;
    for (const original of teams) {
      if (movesCount >= maxMoves) break;
      if (Math.random() > moveChance) continue;
      const liveTeam = current.find((t) => t.id === original.id);
      if (!liveTeam) continue;
      const res = moveSingleTeam({
        team: liveTeam,
        allLeagueTeams: current,
        pool,
        region,
        career,
        game,
        isSerieB,
        externalLeagues,
        usedIgns,
        lockedIgns,
      });
      current = res.updatedAllTeams;
      if (res.newsItem) {
        news.push(res.newsItem);
        movesCount++;
      }
      if (res.externalUpdates.length > 0) externalUpdates.push(...res.externalUpdates);
    }
    return current;
  };

  const updatedTeamsA = processTeamList(championship.teams, false);
  const updatedTeamsB = championship.serieB
    ? processTeamList(championship.serieB.teams, true)
    : undefined;

  return {
    updatedTeams: updatedTeamsA,
    updatedSerieBTeams: updatedTeamsB,
    news,
    remainingFreeAgents: pool,
    externalUpdates,
  };
}

/**
 * Janela viva DURANTE o split em ligas locais:
 * Sem precisar clicar ou aprovar nada, após partidas da liga local os times avaliam
 * seu desempenho e fazem movimentações autônomas (dentro ou fora da liga, inclusive
 * em ligas ainda não simuladas, com reposição automática inteligente).
 * Bloqueado em campeonatos internacionais.
 */
export function runMidSplitMarketTick(params: {
  championship: Championship;
  allChampionships?: Championship[];
  career?: CareerLedger;
  loserTeamId?: string;
  division?: 1 | 2;
}): {
  teams: Team[];
  serieBTeams?: Team[];
  news: TransferNews[];
  externalUpdates: ExternalLeagueUpdate[];
} {
  const { championship, allChampionships = [], career, loserTeamId, division = 1 } = params;
  if (isBlockedInternational(championship)) {
    return {
      teams: championship.teams,
      serieBTeams: championship.serieB?.teams,
      news: [],
      externalUpdates: [],
    };
  }

  const region = championship.region || "CBLOL";
  const game = (championship.game ?? "lol") as GameId;
  const list = division === 2 ? (championship.serieB?.teams ?? []) : championship.teams;
  if (list.length < 2) {
    return {
      teams: championship.teams,
      serieBTeams: championship.serieB?.teams,
      news: [],
      externalUpdates: [],
    };
  }

  // Ritmo orgânico ao longo do split: apenas ajustes pontuais em crise real
  const loserState = loserTeamId ? championship.momentum?.[loserTeamId] : undefined;
  const inCrisis = (loserState?.form ?? 50) < 44 || (loserState?.streak ?? 0) <= -3;
  const triggerChance = inCrisis ? 0.14 : 0.04;
  if (Math.random() > triggerChance) {
    return {
      teams: championship.teams,
      serieBTeams: championship.serieB?.teams,
      news: [],
      externalUpdates: [],
    };
  }

  const externalLeagues = buildExternalLeagues(championship, allChampionships, game);
  const allGlobalTeams: Team[] = [
    ...championship.teams,
    ...(championship.serieB?.teams ?? []),
    ...allChampionships.flatMap((c) => [...c.teams, ...(c.serieB?.teams ?? [])]),
  ];
  const usedIgns = collectUsedIgns(allGlobalTeams);
  const pool: Player[] = GLOBAL_FREE_AGENT_POOL
    .map((fa, i) => ({ ...fa, id: `fa_${i + 1}_${Date.now()}` }))
    .filter((p) => !usedIgns.has(p.ign.trim().toLowerCase()))
    .sort(() => Math.random() - 0.5);

  // Escolhe preferencialmente o perdedor em crise ou um time aleatório da divisão
  const target =
    (inCrisis && loserTeamId ? list.find((t) => t.id === loserTeamId) : undefined) ??
    list[Math.floor(Math.random() * list.length)];
  if (!target) {
    return {
      teams: championship.teams,
      serieBTeams: championship.serieB?.teams,
      news: [],
      externalUpdates: [],
    };
  }

  const res = moveSingleTeam({
    team: target,
    allLeagueTeams: list,
    pool,
    region,
    career,
    game,
    isSerieB: division === 2,
    externalLeagues,
    usedIgns,
    isMidSplit: true,
  });

  if (!res.newsItem) {
    return {
      teams: championship.teams,
      serieBTeams: championship.serieB?.teams,
      news: [],
      externalUpdates: [],
    };
  }

  return {
    teams: division === 1 ? res.updatedAllTeams : championship.teams,
    serieBTeams: division === 2 ? res.updatedAllTeams : championship.serieB?.teams,
    news: [res.newsItem],
    externalUpdates: res.externalUpdates,
  };
}

/**
 * Executa uma Janela de Transferências GLOBAL e INDEPENDENTE para todas as ligas locais
 * de um jogo (simuladas ou não), sem precisar simular nenhuma partida.
 */
export function runGlobalTransferWindow(params: {
  championships: Championship[];
  game: GameId;
  career?: CareerLedger;
}): { updatedChampionships: Championship[]; totalMoves: number } {
  const { game, career } = params;
  let current = params.championships.map((c) => ({ ...c }));
  const localIds = current
    .filter((c) => (c.game ?? "lol") === game && !isBlockedInternational(c) && c.teams.length > 0)
    .map((c) => c.id)
    .sort(() => Math.random() - 0.5);

  let pool: Player[] | undefined;
  let totalMoves = 0;
  const lockedIgns = new Set<string>();

  for (const id of localIds) {
    const champ = current.find((c) => c.id === id);
    if (!champ) continue;

    const res = runAutonomousMarket({
      championship: champ,
      allChampionships: current,
      career,
      freeAgentsPool: pool,
      intensity: "normal",
      lockedIgns,
    });
    pool = res.remainingFreeAgents;
    totalMoves += res.news.length;

    current = current.map((c) => {
      if (c.id !== id) return c;
      return {
        ...c,
        teams: res.updatedTeams,
        serieB: c.serieB && res.updatedSerieBTeams ? { ...c.serieB, teams: res.updatedSerieBTeams } : c.serieB,
        transferHistory:
          res.news.length > 0
            ? [...res.news, ...(c.transferHistory ?? [])].slice(0, 40)
            : c.transferHistory,
      };
    });

    if (res.externalUpdates.length > 0) {
      current = applyExternalUpdatesToChampionships(current, res.externalUpdates);
    }
  }

  return { updatedChampionships: current, totalMoves };
}
