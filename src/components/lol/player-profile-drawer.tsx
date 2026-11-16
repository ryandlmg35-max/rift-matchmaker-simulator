import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Award,
  Calendar,
  History,
  Shield,
  Sparkles,
  Trophy,
  User,
  X,
} from "lucide-react";
import type { GameId, Player, PlayerRole, Team } from "@/lib/lol/types";
import { useStore } from "@/lib/lol/store";
import { getResolvedAttrs, playerOverall } from "@/lib/lol/players";
import { getPlayerCareerAwards } from "@/lib/lol/mvp";
import { getPlayerSalary } from "@/lib/lol/transfers";
import { canonicalTournamentName } from "@/lib/lol/international";
import { REAL_ROSTERS } from "@/lib/lol/real-rosters";
import { CS2_ALL_TEAMS_DB, getCs2TeamRoster } from "@/lib/lol/cs2-seed";
import { PlayerAvatar } from "./player-avatar";
import { CountryFlag } from "./country-flag";
import { TeamLogo } from "./team-logo";

function roleLabel(role: PlayerRole, game: GameId): string {
  if (game === "cs2") {
    switch (role) {
      case "top":
        return "Entry";
      case "jungle":
        return "Support";
      case "mid":
        return "Rifler";
      case "adc":
        return "AWPer";
      case "support":
        return "IGL";
    }
  }
  return role.toUpperCase();
}

