import { useMemo, useState } from "react";
import {
  Award,
  ChevronDown,
  ChevronUp,
  Crown,
  Flame,
  MapPin,
  Shuffle,
  Sparkles,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import type { Championship, GameId, Phase, Player, Team } from "@/lib/lol/types";
import { useStore } from "@/lib/lol/store";
import {
  buildProtectedRound1Draw,
  computeEliteAwards,
  computeElitePowerRankings,
  detectEliteEventType,
  getEliteArena,
  getMsiChampionBonusRegion,
} from "@/lib/lol/international";
import { TeamLogo } from "./team-logo";
import { PlayerAvatar } from "./player-avatar";
import { PlayerProfileDrawer } from "./player-profile-drawer";

export function EliteEventPanel({
  championship,
  currentPhase,
}: {
  championship: Championship;
  currentPhase?: Phase | null;
}) {
  const { championships, career, updateChampionship } = useStore();
  const [showRankings, setShowRankings] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<{
    player: Player;
    team?: Team;
  } | null>(null);

  const eventType = detectEliteEventType(championship.name);
  if (!eventType) return null;

  const game = (championship.game ?? "lol") as GameId;
  const { arena, subtitle } = getEliteArena(championship.hostCity, eventType);

  const msiBonus = useMemo(
    () =>
      eventType === "worlds"
        ? getMsiChampionBonusRegion(career, championships, game)
        : null,
    [eventType, career, championships, game],
  );

  const powerRankings = useMemo(
    () => computeElitePowerRankings(championship, career),
    [championship, career],
  );

  const awards = useMemo(() => computeEliteAwards(championship), [championship]);

  const canDrawRound1 = useMemo(() => {
    if (!currentPhase) return false;
    const r1 = currentPhase.matches.filter(
      (m) => (m.round ?? 0) === 0 && !m.bye && m.teamAId && m.teamBId,
    );
    if (r1.length < 2) return false;
    return currentPhase.matches.every((m) => !m.winnerId);
  }, [currentPhase]);

  const handleProtectedDraw = () => {
    if (!currentPhase) return;
    const nextMatches = buildProtectedRound1Draw(
      currentPhase.matches,
      championship.teams,
      career,
      game,
    );
    updateChampionship(championship.id, (c) => ({
      ...c,
      phases: c.phases.map((p) =>
        p.id === currentPhase.id ? { ...p, matches: nextMatches } : p,
      ),
    }));
    toast.success("Sorteio oficial realizado com proteção regional na Rodada 1!");
  };

  return (
    <div className="mb-5 space-y-3">
      {/* Faixa de Evento de Elite */}
      <div className="noise-layer rounded-xl border border-gold/40 bg-gradient-to-r from-gold/10 via-card/70 to-black/50 p-3.5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded border border-gold/50 bg-gold/20 px-2.5 py-1 text-[10px] font-display font-bold uppercase tracking-widest text-gold">
              <Crown className="h-3.5 w-3.5" />
              {eventType === "worlds" ? "Evento Mundial · Elite" : "Major Global · MSI"}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-foreground">
                <span className="inline-flex items-center gap-1 font-semibold text-gold">
                  <MapPin className="h-3.5 w-3.5" />
                  {arena}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground text-[11px]">{subtitle}</span>
              </div>
              {eventType === "worlds" && msiBonus ? (
                <p className="mt-0.5 text-[11px] text-emerald-300/90">
                  Passaporte do MSI: <strong>{msiBonus.region}</strong> recebeu +1 vaga pelo título de{" "}
                  <strong>{msiBonus.teamName}</strong>.
                </p>
              ) : eventType === "msi" ? (
                <p className="mt-0.5 text-[11px] text-amber-200/80">
                  O campeão garante +1 vaga direta para sua região no Worlds desta temporada.
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canDrawRound1 && (
              <button
                type="button"
                onClick={handleProtectedDraw}
                className="inline-flex items-center gap-1.5 rounded border border-gold/50 bg-gold/15 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-gold hover:bg-gold/25"
              >
                <Shuffle className="h-3.5 w-3.5" />
                Sortear Potes (R1)
              </button>
            )}
            {championship.teams.length > 0 && (
              <button
                type="button"
                onClick={() => setShowRankings((v) => !v)}
                className="inline-flex items-center gap-1 rounded border border-border/60 bg-black/35 px-2.5 py-1 text-[11px] font-mono text-muted-foreground hover:border-gold/40 hover:text-gold"
              >
                <Sparkles className="h-3.5 w-3.5 text-gold" />
                Favoritos
                {showRankings ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Power Rankings Pré-Torneio (recolhível) */}
        {showRankings && powerRankings.topFavorites.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-gold/20 pt-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono uppercase tracking-widest text-gold">
                Top 5 Favoritos ao Título
              </span>
              <div className="space-y-1">
                {powerRankings.topFavorites.map((item, idx) => (
                  <div
                    key={item.team.id}
                    className="flex items-center justify-between rounded border border-border/40 bg-black/30 px-2.5 py-1 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-4 font-mono font-bold text-gold">#{idx + 1}</span>
                      <TeamLogo team={item.team} size={18} />
                      <span className="truncate font-semibold text-foreground">
                        {item.team.name}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {item.region}
                      </span>
                    </div>
                    <span className="font-mono text-xs font-bold text-gold">{item.rating}</span>
                  </div>
                ))}
              </div>
            </div>

            {powerRankings.darkHorse && (
              <div className="flex flex-col justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-amber-300">
                    <Flame className="h-3.5 w-3.5" /> Azarão para Ficar de Olho
                  </span>
                  <div className="mt-2 flex items-center gap-2.5">
                    <TeamLogo team={powerRankings.darkHorse.team} size={28} />
                    <div>
                      <div className="font-display text-sm font-bold text-foreground">
                        {powerRankings.darkHorse.team.name}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {powerRankings.darkHorse.region} · Força {powerRankings.darkHorse.rating}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Corre por fora do Top 5, mas tem elenco capaz de derrubar gigantes em séries eliminatórias.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hall do Torneio: Campeão, FMVP e Quinteto Ideal quando finalizado */}
      {awards.champion && (
        <div className="rounded-xl border border-gold/50 bg-gradient-to-br from-gold/15 via-card/60 to-black/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold/25 pb-3">
            <div className="flex items-center gap-3">
              <TeamLogo team={awards.champion} size={40} />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lg font-black uppercase tracking-tight text-gold">
                    {awards.champion.name} · Campeão
                  </span>
                  {awards.campaignTag && (
                    <span className="rounded border border-gold/40 bg-gold/20 px-2 py-0.5 text-[10px] font-mono uppercase text-gold">
                      {awards.campaignTag}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {championship.name} ({championship.season})
                  {championship.hostCity ? ` · ${championship.hostCity}` : ""}
                </p>
              </div>
            </div>

            {awards.fmvp && (
              <button
                type="button"
                onClick={() =>
                  setSelectedPlayer({ player: awards.fmvp!.player, team: awards.fmvp!.team })
                }
                className="flex items-center gap-2.5 rounded-xl border border-gold/50 bg-black/40 px-3 py-2 text-left transition-colors hover:border-gold hover:bg-black/60"
              >
                <PlayerAvatar ign={awards.fmvp.player.ign} role={awards.fmvp.player.role} size="sm" highlight />
                <div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-gold">
                    <Award className="h-3 w-3" /> FMVP das Finais
                  </span>
                  <div className="font-display text-sm font-bold text-foreground">
                    {awards.fmvp.player.ign}
                  </div>
                </div>
              </button>
            )}
          </div>

          {awards.allTournament.length > 0 && (
            <div>
              <span className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-gold">
                <Trophy className="h-3.5 w-3.5" /> Quinteto Ideal do Evento
              </span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {awards.allTournament.map((item) => (
                  <button
                    key={item.role}
                    type="button"
                    onClick={() => setSelectedPlayer({ player: item.player, team: item.team })}
                    className="flex items-center gap-2 rounded-lg border border-border/50 bg-black/35 p-2 text-left transition-colors hover:border-gold/50 hover:bg-black/55"
                  >
                    <PlayerAvatar ign={item.player.ign} role={item.role} size="sm" />
                    <div className="min-w-0">
                      <span className="block text-[9px] font-mono uppercase text-gold">
                        {item.role.toUpperCase()}
                      </span>
                      <span className="block truncate text-xs font-bold text-foreground">
                        {item.player.ign}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {item.team.tag}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedPlayer ? (
        <PlayerProfileDrawer
          player={selectedPlayer.player}
          team={selectedPlayer.team}
          game={game}
          onClose={() => setSelectedPlayer(null)}
        />
      ) : null}
    </div>
  );
}
