import type {
  CareerIntlPlayer,
  CareerLedger,
  Championship,
  Player,
  PlayerRole,
  Team,
} from "./types";
import { getOfficialLogo } from "./official-logos";
import { playerOverall } from "./players";

function finalDecidedMatch(c: Championship) {
  const lastPhase = c.phases[c.phases.length - 1];
  if (!lastPhase || lastPhase.kind !== "bracket") return undefined;
  return lastPhase.matches
    .filter(
      (m) =>
        m.winnerId &&
        m.teamAId &&
        m.teamBId &&
        (m.bracketSide === "grand" || m.bracketSide === "reset" || !m.nextMatchId),
    )
    .sort((a, b) => (b.round ?? 0) - (a.round ?? 0))[0];
}

function championTeamId(c: Championship): string | null {
  return finalDecidedMatch(c)?.winnerId ?? null;
}

function runnerUpTeamId(c: Championship): string | null {
  const m = finalDecidedMatch(c);
  if (!m || !m.winnerId) return null;
  return m.winnerId === m.teamAId ? (m.teamBId ?? null) : (m.teamAId ?? null);
}

export type LoLIntlTier = "worlds" | "msi" | "minor";

export interface TeamGoatEntry {
  rank: number;
  name: string;
  tag?: string;
  logo?: string;
  region?: string;
  worldsTitles: number;
  msiTitles: number;
  minorIntlTitles: number;
  majorFinals: number;
  intlPlayoffs: number;
  years: string[];
  goatScore: number;
  eraLabel: string;
}

export interface PlayerGoatEntry {
  rank: number;
  ign: string;
  real?: string;
  country?: string;
  role: PlayerRole;
  teamName: string;
  teamTag?: string;
  worldsTitles: number;
  msiTitles: number;
  minorIntlTitles: number;
  majorFinals: number;
  intlPlayoffs: number;
  intlMvps: number;
  intlPlayoffMvps: number;
  years: string[];
  peakOverall?: number;
  retired?: boolean;
  goatScore: number;
  eraLabel: string;
}

export function isNationalOrWorldCup(name?: string): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return (
    /^sele[cç][aã]o\b/i.test(n) ||
    /copa do mundo|world cup|sele[cç][õo]es/i.test(n)
  );
}

/**
 * Classifica um campeonato de LoL: apenas torneios INTERNACIONAIS de clubes contam.
 * Ligas domésticas (CBLOL, LCK, LPL, LEC, LCS, LCP, etc.) retornam `null`.
 */
export function classifyLoLIntlTournament(name?: string): LoLIntlTier | null {
  if (!name) return null;
  if (isNationalOrWorldCup(name)) return null;
  const n = name.trim().toLowerCase();
  if (/world championship|\bworlds\b|mundial/i.test(n)) return "worlds";
  if (/mid-season invitational|\bmsi\b/i.test(n)) return "msi";
  if (
    /first stand|rift rivals|global masters|supercopa|desafiantes|intercontinental/i.test(
      n,
    )
  ) {
    return "minor";
  }
  return null;
}

export function extractSeasonYear(
  label?: string,
  champName?: string,
  at?: string,
): string {
  const fromLabel = label?.match(/\b(20\d{2})\b/)?.[1];
  if (fromLabel) return fromLabel;
  const fromName = champName?.match(/\b(20\d{2})\b/)?.[1];
  if (fromName) return fromName;
  const fromAt = at?.match(/\b(20\d{2})\b/)?.[1];
  if (fromAt) return fromAt;
  return "2026";
}