export function PlayerProfileDrawer({
  player,
  team,
  game = "lol",
  onClose,
}: {
  player: Player;
  team?: Team | null;
  game?: GameId;
  onClose: () => void;
}) {
  const { championships, career } = useStore();
  const [activeTab, setActiveTab] = useState<"overview" | "teams" | "titles">("overview");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ignKey = player.ign.trim().toLowerCase();

  // Descobre o time atual real no store caso `team` não tenha sido passado ou tenha mudado
  const currentTeam = useMemo<Team | null>(() => {
    for (const c of championships) {
      if ((c.game ?? "lol") !== game) continue;
      for (const t of [...c.teams, ...(c.serieB?.teams ?? [])]) {
        if (t.roster?.some((p) => p.ign.trim().toLowerCase() === ignKey)) {
          return t;
        }
      }
    }
    return team ?? null;
  }, [championships, game, ignKey, team]);

  // Mapa de times conhecidos (para logo/tag)
  const teamMetaByName = useMemo(() => {
    const map = new Map<string, Team>();
    for (const c of championships) {
      if ((c.game ?? "lol") !== game) continue;
      for (const t of [...c.teams, ...(c.serieB?.teams ?? []), ...(c.formerTeams ?? [])]) {
        const k = t.name.trim().toLowerCase();
        if (!map.has(k) || (!map.get(k)?.logo && t.logo)) {
          map.set(k, t);
        }
      }
    }
    return map;
  }, [championships, game]);

  // Histórico completo de times que já jogou
  const teamsHistory = useMemo(() => {
    const entries = new Map<
      string,
      { teamName: string; team?: Team; badges: string[]; isCurrent: boolean }
    >();

    const addClub = (name: string | undefined, badge: string, isCurrent = false) => {
      const clean = (name ?? "").trim();
      if (!clean) return;
      const k = clean.toLowerCase();
      const existing = entries.get(k);
      if (existing) {
        if (!existing.badges.includes(badge)) existing.badges.push(badge);
        if (isCurrent) existing.isCurrent = true;
      } else {
        entries.set(k, {
          teamName: clean,
          team: teamMetaByName.get(k),
          badges: [badge],
          isCurrent,
        });
      }
    };

    if (currentTeam) {
      addClub(currentTeam.name, currentTeam.region ? `Elenco Atual (${currentTeam.region})` : "Elenco Atual", true);
    }

    // Transferências registradas nos campeonatos
    for (const c of championships) {
      if ((c.game ?? "lol") !== game) continue;
      for (const tr of c.transferHistory ?? []) {
        if (tr.playerIgn.trim().toLowerCase() !== ignKey) continue;
        if (tr.fromTeam) {
          addClub(tr.fromTeam, tr.date ? `Saída (${tr.date})` : "Ex-clube");
        }
        if (tr.toTeam) {
          addClub(tr.toTeam, tr.date ? `Contratação (${tr.date})` : "Contratação");
        }
      }
      // Times arquivados (formerTeams) onde o jogador atuou
      for (const ft of c.formerTeams ?? []) {
        if (ft.roster?.some((p) => p.ign.trim().toLowerCase() === ignKey)) {
          addClub(ft.name, `Elenco em ${c.season || c.name}`);
        }
      }
    }

    // Banco original do simulador (clube de origem)
    if (game === "lol") {
      for (const [reg, list] of Object.entries(REAL_ROSTERS)) {
        for (const st of list) {
          if (st.players.some((p) => p.ign.trim().toLowerCase() === ignKey)) {
            addClub(st.name, `Base ${reg}`);
          }
        }
      }
    } else {
      for (const spec of CS2_ALL_TEAMS_DB) {
        const built = getCs2TeamRoster(spec.name, spec.tag) ?? [];
        if (built.some((p) => p.ign.trim().toLowerCase() === ignKey)) {
          addClub(spec.name, `Base ${spec.region}`);
        }
      }
    }

    return Array.from(entries.values()).sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  }, [championships, currentTeam, game, ignKey, teamMetaByName]);

  // Títulos conquistados (pelos times pelos quais o jogador atuou + Hall da Fama)
  const titlesWon = useMemo(() => {
    const clubKeys = new Set(teamsHistory.map((t) => t.teamName.trim().toLowerCase()));
    const map = new Map<
      string,
      { tourney: string; split: string; teamName: string; teamLogo?: string; at?: string }
    >();

    // Se o jogador saiu de um time por transferência, registramos para referência;
    // qualquer título do time atual ou de clubes em que atuou aparece aqui.
    for (const t of career?.titles ?? []) {
      if ((t.game ?? "lol") !== game) continue;
      const tk = t.teamName.trim().toLowerCase();
      if (!clubKeys.has(tk)) continue;
      const tourney = canonicalTournamentName(t.champName || "Campeonato Oficial");
      const split = t.label || "Edição Oficial";
      const key = `${tourney.toLowerCase()}:::${split.toLowerCase()}:::${tk}`;
      if (!map.has(key)) {
        map.set(key, {
          tourney,
          split,
          teamName: t.teamName,
          teamLogo: t.teamLogo ?? teamMetaByName.get(tk)?.logo,
          at: t.at,
        });
      }
    }

    for (const c of championships) {
      if ((c.game ?? "lol") !== game) continue;
      const tourney = canonicalTournamentName(c.name);
      for (const h of [...(c.history ?? []), ...(c.serieB?.history ?? [])]) {
        const tk = h.teamName.trim().toLowerCase();
        if (!clubKeys.has(tk)) continue;
        const split = h.splitLabel || "Edição Oficial";
        const key = `${tourney.toLowerCase()}:::${split.toLowerCase()}:::${tk}`;
        if (!map.has(key)) {
          map.set(key, {
            tourney,
            split,
            teamName: h.teamName,
            teamLogo: h.teamLogo ?? teamMetaByName.get(tk)?.logo,
            at: h.savedAt,
          });
        }
      }
    }

    return Array.from(map.values());
  }, [career?.titles, championships, game, teamMetaByName, teamsHistory]);

  const gameChamps = useMemo(
    () => championships.filter((c) => (c.game ?? "lol") === game),
    [championships, game],
  );
  const awards = useMemo(
    () => getPlayerCareerAwards(player.ign, gameChamps),
    [player.ign, gameChamps],
  );

  const attrs = useMemo(
    () => getResolvedAttrs(player.attrs, player.ign, player.role, player.country, player.age),
    [player],
  );
  const ovr = useMemo(() => playerOverall(player), [player]);
  const salary = useMemo(
    () => getPlayerSalary(player, currentTeam?.region, career, game),
    [player, currentTeam?.region, career, game],
  );

  const attrRows = [
    { label: "Mecânica", val: attrs.mechanics },
    { label: "Game IQ", val: attrs.gameIq },
    { label: "Clutch", val: attrs.clutch },
    { label: "Consistência", val: attrs.consistency },
    { label: "Agressividade", val: attrs.aggression },
    { label: "Adaptabilidade", val: attrs.adaptability },
    { label: "Exp. Internacional", val: attrs.intlExperience },
    { label: "Mentalidade", val: attrs.mentality },
  ];

  const modalContent = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gold/40 bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border/60 bg-card/50 p-5">
          <div className="flex items-center gap-4 min-w-0">
            <PlayerAvatar ign={player.ign} role={player.role} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <CountryFlag code={player.country} size="sm" />
                <h2 className="font-display text-2xl font-black uppercase tracking-tight text-foreground truncate">
                  {player.ign}
                </h2>
                <span className="rounded border border-gold/40 bg-gold/15 px-2 py-0.5 text-[11px] font-mono font-bold uppercase text-gold">
                  {roleLabel(player.role, game)}
                </span>
                {player.sub && (
                  <span className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">
                    Reserva
                  </span>
                )}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {player.real && <span>{player.real}</span>}
                {player.age ? <span className="font-mono">{player.age} anos</span> : null}
                <span className="font-mono text-gold font-bold">OVR {ovr}</span>
                <span className="font-mono">Salário est.: ${salary}k/ano</span>
              </div>

              <div className="mt-2 flex items-center gap-2 text-xs">
                {currentTeam ? (
                  <span className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-black/30 px-2 py-0.5 font-medium text-foreground">
                    <TeamLogo team={currentTeam} size={16} />
                    <span>{currentTeam.name}</span>
                  </span>
                ) : (
                  <span className="rounded border border-border/50 bg-black/25 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                    Sem clube atual
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border/60 bg-black/30 p-1.5 text-muted-foreground hover:border-gold/50 hover:text-foreground"
            aria-label="Fechar perfil do jogador"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Resumo rápido */}
        <div className="grid grid-cols-3 divide-x divide-border/50 border-b border-border/60 bg-black/25 text-center">
          <div className="py-2.5">
            <span className="block text-[10px] font-mono uppercase text-muted-foreground">Títulos</span>
            <span className="font-display text-lg font-extrabold text-gold">{titlesWon.length}</span>
          </div>
          <div className="py-2.5">
            <span className="block text-[10px] font-mono uppercase text-muted-foreground">Clubes</span>
            <span className="font-display text-lg font-extrabold text-foreground">{teamsHistory.length}</span>
          </div>
          <div className="py-2.5">
            <span className="block text-[10px] font-mono uppercase text-muted-foreground">MVPs / Prêmios</span>
            <span className="font-display text-lg font-extrabold text-amber-300">
              {awards.splitMvpTitles.length + awards.allProSelections.length + awards.matchMvpCount}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border/60 bg-card/30 px-4">
          {[
            { id: "overview" as const, label: "Atributos & Prêmios", icon: User },
            { id: "teams" as const, label: `Times (${teamsHistory.length})`, icon: History },
            { id: "titles" as const, label: `Títulos (${titlesWon.length})`, icon: Trophy },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  activeTab === tab.id
                    ? "border-gold text-gold"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === "overview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {attrRows.map((a) => (
                  <div key={a.label} className="rounded-xl border border-border/50 bg-card/40 p-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{a.label}</span>
                      <span
                        className={`font-mono font-bold ${
                          a.val >= 85
                            ? "text-gold"
                            : a.val >= 72
                              ? "text-emerald-300"
                              : "text-foreground"
                        }`}
                      >
                        {a.val}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/40">
                      <div
                        className={`h-full rounded-full ${
                          a.val >= 85
                            ? "bg-gold"
                            : a.val >= 72
                              ? "bg-emerald-400"
                              : "bg-zinc-400"
                        }`}
                        style={{ width: `${Math.min(100, Math.max(5, a.val))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {(awards.splitMvpTitles.length > 0 ||
                awards.allProSelections.length > 0 ||
                awards.matchMvpCount > 0) && (
                <div className="rounded-xl border border-gold/30 bg-card/40 p-3.5 space-y-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gold">
                    <Sparkles className="h-3.5 w-3.5" /> Prêmios Individuais
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {awards.splitMvpTitles.map((t, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded border border-gold bg-gold/20 px-2 py-1 text-[11px] font-bold text-gold"
                      >
                        <Award className="h-3.5 w-3.5" /> MVP · {t}
                      </span>
                    ))}
                    {awards.allProSelections.map((t, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-300"
                      >
                        ⭐ All-Pro · {t}
                      </span>
                    ))}
                    {awards.matchMvpCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded border border-border bg-black/40 px-2 py-1 text-[11px] font-mono text-muted-foreground">
                        🎖️ {awards.matchMvpCount}× MVP de Série
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "teams" && (
            <div className="space-y-2.5">
              {teamsHistory.length === 0 ? (
                <div className="rounded-xl border border-border/50 bg-card/30 p-6 text-center text-xs text-muted-foreground">
                  <Shield className="mx-auto mb-2 h-7 w-7 opacity-30" />
                  Nenhum registro de clube encontrado para este jogador.
                </div>
              ) : (
                teamsHistory.map((item) => (
                  <div
                    key={item.teamName}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
                      item.isCurrent
                        ? "border-gold/50 bg-gold/10"
                        : "border-border/50 bg-card/40"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {item.team ? (
                        <TeamLogo team={item.team} size={32} />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded border border-border/60 bg-black/30 text-xs font-mono text-muted-foreground">
                          {item.teamName.slice(0, 3).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <span className="font-display text-sm font-bold text-foreground block truncate">
                          {item.teamName}
                        </span>
                        <div className="mt-0.5 flex flex-wrap gap-1.5">
                          {item.badges.map((b, i) => (
                            <span
                              key={i}
                              className="rounded border border-border/50 bg-black/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                            >
                              {b}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    {item.isCurrent && (
                      <span className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                        Atual
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "titles" && (
            <div className="space-y-2.5">
              {titlesWon.length === 0 ? (
                <div className="rounded-xl border border-border/50 bg-card/30 p-6 text-center text-xs text-muted-foreground">
                  <Trophy className="mx-auto mb-2 h-7 w-7 opacity-30" />
                  Nenhum título oficial registrado ainda para os clubes deste jogador.
                </div>
              ) : (
                titlesWon.map((t, i) => (
                  <div
                    key={`${t.tourney}-${t.split}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gold/30 bg-card/40 p-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="rounded-lg border border-gold/40 bg-gold/15 p-2 text-gold shrink-0">
                        <Trophy className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-display text-sm font-bold text-foreground block truncate">
                          {t.tourney}
                        </span>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="font-semibold text-gold/90">{t.split}</span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            {t.teamLogo ? (
                              <img src={t.teamLogo} alt="" className="h-3.5 w-3.5 object-contain" />
                            ) : null}
                            {t.teamName}
                          </span>
                          {t.at ? (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                                <Calendar className="h-3 w-3 text-gold/80" />
                                {new Date(t.at).toLocaleDateString("pt-BR")}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 rounded border border-gold/40 bg-gold/20 px-2 py-0.5 text-[11px] font-mono font-bold text-gold">
                      🏆 Campeão
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return modalContent;
  return createPortal(modalContent, document.body);
}
