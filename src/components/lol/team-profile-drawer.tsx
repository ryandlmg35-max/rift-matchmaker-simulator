import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Trophy,
  Medal,
  Users,
  Swords,
  Flame,
  Award,
  X,
  TrendingUp,
  Shield,
  Activity,
  Globe,
  Calendar,
  SlidersHorizontal,
  UserPlus,
  UserMinus,
  ArrowUpDown,
  Search,
} from "lucide-react";
import type { CareerLedger, Championship, GameId, Player, PlayerRole, Team } from "@/lib/lol/types";
import { TeamLogo } from "./team-logo";
import { CountryFlag } from "./country-flag";
import { PlayerAvatar } from "./player-avatar";
import { PlayerProfileDrawer } from "./player-profile-drawer";
import { ensureRoster, pickStarters, playerOverall, rosterStrength } from "@/lib/lol/players";
import { REAL_ROSTERS } from "@/lib/lol/real-rosters";
import { CS2_ALL_TEAMS_DB, getCs2TeamRoster } from "@/lib/lol/cs2-seed";
import {
  getPlayerBuyout,
  getPlayerContractSplits,
  getPlayerSalary,
  getTeamBaseBudget,
  isPlayerImport,
} from "@/lib/lol/transfers";
import { uid } from "@/lib/lol/generate";
import { canonicalTournamentName, extractSeasonFromChampName } from "@/lib/lol/international";
import { useStore } from "@/lib/lol/store";
import { getPlayerCareerAwards } from "@/lib/lol/mvp";