export function playerGoatKey(ign: string): string {
  return ign
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function formatEraLabel(years: string[]): string {
  if (years.length === 0) return "—";
  const sorted = [...years].sort();
  if (sorted.length === 1) return sorted[0];
  return `${sorted[0]}–${sorted[sorted.length - 1]} (${sorted.length} temps)`;
}

function teamPlayoffIds(c: Championship): Set<string> {
  const ids = new Set<string>();
  const lastPhase = c.phases[c.phases.length - 1];
  if (!lastPhase || lastPhase.kind !== "bracket") return ids;
  for (const m of lastPhase.matches) {
    if (m.teamAId) ids.add(m.teamAId);
    if (m.teamBId) ids.add(m.teamBId);
  }
  return ids;
}

function startersOf(team: Team): Player[] {
  const roster = team.roster ?? [];
  const starters = roster.filter((p) => !p.isSub);
  return (starters.length >= 5 ? starters : roster).slice(0, 5);
}

/**
 * Calcula os rankings GOAT (Greatest of All Time) de LoL:
 * - Somente competições INTERNACIONAIS (ligas locais são ignoradas).
 * - Exige dominância prolongada (mínimo 2 temporadas/anos distintos e múltiplos títulos/finais de peso).
 * - Sem poluição: máx. 8 times e máx. 10 jogadores.
 */
export function computeLoLGoats(
  career: CareerLedger,
  championships: Championship[],
): { teamGoats: TeamGoatEntry[]; playerGoats: PlayerGoatEntry[] } {
  const lolCareer = career.lol ?? {};
  const lolChamps = championships.filter((c) => (c.game ?? "lol") === "lol");

  // ---------- 1. TIMES GOAT ----------
  interface TeamAcc {
    name: string;
    tag?: string;
    logo?: string;
    region?: string;
    worldsTitles: number;
    msiTitles: number;
    minorIntlTitles: number;
    majorFinals: number;
    intlPlayoffs: number;
    years: Set<string>;
    creditedKeys: Set<string>;
  }

  const teamMap = new Map<string, TeamAcc>();

  const ensureTeamAcc = (
    name: string,
    tag?: string,
    logo?: string,
    region?: string,
  ): TeamAcc => {
    const key = name.trim().toLowerCase();
    const existing = teamMap.get(key);
    if (existing) {
      if (!existing.tag && tag) existing.tag = tag;
      if (!existing.logo && logo) existing.logo = logo;
      if (!existing.region && region) existing.region = region;
      return existing;
    }
    const careerRow = lolCareer[key];
    const acc: TeamAcc = {
      name: careerRow?.name ?? name,
      tag: tag ?? careerRow?.tag,
      logo: logo ?? careerRow?.logo ?? getOfficialLogo(name, tag),
      region: region ?? careerRow?.region,
      worldsTitles: 0,
      msiTitles: 0,
      minorIntlTitles: 0,
      majorFinals: 0,
      intlPlayoffs: 0,
      years: new Set<string>(),
      creditedKeys: new Set<string>(),
    };
    teamMap.set(key, acc);
    return acc;
  };

  // 1a. Títulos permanentes salvos em career.titles (somente internacionais de LoL)
  for (const t of career.titles ?? []) {
    if ((t.game ?? "lol") !== "lol") continue;
    if (isNationalOrWorldCup(t.teamName) || isNationalOrWorldCup(t.champName)) {
      continue;
    }
    const tier = classifyLoLIntlTournament(t.champName);
    if (!tier) continue;

    const year = extractSeasonYear(t.label, t.champName, t.at);
    const acc = ensureTeamAcc(t.teamName, t.teamTag, t.teamLogo);
    const dedup = `${tier}:${t.champName.trim().toLowerCase()}:${year}`;
    if (acc.creditedKeys.has(dedup)) continue;
    acc.creditedKeys.add(dedup);

    acc.years.add(year);
    if (tier === "worlds") acc.worldsTitles += 1;
    else if (tier === "msi") acc.msiTitles += 1;
    else acc.minorIntlTitles += 1;
  }

  // 1b. Vice-campeonatos, playoffs e edições ativas/concluídas em championships
  for (const c of lolChamps) {
    const tier = classifyLoLIntlTournament(c.name);
    if (!tier) continue;
    const year = extractSeasonYear(c.season, c.name);
    const allTeams = [...c.teams, ...(c.formerTeams ?? [])];
    const teamById = new Map(allTeams.map((t) => [t.id, t]));

    const champId = championTeamId(c);
    if (champId) {
      const champTeam = teamById.get(champId);
      if (champTeam && !isNationalOrWorldCup(champTeam.name)) {
        const acc = ensureTeamAcc(
          champTeam.name,
          champTeam.tag,
          champTeam.logo,
          champTeam.region,
        );
        const dedup = `${tier}:${c.name.trim().toLowerCase()}:${year}`;
        if (!acc.creditedKeys.has(dedup)) {
          acc.creditedKeys.add(dedup);
          acc.years.add(year);
          if (tier === "worlds") acc.worldsTitles += 1;
          else if (tier === "msi") acc.msiTitles += 1;
          else acc.minorIntlTitles += 1;
        }
      }
    }

    const runnerId = runnerUpTeamId(c);
    if (runnerId) {
      const runnerTeam = teamById.get(runnerId);
      if (runnerTeam && !isNationalOrWorldCup(runnerTeam.name)) {
        const acc = ensureTeamAcc(
          runnerTeam.name,
          runnerTeam.tag,
          runnerTeam.logo,
          runnerTeam.region,
        );
        if (tier === "worlds" || tier === "msi") {
          acc.majorFinals += 1;
          acc.years.add(year);
        }
      }
    }

    const poIds = teamPlayoffIds(c);
    for (const tid of poIds) {
      if (tid === champId) continue;
      const t = teamById.get(tid);
      if (!t || isNationalOrWorldCup(t.name)) continue;
      const acc = ensureTeamAcc(t.name, t.tag, t.logo, t.region);
      acc.intlPlayoffs += 1;
      if (tier === "worlds" || tier === "msi") acc.years.add(year);
    }
  }

  const teamGoats: TeamGoatEntry[] = [];
  for (const acc of teamMap.values()) {
    const years = Array.from(acc.years).sort();
    const majorTitles = acc.worldsTitles + acc.msiTitles;
    const totalIntlTitles = majorTitles + acc.minorIntlTitles;

    // Régua rigorosa: dominância prolongada (2+ temporadas distintas) + peso internacional real
    const qualifies =
      years.length >= 2 &&
      (majorTitles >= 2 ||
        (majorTitles >= 1 && totalIntlTitles >= 3) ||
        (majorTitles >= 1 && acc.majorFinals >= 2) ||
        totalIntlTitles >= 4);

    if (!qualifies) continue;

    const goatScore =
      acc.worldsTitles * 55 +
      acc.msiTitles * 35 +
      acc.minorIntlTitles * 14 +
      acc.majorFinals * 18 +
      acc.intlPlayoffs * 5 +
      Math.max(0, years.length - 1) * 10;

    teamGoats.push({
      rank: 0,
      name: acc.name,
      tag: acc.tag,
      logo: acc.logo,
      region: acc.region,
      worldsTitles: acc.worldsTitles,
      msiTitles: acc.msiTitles,
      minorIntlTitles: acc.minorIntlTitles,
      majorFinals: acc.majorFinals,
      intlPlayoffs: acc.intlPlayoffs,
      years,
      goatScore,
      eraLabel: formatEraLabel(years),
    });
  }

  teamGoats.sort(
    (a, b) =>
      b.goatScore - a.goatScore ||
      b.worldsTitles - a.worldsTitles ||
      b.msiTitles - a.msiTitles ||
      b.years.length - a.years.length ||
      a.name.localeCompare(b.name),
  );
  const topTeams = teamGoats.slice(0, 8).map((t, i) => ({ ...t, rank: i + 1 }));

  // ---------- 2. JOGADORES GOAT ----------
  const retiredKeys = new Set<string>();
  const knownPlayersByKey = new Map<string, { player: Player; team: Team }>();
  for (const c of lolChamps) {
    for (const r of c.retiredPlayers ?? []) {
      retiredKeys.add(playerGoatKey(r.ign));
    }
    for (const t of [...c.teams, ...(c.formerTeams ?? [])]) {
      for (const p of t.roster ?? []) {
        knownPlayersByKey.set(playerGoatKey(p.ign), { player: p, team: t });
      }
    }
  }

  const playerMap = new Map<string, CareerIntlPlayer>();

  const ensurePlayerAcc = (seed: {
    ign: string;
    real?: string;
    country?: string;
    role: PlayerRole;
    teamName: string;
    teamTag?: string;
    peakOverall?: number;
    retired?: boolean;
  }): CareerIntlPlayer => {
    const key = playerGoatKey(seed.ign);
    const existing = playerMap.get(key);
    if (existing) {
      if (!existing.real && seed.real) existing.real = seed.real;
      if (!existing.country && seed.country) existing.country = seed.country;
      if (seed.teamName) existing.teamName = seed.teamName;
      if (seed.teamTag) existing.teamTag = seed.teamTag;
      if (
        seed.peakOverall &&
        (!existing.peakOverall || seed.peakOverall > existing.peakOverall)
      ) {
        existing.peakOverall = seed.peakOverall;
      }
      if (seed.retired || retiredKeys.has(key)) existing.retired = true;
      return existing;
    }
    const created: CareerIntlPlayer = {
      ign: seed.ign,
      real: seed.real,
      country: seed.country,
      role: seed.role,
      teamName: seed.teamName,
      teamTag: seed.teamTag,
      worldsTitles: 0,
      msiTitles: 0,
      minorIntlTitles: 0,
      majorFinals: 0,
      intlPlayoffs: 0,
      intlMvps: 0,
      intlPlayoffMvps: 0,
      years: [],
      peakOverall: seed.peakOverall,
      retired: seed.retired || retiredKeys.has(key),
    };
    playerMap.set(key, created);
    return created;
  };

  // 2a. Histórico permanente já salvo em career.intlPlayers
  for (const saved of Object.values(career.intlPlayers ?? {})) {
    const key = playerGoatKey(saved.ign);
    playerMap.set(key, {
      ...saved,
      years: [...new Set(saved.years ?? [])],
      retired: saved.retired || retiredKeys.has(key),
    });
  }

  // 2b. Complementa com edições internacionais em `championships` ainda não creditadas no seen
  const seen = career.seen ?? {};
  const addYear = (acc: CareerIntlPlayer, year: string) => {
    if (!acc.years.includes(year)) acc.years.push(year);
  };

  for (const c of lolChamps) {
    const tier = classifyLoLIntlTournament(c.name);
    if (!tier) continue;
    const year = extractSeasonYear(c.season, c.name);
    const allTeams = [...c.teams, ...(c.formerTeams ?? [])];
    const teamById = new Map(allTeams.map((t) => [t.id, t]));

    const champId = championTeamId(c);
    if (champId) {
      const champTeam = teamById.get(champId);
      if (champTeam && !isNationalOrWorldCup(champTeam.name)) {
        for (const p of startersOf(champTeam)) {
          const pKey = playerGoatKey(p.ign);
          if (seen[`intlplayer:${c.id}:title:${pKey}`]) continue;
          const acc = ensurePlayerAcc({
            ign: p.ign,
            real: p.real,
            country: p.country,
            role: p.role,
            teamName: champTeam.name,
            teamTag: champTeam.tag,
            peakOverall: playerOverall(p),
          });
          addYear(acc, year);
          if (tier === "worlds") acc.worldsTitles += 1;
          else if (tier === "msi") acc.msiTitles += 1;
          else acc.minorIntlTitles += 1;
        }
      }
    }

    const runnerId = runnerUpTeamId(c);
    if (runnerId && (tier === "worlds" || tier === "msi")) {
      const runnerTeam = teamById.get(runnerId);
      if (runnerTeam && !isNationalOrWorldCup(runnerTeam.name)) {
        for (const p of startersOf(runnerTeam)) {
          const pKey = playerGoatKey(p.ign);
          if (seen[`intlplayer:${c.id}:runnerup:${pKey}`]) continue;
          const acc = ensurePlayerAcc({
            ign: p.ign,
            real: p.real,
            country: p.country,
            role: p.role,
            teamName: runnerTeam.name,
            teamTag: runnerTeam.tag,
            peakOverall: playerOverall(p),
          });
          addYear(acc, year);
          acc.majorFinals += 1;
        }
      }
    }

    // MVPs em partidas internacionais
    for (const ph of c.phases) {
      for (const m of ph.matches) {
        if (!m.winnerId || !m.mvp) continue;
        const pKey = playerGoatKey(m.mvp.playerName);
        if (seen[`intlmvp:${m.id}:${pKey}`]) continue;
        const mvpTeam = teamById.get(m.mvp.teamId);
        if (mvpTeam && isNationalOrWorldCup(mvpTeam.name)) continue;
        const known = knownPlayersByKey.get(pKey);
        const acc = ensurePlayerAcc({
          ign: m.mvp.playerName,
          real: known?.player.real,
          country: known?.player.country,
          role: m.mvp.role,
          teamName: mvpTeam?.name ?? known?.team.name ?? "—",
          teamTag: mvpTeam?.tag ?? known?.team.tag,
          peakOverall: known ? playerOverall(known.player) : undefined,
        });
        addYear(acc, year);
        acc.intlMvps += 1;
        if (ph.kind === "bracket") acc.intlPlayoffMvps += 1;
      }
    }
  }

  const playerGoats: PlayerGoatEntry[] = [];
  for (const acc of playerMap.values()) {
    const years = [...new Set(acc.years)].sort();
    const majorTitles = acc.worldsTitles + acc.msiTitles;
    const totalIntlTitles = majorTitles + acc.minorIntlTitles;

    // Régua rigorosa: dominância prolongada (2+ anos distintos) + títulos/finais internacionais
    const qualifies =
      years.length >= 2 &&
      (majorTitles >= 2 ||
        (majorTitles >= 1 && totalIntlTitles >= 3) ||
        (majorTitles >= 1 && acc.majorFinals >= 1 && acc.intlMvps >= 2) ||
        totalIntlTitles >= 4);

    if (!qualifies) continue;

    const goatScore =
      acc.worldsTitles * 55 +
      acc.msiTitles * 35 +
      acc.minorIntlTitles * 14 +
      acc.majorFinals * 18 +
      acc.intlPlayoffMvps * 9 +
      Math.max(0, acc.intlMvps - acc.intlPlayoffMvps) * 4 +
      Math.max(0, years.length - 1) * 10;

    playerGoats.push({
      rank: 0,
      ign: acc.ign,
      real: acc.real,
      country: acc.country,
      role: acc.role,
      teamName: acc.teamName,
      teamTag: acc.teamTag,
      worldsTitles: acc.worldsTitles,
      msiTitles: acc.msiTitles,
      minorIntlTitles: acc.minorIntlTitles,
      majorFinals: acc.majorFinals,
      intlPlayoffs: acc.intlPlayoffs,
      intlMvps: acc.intlMvps,
      intlPlayoffMvps: acc.intlPlayoffMvps,
      years,
      peakOverall: acc.peakOverall,
      retired: acc.retired,
      goatScore,
      eraLabel: formatEraLabel(years),
    });
  }

  playerGoats.sort(
    (a, b) =>
      b.goatScore - a.goatScore ||
      b.worldsTitles - a.worldsTitles ||
      b.msiTitles - a.msiTitles ||
      b.intlMvps - a.intlMvps ||
      b.years.length - a.years.length ||
      a.ign.localeCompare(b.ign),
  );
  const topPlayers = playerGoats.slice(0, 10).map((p, i) => ({ ...p, rank: i + 1 }));

  return { teamGoats: topTeams, playerGoats: topPlayers };
}