export function TeamProfileDrawer({
  team,
  championship,
  career,
  game = "lol",
  allChampionships = [],
  onClose,
}: {
  team: Team;
  championship?: Championship;
  career?: CareerLedger;
  game?: GameId;
  allChampionships?: Championship[];
  onClose: () => void;
}) {
  const { championships: storeChampionships, controlTeamRoster } = useStore();
  const effectiveChampionships = allChampionships && allChampionships.length > 0 ? allChampionships : storeChampionships;
  const [activeTab, setActiveTab] = useState<"trophies" | "roster" | "stats" | "history">("trophies");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [manageMode, setManageMode] = useState(false);
  const [hireMode, setHireMode] = useState<"market" | "custom">("market");
  const [marketFilter, setMarketFilter] = useState<"accessible" | "free" | "all">("accessible");
  const [marketRoleFilter, setMarketRoleFilter] = useState<"all" | PlayerRole>("all");
  const [marketLimit, setMarketLimit] = useState(40);
  const [marketQuery, setMarketQuery] = useState("");
  const [customIgn, setCustomIgn] = useState("");
  const [customRole, setCustomRole] = useState<PlayerRole>("mid");
  const [customOvr, setCustomOvr] = useState<number>(65);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const normKey = team.name.trim().toLowerCase();
  const normTag = (team.tag ?? "").trim().toLowerCase();
  const activeGame =
    championship?.game ??
    (["EU", "CIS", "SA", "NA", "ASIA"].includes((team.region ?? "").trim().toUpperCase())
      ? "cs2"
      : game);

  const liveTeam =
    storeChampionships
      .filter((c) => (c.game ?? "lol") === activeGame)
      .flatMap((c) => [...c.teams, ...(c.serieB?.teams ?? [])])
      .find((t) => t.name.trim().toLowerCase() === normKey) ?? team;

  const roster = liveTeam.roster && liveTeam.roster.length > 0
    ? liveTeam.roster
    : manageMode
      ? []
      : (ensureRoster(liveTeam) ?? []);
  const starters = pickStarters(roster);
  const starterIds = new Set(starters.map((p) => p.id));
  const subs = roster.filter((p) => !starterIds.has(p.id));
  const currentStrength = rosterStrength(roster) ?? 0;

  const roleLabel = (role: PlayerRole) => {
    if (activeGame === "cs2") {
      switch (role) {
        case "top":
          return "ENTRY";
        case "jungle":
          return "SUP";
        case "mid":
          return "RIFLER";
        case "adc":
          return "AWPER";
        case "support":
          return "IGL";
      }
    }
    return role.toUpperCase();
  };

  const handleFirePlayer = (playerId: string) => {
    const next = roster.filter((p) => p.id !== playerId);
    controlTeamRoster(activeGame, liveTeam.name, next);
  };

  const handleToggleSub = (player: Player) => {
    const next = roster.map((p) => (p.id === player.id ? { ...p, sub: !p.sub } : p));
    controlTeamRoster(activeGame, liveTeam.name, next);
  };

  const handleHireFromMarket = (candidate: Player) => {
    const existingIds = new Set(roster.map((p) => p.ign.trim().toLowerCase()));
    if (existingIds.has(candidate.ign.trim().toLowerCase())) return;
    const hasStarterInRole = roster.some((p) => !p.sub && p.role === candidate.role);
    const hired: Player = {
      ...candidate,
      id: candidate.id || uid(),
      sub: hasStarterInRole,
      contractSplits: playerOverall(candidate) >= 82 ? 3 : 2,
    };
    controlTeamRoster(activeGame, liveTeam.name, [...roster, hired], {
      removePlayerIgnFromOthers: candidate.ign,
    });
  };

  const handleHireCustom = () => {
    const ign = customIgn.trim();
    if (!ign || customEstimatedSalary > availableBudget) return;
    const clamped = Math.max(20, Math.min(98, Math.round(customOvr)));
    const hasStarterInRole = roster.some((p) => !p.sub && p.role === customRole);
    const newPlayer: Player = {
      id: uid(),
      ign,
      role: customRole,
      age: 21,
      sub: hasStarterInRole,
      custom: true,
      attrs: {
        mechanics: clamped,
        gameIq: Math.max(20, Math.min(98, clamped - 1)),
        clutch: Math.max(20, Math.min(98, clamped - 2)),
        consistency: clamped,
        aggression: clamped,
        adaptability: clamped,
        intlExperience: Math.max(15, Math.min(95, clamped - 10)),
        mentality: clamped,
      },
    };
    controlTeamRoster(activeGame, liveTeam.name, [...roster, newPlayer]);
    setCustomIgn("");
  };

  const careerEntry = career?.[activeGame]?.[normKey];

  const isSerieB = useMemo(() => {
    if (championship?.serieB?.teams.some((t) => t.name.trim().toLowerCase() === normKey)) {
      return true;
    }
    return storeChampionships.some(
      (c) =>
        (c.game ?? "lol") === activeGame &&
        c.serieB?.teams.some((t) => t.name.trim().toLowerCase() === normKey),
    );
  }, [championship, storeChampionships, activeGame, normKey]);

  const teamBudget = useMemo(
    () =>
      getTeamBaseBudget(
        liveTeam,
        liveTeam.region || championship?.region,
        (careerEntry?.titles ?? 0) > 0,
        isSerieB,
        career,
        activeGame,
      ),
    [liveTeam, championship?.region, careerEntry?.titles, isSerieB, career, activeGame],
  );

  const currentPayroll = useMemo(
    () =>
      roster.reduce(
        (sum, p) => sum + getPlayerSalary(p, liveTeam.region || championship?.region, career, activeGame),
        0,
      ),
    [roster, liveTeam.region, championship?.region, career, activeGame],
  );

  const availableBudget = Math.max(0, teamBudget - currentPayroll);
  const teamRegionEff = liveTeam.region || championship?.region;
  const currentStarterImports = useMemo(
    () => starters.filter((p) => isPlayerImport(p, teamRegionEff)).length,
    [starters, teamRegionEff],
  );

  type MarketStatus = "accessible" | "expensive" | "uninterested";
  interface MarketItem {
    player: Player;
    teamName: string;
    isFree: boolean;
    ovr: number;
    salary: number;
    buyout: number;
    contractSplits: number;
    status: MarketStatus;
    reason?: string;
  }

  const evaluatedMarket = useMemo<MarketItem[]>(() => {
    if (!manageMode) return [];
    const currentIgns = new Set(roster.map((p) => p.ign.trim().toLowerCase()));
    const seen = new Set<string>();
    const raw: { player: Player; currentTeam: Team | null; teamName: string; isFree: boolean }[] = [];

    // 1. Jogadores nos campeonatos ativos do jogo
    for (const c of storeChampionships) {
      if ((c.game ?? "lol") !== activeGame) continue;
      for (const t of [...c.teams, ...(c.serieB?.teams ?? [])]) {
        if (t.name.trim().toLowerCase() === normKey) continue;
        for (const p of t.roster ?? []) {
          const key = p.ign.trim().toLowerCase();
          if (!key || currentIgns.has(key) || seen.has(key)) continue;
          seen.add(key);
          raw.push({
            player: p,
            currentTeam: t,
            teamName: t.name,
            isFree: false,
          });
        }
      }
    }

    // 2. Banco completo do jogo (ligas não abertas ou jogadores demitidos -> agentes livres)
    if (activeGame === "lol") {
      for (const [reg, teams] of Object.entries(REAL_ROSTERS)) {
        for (const st of teams) {
          const built = ensureRoster({ id: "", name: st.name, tag: "", region: reg }) ?? [];
          for (const p of built) {
            const key = p.ign.trim().toLowerCase();
            if (!key || currentIgns.has(key) || seen.has(key)) continue;
            seen.add(key);
            raw.push({
              player: { ...p, sub: false },
              currentTeam: null,
              teamName: `Livre (${reg})`,
              isFree: true,
            });
          }
        }
      }
    } else {
      for (const spec of CS2_ALL_TEAMS_DB) {
        const built = getCs2TeamRoster(spec.name, spec.tag) ?? [];
        for (const p of built) {
          const key = p.ign.trim().toLowerCase();
          if (!key || currentIgns.has(key) || seen.has(key)) continue;
          seen.add(key);
          raw.push({
            player: { ...p, sub: false },
            currentTeam: null,
            teamName: `Livre (${spec.region})`,
            isFree: true,
          });
        }
      }
    }

    const teamPrestige = careerEntry?.rating ?? 50;
    const teamCulture = liveTeam.culture ?? 50;
    const hasTitles = (careerEntry?.titles ?? 0) > 0;
    const teamAvgOvr = currentStrength || 60;

    return raw.map(({ player, currentTeam, teamName, isFree }) => {
      const ovr = playerOverall(player);
      const salary = getPlayerSalary(player, teamRegionEff, career, activeGame);
      const contractSplits = isFree ? 0 : getPlayerContractSplits(player);
      const buyout = isFree
        ? 0
        : getPlayerBuyout(player, currentTeam?.region || teamRegionEff, career, activeGame);
      const totalCost = salary + buyout;
      const isImp = isPlayerImport(player, teamRegionEff);
      const replacingStarter = starters.find((s) => s.role === player.role);
      const replacingIsImp = replacingStarter ? isPlayerImport(replacingStarter, teamRegionEff) : false;
      const projectedImports =
        currentStarterImports + (isImp && !replacingIsImp ? 1 : 0);

      let uninterestedReason: string | undefined;

      if (isSerieB && ovr >= 76 && !player.sub) {
        uninterestedReason = "Não aceita jogar a Série B";
      } else if (ovr >= 82 && teamCulture < 38 && !hasTitles) {
        uninterestedReason = "Vestiário em crise para o nível dele";
      } else if (ovr >= 82) {
        const minLevel = ovr >= 86 ? ovr - 11 : ovr - 13;
        if (teamAvgOvr < minLevel && teamPrestige < 58 && !hasTitles) {
          uninterestedReason = "Exige elenco/prestígio para brigar por título";
        }
      }

      if (!uninterestedReason && isImp && ovr >= 80 && teamAvgOvr < 72 && teamPrestige < 54 && teamCulture < 52) {
        uninterestedReason = "Import de elite exige projeto mais forte";
      }

      if (!uninterestedReason && isImp && projectedImports > 2) {
        uninterestedReason = "Limite de 2 imports titulares atingido";
      }

      if (!uninterestedReason && currentTeam && !player.sub) {
        const fromStarters = pickStarters(currentTeam.roster ?? []);
        const fromAvg =
          fromStarters.length > 0
            ? fromStarters.reduce((acc, s) => acc + playerOverall(s), 0) / fromStarters.length
            : 60;
        const fromPrestige =
          career?.[activeGame]?.[currentTeam.name.trim().toLowerCase()]?.rating ?? 50;
        const betterProject =
          teamAvgOvr >= fromAvg - 2 ||
          teamPrestige >= fromPrestige + 4 ||
          teamCulture >= (currentTeam.culture ?? 50) + 10;
        if (!betterProject) {
          uninterestedReason = `Prefere seguir no projeto da ${currentTeam.name}`;
        }
      }

      if (uninterestedReason) {
        return {
          player,
          teamName,
          isFree,
          ovr,
          salary,
          buyout,
          contractSplits,
          status: "uninterested" as const,
          reason: uninterestedReason,
        };
      }

      if (totalCost > availableBudget) {
        return {
          player,
          teamName,
          isFree,
          ovr,
          salary,
          buyout,
          contractSplits,
          status: "expensive" as const,
          reason:
            buyout > 0
              ? `Sem orçamento (Salário $${salary}k + Multa $${buyout}k > $${availableBudget}k)`
              : `Sem orçamento ($${salary}k > $${availableBudget}k)`,
        };
      }

      return {
        player,
        teamName,
        isFree,
        ovr,
        salary,
        buyout,
        contractSplits,
        status: "accessible" as const,
      };
    });
  }, [
    manageMode,
    roster,
    storeChampionships,
    activeGame,
    normKey,
    teamRegionEff,
    career,
    careerEntry,
    liveTeam.culture,
    currentStrength,
    starters,
    currentStarterImports,
    isSerieB,
    availableBudget,
  ]);

  const marketCounts = useMemo(
    () => ({
      accessible: evaluatedMarket.filter((m) => m.status === "accessible").length,
      free: evaluatedMarket.filter((m) => m.isFree).length,
      all: evaluatedMarket.length,
    }),
    [evaluatedMarket],
  );

  const filteredMarket = useMemo(() => {
    const q = marketQuery.trim().toLowerCase();
    return evaluatedMarket
      .filter((item) => {
        if (marketFilter === "accessible" && item.status !== "accessible") return false;
        if (marketFilter === "free" && !item.isFree) return false;
        if (marketRoleFilter !== "all" && item.player.role !== marketRoleFilter) return false;
        if (!q) return true;
        return (
          item.player.ign.toLowerCase().includes(q) ||
          item.teamName.toLowerCase().includes(q) ||
          (item.player.country ?? "").toLowerCase().includes(q) ||
          roleLabel(item.player.role).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const rank = (s: MarketStatus) => (s === "accessible" ? 0 : s === "expensive" ? 1 : 2);
        if (marketFilter === "all") {
          const rDiff = rank(a.status) - rank(b.status);
          if (rDiff !== 0) return rDiff;
        }
        return b.ovr - a.ovr;
      });
  }, [evaluatedMarket, marketFilter, marketRoleFilter, marketQuery, activeGame]);

  const customEstimatedSalary = useMemo(() => {
    const clamped = Math.max(20, Math.min(98, Math.round(customOvr)));
    return getPlayerSalary(
      {
        id: "tmp",
        ign: customIgn || "Novo",
        role: customRole,
        attrs: { mechanics: clamped, gameIq: clamped, clutch: clamped, mentality: clamped },
      },
      teamRegionEff,
      career,
      activeGame,
    );
  }, [customOvr, customIgn, customRole, teamRegionEff, career, activeGame]);

  const matchTeam = (name?: string, tag?: string) => {
    if (!name) return false;
    const n = name.trim().toLowerCase();
    const t = (tag ?? "").trim().toLowerCase();
    return n === normKey || (normTag !== "" && t !== "" && t === normTag);
  };

  const formatConquestDate = (dateStr?: string): string => {
    if (!dateStr) return "Temporada Oficial";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  interface DetailedTitle {
    key: string;
    titleName: string;
    tourney: string;
    split: string;
    dateFormatted: string;
    rawDate?: string;
  }

  const normTitleSplit = (s: string) =>
    s
      .replace(/\s*\(Série B\)\s*$/i, "")
      .replace(/[·\-_/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const titleMap = new Map<string, DetailedTitle>();

  // 1. Títulos registrados no Hall da Fama permanente da Carreira (career.titles)
  for (const t of career?.titles ?? []) {
    if ((t.game ?? "lol") !== activeGame) continue;
    if (matchTeam(t.teamName, t.teamTag)) {
      const tourney = canonicalTournamentName(t.champName || championship?.name || "Campeonato Oficial");
      const split = t.label || "Edição Oficial";
      const key = `${tourney.toLowerCase()}:::${normTitleSplit(split)}`;
      titleMap.set(key, {
        key,
        titleName: `Campeão do ${tourney}`,
        tourney,
        split,
        dateFormatted: formatConquestDate(t.at),
        rawDate: t.at,
      });
    }
  }

  // 2. Títulos salvos no histórico das edições (championship.history)
  const allPool = (championship ? [championship, ...effectiveChampionships] : effectiveChampionships)
    .filter((c) => (c.game ?? "lol") === activeGame);
  for (const c of allPool) {
    const listA = (c.history ?? []).map((h) => ({ h, div: "Série A", cName: c.name }));
    const listB = (c.serieB?.history ?? []).map((h) => ({ h, div: "Série B", cName: `${c.name} (Série B)` }));
    for (const { h, cName } of [...listA, ...listB]) {
      if (matchTeam(h.teamName, h.teamTag)) {
        const tourney = canonicalTournamentName(cName || "Campeonato Oficial");
        const rawSplit = h.splitLabel || c.season || "Split Oficial";
        const canonicalSplit = extractSeasonFromChampName(cName, rawSplit);
        const key = `${tourney.toLowerCase()}:::${normTitleSplit(canonicalSplit)}`;
        const altKey = `${tourney.toLowerCase()}:::${normTitleSplit(rawSplit)}`;
        const existingKey = titleMap.has(key) ? key : titleMap.has(altKey) ? altKey : key;
        if (!titleMap.has(existingKey) || h.savedAt) {
          titleMap.set(existingKey, {
            key: existingKey,
            titleName: `Campeão do ${tourney}`,
            tourney,
            split: rawSplit,
            dateFormatted: formatConquestDate(h.savedAt),
            rawDate: h.savedAt,
          });
        }
      }
    }
  }

  // 3. Se a pontuação de carreira tiver títulos históricos anteriores
  const expectedTotal = careerEntry?.titles ?? 0;
  if (expectedTotal > titleMap.size) {
    const diff = expectedTotal - titleMap.size;
    const defaultLeague = championship?.name || team.region || "Liga Oficial";
    for (let i = 0; i < diff; i++) {
      const tourney = defaultLeague;
      const split = `Split ${i + 1}`;
      const key = `hist-${i}-${tourney.toLowerCase()}`;
      titleMap.set(key, {
        key,
        titleName: `Campeão da ${tourney}`,
        tourney,
        split,
        dateFormatted: "Conquistado nesta carreira",
      });
    }
  }

  const titleList = Array.from(titleMap.values()).sort((a, b) => {
    if (a.rawDate && b.rawDate) return b.rawDate.localeCompare(a.rawDate);
    return 0;
  });

  // Estatísticas calculadas
  const rating = careerEntry?.rating ?? 50;
  const points = careerEntry?.points ?? 0;
  const matchesWon = careerEntry?.matchesWon ?? 0;
  const matchesLost = careerEntry?.matchesLost ?? 0;
  const totalMatches = matchesWon + matchesLost;
  const winRate = totalMatches > 0 ? Math.round((matchesWon / totalMatches) * 100) : 0;

  // Momentum no campeonato atual
  const teamMomentum = championship?.momentum?.[team.id];
  const form = teamMomentum?.form ?? 50;
  const streak = teamMomentum?.streak ?? 0;

  const drawerContent = (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-xl border-l border-border bg-[#0b0c10] shadow-2xl flex flex-col overflow-hidden text-foreground animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header do Perfil */}
        <div
          className="relative border-b border-border p-6"
          style={{
            background: `linear-gradient(180deg, ${team.color || "oklch(0.28 0.06 240)"}33 0%, transparent 100%)`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 rounded-lg p-2 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-4">
            <div className="relative rounded-2xl border border-border bg-card/60 p-2 shadow-xl">
              <TeamLogo team={team} className="h-20 w-20" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-foreground">
                  {team.name}
                </h2>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono font-bold uppercase text-muted-foreground">
                  {team.tag}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                {team.region ? (
                  <span className="flex items-center gap-1 font-semibold uppercase">
                    <Globe className="h-3.5 w-3.5" /> {team.region}
                  </span>
                ) : null}
                <span>·</span>
                <span className="font-semibold text-gold">
                  {titleList.length} Título(s)
                </span>
              </div>

              {/* Badges de Força & ELO */}
              <div className="mt-3 flex items-center gap-2">
                <div className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-bold text-gold">
                  <TrendingUp className="h-3.5 w-3.5" /> ELO {Math.round(rating)}
                </div>
                <div className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
                  <Activity className="h-3.5 w-3.5" /> Forma {form}%
                </div>
                {streak !== 0 ? (
                  <div
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold ${
                      streak > 0
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : "bg-blood/20 text-blood border border-blood/40"
                    }`}
                  >
                    <Flame className="h-3.5 w-3.5" /> {streak > 0 ? `+${streak} V` : `${streak} D`}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {/* Abas */}
        <div className="flex border-b border-border bg-card/40 px-4 text-xs font-bold uppercase tracking-wider">
          <button
            type="button"
            onClick={() => setActiveTab("trophies")}
            className={`flex items-center gap-1.5 border-b-2 py-3 px-3 transition-colors ${
              activeTab === "trophies"
                ? "border-gold text-gold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Trophy className="h-4 w-4" /> Sala de Troféus ({titleList.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("roster")}
            className={`flex items-center gap-1.5 border-b-2 py-3 px-3 transition-colors ${
              activeTab === "roster"
                ? "border-gold text-gold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="h-4 w-4" /> Elenco ({roster.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("stats")}
            className={`flex items-center gap-1.5 border-b-2 py-3 px-3 transition-colors ${
              activeTab === "stats"
                ? "border-gold text-gold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Shield className="h-4 w-4" /> Estatísticas
          </button>
        </div>

        {/* Conteúdo das Abas */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: TROFÉUS */}
          {activeTab === "trophies" && (
            <div className="space-y-4">
              {titleList.length >= 3 ? (
                <div className="flex items-center gap-3 rounded-xl border border-gold/50 bg-gold/15 p-4 text-gold">
                  <Award className="h-8 w-8 shrink-0" />
                  <div>
                    <h4 className="font-display text-sm font-black uppercase tracking-wider">
                      Dinastia Consagrada ({titleList.length} Títulos)
                    </h4>
                    <p className="text-xs text-gold/80">
                      Esta equipe construiu uma era dominante na história do cenário competitivo.
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="space-y-2.5">
                {titleList.length === 0 ? (
                  <div className="rounded-xl border border-border/60 bg-card/20 p-8 text-center text-xs text-muted-foreground">
                    <Trophy className="mx-auto h-8 w-8 opacity-30 mb-2" />
                    Esta equipe ainda busca seu primeiro título oficial.
                  </div>
                ) : (
                  titleList.map((t, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-xl border border-gold/30 bg-card/40 p-3.5 hover:bg-card/70 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="rounded-xl bg-gold/20 p-2 text-gold shrink-0 border border-gold/40 shadow">
                          <Trophy className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <span className="font-display text-sm font-bold text-foreground block truncate">
                            {t.titleName}
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                            <span className="font-semibold text-gold/90">{t.tourney}</span>
                            <span>·</span>
                            <span className="text-foreground/80 font-medium">{t.split}</span>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                              <Calendar className="h-3 w-3 text-gold/80" /> {t.dateFormatted}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="rounded bg-gold/20 border border-gold/40 px-2.5 py-1 text-xs font-mono font-bold text-gold shrink-0">
                        🏆 1º Lugar
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 2: ELENCO */}
          {activeTab === "roster" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-gold">
                    Titulares
                  </span>
                  <span className="rounded border border-border/60 bg-black/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                    Força {currentStrength}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setManageMode((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-mono transition-colors ${
                    manageMode
                      ? "border-gold/60 bg-gold/15 text-gold"
                      : "border-border/50 bg-transparent text-muted-foreground hover:border-gold/40 hover:text-foreground"
                  }`}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  {manageMode ? "Concluir" : "Controlar elenco"}
                </button>
              </div>

              {manageMode && (
                <div className="rounded-xl border border-gold/30 bg-card/50 p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gold inline-flex items-center gap-1.5">
                      <UserPlus className="h-3.5 w-3.5" /> Contratar jogador
                    </span>
                    <div className="flex items-center gap-1 rounded bg-black/30 p-0.5 text-[10px] font-mono">
                      <button
                        type="button"
                        onClick={() => setHireMode("market")}
                        className={`rounded px-2 py-0.5 ${
                          hireMode === "market"
                            ? "bg-gold/20 text-gold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Mercado
                      </button>
                      <button
                        type="button"
                        onClick={() => setHireMode("custom")}
                        className={`rounded px-2 py-0.5 ${
                          hireMode === "custom"
                            ? "bg-gold/20 text-gold"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Criar novo
                      </button>
                    </div>
                  </div>

                  {hireMode === "market" ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 bg-black/30 px-2.5 py-1.5 text-[10px] font-mono">
                        <span className="text-muted-foreground">
                          Orçamento: <strong className="text-foreground">${teamBudget}k</strong> · Folha:{" "}
                          <strong className="text-foreground">${currentPayroll}k</strong>
                        </span>
                        <span>
                          Livre:{" "}
                          <strong className={availableBudget > 80 ? "text-emerald-300" : "text-amber-300"}>
                            ${availableBudget}k
                          </strong>{" "}
                          · Imports:{" "}
                          <strong className={currentStarterImports >= 2 ? "text-amber-300" : "text-foreground"}>
                            {currentStarterImports}/2
                          </strong>
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1 text-[10px] font-mono">
                          {[
                            { id: "accessible" as const, label: `Acessíveis (${marketCounts.accessible})` },
                            { id: "free" as const, label: `Livres (${marketCounts.free})` },
                            { id: "all" as const, label: `Todos (${marketCounts.all})` },
                          ].map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => {
                                setMarketFilter(tab.id);
                                setMarketLimit(40);
                              }}
                              className={`rounded border px-2 py-0.5 ${
                                marketFilter === tab.id
                                  ? "border-gold/60 bg-gold/20 text-gold"
                                  : "border-border/50 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                        <select
                          value={marketRoleFilter}
                          onChange={(e) => setMarketRoleFilter(e.target.value as "all" | PlayerRole)}
                          className="rounded border border-border/60 bg-black/30 px-2 py-0.5 text-[10px] font-mono text-foreground focus:border-gold/50 focus:outline-none"
                        >
                          <option value="all">Todas funções</option>
                          {(["top", "jungle", "mid", "adc", "support"] as PlayerRole[]).map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          value={marketQuery}
                          onChange={(e) => {
                            setMarketQuery(e.target.value);
                            setMarketLimit(40);
                          }}
                          placeholder="Buscar jogador por nick, time, país ou função..."
                          className="w-full rounded border border-border/60 bg-black/30 py-1.5 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-gold/50 focus:outline-none"
                        />
                      </div>

                      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                        {filteredMarket.length === 0 ? (
                          <p className="py-3 text-center text-[11px] text-muted-foreground">
                            {marketFilter === "accessible"
                              ? "Nenhum jogador acessível com esse filtro. Demita alguém para liberar folha ou veja a aba Todos."
                              : "Nenhum jogador encontrado."}
                          </p>
                        ) : (
                          <>
                            {filteredMarket.slice(0, marketLimit).map((item) => (
                              <div
                                key={`${item.teamName}-${item.player.id}-${item.player.ign}`}
                                className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 ${
                                  item.status === "accessible"
                                    ? "border-border/50 bg-black/25"
                                    : "border-border/30 bg-black/15 opacity-75"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded bg-muted/50 px-1 py-0.5 text-[10px] font-mono text-muted-foreground shrink-0">
                                      {roleLabel(item.player.role)}
                                    </span>
                                    <CountryFlag code={item.player.country} size="xs" />
                                    <span className="truncate text-xs font-bold text-foreground">
                                      {item.player.ign}
                                    </span>
                                    <span className="truncate text-[10px] text-muted-foreground">
                                      · {item.teamName}
                                    </span>
                                  </div>
                                  {item.reason && (
                                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                      {item.reason}
                                    </p>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[10px] font-mono text-muted-foreground">
                                    ${item.salary}k{item.buyout > 0 ? ` + $${item.buyout}k multa` : ""}
                                  </span>
                                  <span className="text-[11px] font-mono font-bold text-gold">
                                    {item.ovr}
                                  </span>
                                  {item.status === "accessible" ? (
                                    <button
                                      type="button"
                                      onClick={() => handleHireFromMarket(item.player)}
                                      className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300 hover:bg-emerald-500/25"
                                    >
                                      Contratar
                                    </button>
                                  ) : item.status === "expensive" ? (
                                    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                                      Caro
                                    </span>
                                  ) : (
                                    <span className="rounded border border-border/40 bg-black/30 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                                      Recusa
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                            {filteredMarket.length > marketLimit && (
                              <button
                                type="button"
                                onClick={() => setMarketLimit((l) => l + 40)}
                                className="w-full rounded border border-border/50 bg-black/25 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:border-gold/40 hover:text-gold"
                              >
                                Mostrar mais ({filteredMarket.length - marketLimit} restantes)
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/50 bg-black/30 px-2.5 py-1.5 text-[10px] font-mono">
                        <span className="text-muted-foreground">
                          Salário estimado: <strong className="text-gold">${customEstimatedSalary}k</strong>
                        </span>
                        <span>
                          Livre:{" "}
                          <strong
                            className={
                              customEstimatedSalary <= availableBudget
                                ? "text-emerald-300"
                                : "text-blood"
                            }
                          >
                            ${availableBudget}k
                          </strong>
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <input
                          type="text"
                          value={customIgn}
                          onChange={(e) => setCustomIgn(e.target.value)}
                          placeholder="Nick (IGN)"
                          className="rounded border border-border/60 bg-black/30 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-gold/50 focus:outline-none"
                        />
                        <select
                          value={customRole}
                          onChange={(e) => setCustomRole(e.target.value as PlayerRole)}
                          className="rounded border border-border/60 bg-black/30 px-2 py-1.5 text-xs text-foreground focus:border-gold/50 focus:outline-none"
                        >
                          {(["top", "jungle", "mid", "adc", "support"] as PlayerRole[]).map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono text-muted-foreground">OVR</span>
                          <input
                            type="number"
                            min={20}
                            max={98}
                            value={customOvr}
                            onChange={(e) => setCustomOvr(Number(e.target.value) || 50)}
                            className="w-full rounded border border-border/60 bg-black/30 px-2 py-1.5 text-xs font-mono text-gold focus:border-gold/50 focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1 text-[10px] font-mono">
                          {[
                            { label: "Fraco 42", val: 42 },
                            { label: "Médio 62", val: 62 },
                            { label: "Forte 78", val: 78 },
                            { label: "Craque 90", val: 90 },
                          ].map((preset) => (
                            <button
                              key={preset.val}
                              type="button"
                              onClick={() => setCustomOvr(preset.val)}
                              className={`rounded border px-1.5 py-0.5 ${
                                customOvr === preset.val
                                  ? "border-gold/60 bg-gold/20 text-gold"
                                  : "border-border/50 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={handleHireCustom}
                          disabled={!customIgn.trim() || customEstimatedSalary > availableBudget}
                          className="rounded border border-emerald-500/40 bg-emerald-500/20 px-3 py-1 text-[11px] font-bold uppercase text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                        >
                          {customEstimatedSalary > availableBudget ? "Sem orçamento" : "Contratar"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="space-y-2">
                  {starters.map((player) => {
                    const pAwards = getPlayerCareerAwards(player.ign, allPool);
                    return (
                      <div
                        key={player.id}
                        onClick={() => setSelectedPlayer(player)}
                        className="cursor-pointer rounded-xl border border-border/60 bg-card/40 p-3 transition-colors hover:border-gold/50 hover:bg-card/70"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <PlayerAvatar ign={player.ign} role={player.role} size="sm" />
                            <span className="w-12 text-center rounded bg-muted/60 px-1.5 py-1 text-xs font-mono font-bold uppercase text-muted-foreground">
                              {roleLabel(player.role)}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <CountryFlag code={player.country} size="xs" />
                                <span className="font-display text-sm font-bold text-foreground">
                                  {player.ign}
                                </span>
                                {player.country ? (
                                  <span className="text-[11px] text-muted-foreground font-mono">
                                    {player.country}
                                  </span>
                                ) : null}
                              </div>
                              {player.real ? (
                                <span className="text-[11px] text-muted-foreground">
                                  {player.real}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 text-right">
                            <div>
                              <span className="text-[10px] uppercase text-muted-foreground block font-mono">
                                OVR
                              </span>
                              <span className="font-display text-xs font-bold text-gold">
                                {playerOverall(player)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase text-muted-foreground block font-mono">
                                Mecânica
                              </span>
                              <span className="font-display text-xs font-bold text-foreground">
                                {player.attrs.mechanics}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] uppercase text-muted-foreground block font-mono">
                                Clutch
                              </span>
                              <span className="font-display text-xs font-bold text-foreground">
                                {player.attrs.clutch}
                              </span>
                            </div>
                            {manageMode && (
                              <div
                                className="flex items-center gap-1 pl-1 border-l border-border/50"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  title="Mover para reserva"
                                  onClick={() => handleToggleSub(player)}
                                  className="rounded border border-border/50 p-1 text-muted-foreground hover:border-gold/50 hover:text-gold"
                                >
                                  <ArrowUpDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  title="Demitir jogador"
                                  onClick={() => handleFirePlayer(player.id)}
                                  className="rounded border border-border/50 p-1 text-muted-foreground hover:border-blood/60 hover:text-blood"
                                >
                                  <UserMinus className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {(pAwards.splitMvpTitles.length > 0 ||
                          pAwards.allProSelections.length > 0 ||
                          pAwards.matchMvpCount > 0) && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border/40 pt-2">
                            {pAwards.splitMvpTitles.length > 0 && (
                              <span
                                title={pAwards.splitMvpTitles.join(", ")}
                                className="inline-flex items-center gap-1 rounded border border-gold bg-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase text-gold"
                              >
                                🏆 {pAwards.splitMvpTitles.length}× MVP do Split
                              </span>
                            )}
                            {pAwards.allProSelections.length > 0 && (
                              <span
                                title={pAwards.allProSelections.join(", ")}
                                className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300"
                              >
                                ⭐ {pAwards.allProSelections.length}× Seleção All-Pro
                              </span>
                            )}
                            {pAwards.matchMvpCount > 0 && (
                              <span className="inline-flex items-center gap-1 rounded border border-border bg-black/40 px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                                🎖️ {pAwards.matchMvpCount}× MVP de Série
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {subs.length > 0 ? (
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground mb-2 block">
                    Reservas
                  </span>
                  <div className="space-y-2">
                    {subs.map((player) => (
                      <div
                        key={player.id}
                        onClick={() => setSelectedPlayer(player)}
                        className="flex cursor-pointer items-center justify-between rounded-xl border border-border/40 bg-card/20 p-2.5 opacity-80 transition-colors hover:border-gold/40 hover:opacity-100"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="w-12 text-center rounded bg-muted/40 px-1 py-0.5 text-[11px] font-mono uppercase text-muted-foreground">
                            {roleLabel(player.role)}
                          </span>
                          <span className="font-display text-xs font-semibold text-foreground">
                            {player.ign}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">
                            OVR {playerOverall(player)}
                          </span>
                          {manageMode && (
                            <div
                              className="flex items-center gap-1 pl-1 border-l border-border/50"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                title="Promover para titular"
                                onClick={() => handleToggleSub(player)}
                                className="rounded border border-border/50 p-1 text-muted-foreground hover:border-gold/50 hover:text-gold"
                              >
                                <ArrowUpDown className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                title="Demitir jogador"
                                onClick={() => handleFirePlayer(player.id)}
                                className="rounded border border-border/50 p-1 text-muted-foreground hover:border-blood/60 hover:text-blood"
                              >
                                <UserMinus className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* TAB 3: ESTATÍSTICAS */}
          {activeTab === "stats" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/60 bg-card/40 p-4">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Pontos no Hall da Fama
                  </span>
                  <span className="mt-1 block font-display text-3xl font-extrabold text-gold">
                    {points}
                  </span>
                </div>
                <div className="rounded-xl border border-border/60 bg-card/40 p-4">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Aproveitamento Geral
                  </span>
                  <span className="mt-1 block font-display text-3xl font-extrabold text-foreground">
                    {winRate}%
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/40 p-4 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Registros Históricos
                </h4>
                <div className="flex justify-between text-xs py-1.5 border-b border-border/40">
                  <span className="text-muted-foreground">Partidas Oficiais Jogadas</span>
                  <span className="font-bold text-foreground">{totalMatches}</span>
                </div>
                <div className="flex justify-between text-xs py-1.5 border-b border-border/40">
                  <span className="text-muted-foreground">Vitórias Registradas</span>
                  <span className="font-bold text-emerald-400">{matchesWon}</span>
                </div>
                <div className="flex justify-between text-xs py-1.5">
                  <span className="text-muted-foreground">Derrotas Registradas</span>
                  <span className="font-bold text-blood">{matchesLost}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {selectedPlayer ? (
        <PlayerProfileDrawer
          player={selectedPlayer}
          team={liveTeam}
          game={activeGame}
          onClose={() => setSelectedPlayer(null)}
        />
      ) : null}
    </div>
  );

  if (typeof document === "undefined") return drawerContent;
  return createPortal(drawerContent, document.body);
}
